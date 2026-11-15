import {
  FULLSCREEN_VS_GLSL,
  type Backend,
  type Filter,
  type Format,
  type ShaderModule,
  type TargetOpts,
  type UploadOpts,
  type Wrap,
} from './types.ts';

interface Tex {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer | null;
  w: number;
  h: number;
  format: Format | 'upload';
  filter: Filter;
  wrap: Wrap;
}

interface Prog {
  prog: WebGLProgram;
  ubo: WebGLBuffer | null;
  uboSize: number;
  /** texture binding -> texture unit */
  units: Map<number, number>;
}

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const;
  readonly hdr = false;
  readonly flipY = true;
  readonly gamut: 'srgb' | 'p3';
  private progs = new Map<string, Prog>();
  private texs = new Map<string, Tex>();
  private vao: WebGLVertexArrayObject;
  private vs: WebGLShader;

  static create(canvas: HTMLCanvasElement, wantP3: boolean): WebGL2Backend | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    // Rendering into half-float targets is the one hard requirement.
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
    gl.getExtension('OES_texture_float_linear');
    if (wantP3 && 'drawingBufferColorSpace' in gl) {
      gl.drawingBufferColorSpace = 'display-p3';
    }
    const p3 = 'drawingBufferColorSpace' in gl && gl.drawingBufferColorSpace === 'display-p3';
    try {
      return new WebGL2Backend(gl, p3 ? 'p3' : 'srgb');
    } catch (e) {
      console.warn('[webgl2] init failed', e);
      return null;
    }
  }

  private constructor(
    private gl: WebGL2RenderingContext,
    gamut: 'srgb' | 'p3',
  ) {
    this.gamut = gamut;
    this.vao = gl.createVertexArray()!;
    this.vs = this.compile(gl.VERTEX_SHADER, FULLSCREEN_VS_GLSL, 'fullscreen.vert');
    // Probe that a half-float FBO is actually complete on this driver.
    this.target('__probe', { width: 4, height: 4, format: 'rgba16f' });
    this.dispose('__probe');
  }

  resize(width: number, height: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
  }

  target(name: string, o: TargetOpts): void {
    const gl = this.gl;
    const filter = o.filter ?? 'linear';
    const wrap = o.wrap ?? 'clamp';
    const old = this.texs.get(name);
    if (old && old.w === o.width && old.h === o.height && old.format === o.format) {
      if (old.filter !== filter || old.wrap !== wrap) this.params(old.tex, filter, wrap), Object.assign(old, { filter, wrap });
      return;
    }
    if (old) this.dispose(name);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (o.format === 'rgba16f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, o.width, o.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, o.width, o.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    this.params(tex, filter, wrap);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      throw new Error(`[webgl2] target ${name} (${o.format}) incomplete: 0x${status.toString(16)}`);
    }
    this.texs.set(name, { tex, fbo, w: o.width, h: o.height, format: o.format, filter, wrap });
  }

  upload(name: string, source: TexImageSource, o: UploadOpts = {}): void {
    const gl = this.gl;
    const filter = o.filter ?? 'linear';
    const wrap = o.wrap ?? 'clamp';
    let t = this.texs.get(name);
    if (!t) {
      t = { tex: gl.createTexture()!, fbo: null, w: 0, h: 0, format: 'upload', filter, wrap };
      this.texs.set(name, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.params(t.tex, filter, wrap);
  }

  draw(shader: ShaderModule, out: string | null, inputs: Record<number, string>, uniforms: Float32Array): void {
    const gl = this.gl;
    const p = this.program(shader);
    gl.useProgram(p.prog);
    if (p.ubo) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, p.ubo);
      if (uniforms.byteLength >= p.uboSize) {
        gl.bufferData(gl.UNIFORM_BUFFER, uniforms, gl.DYNAMIC_DRAW);
      } else {
        // Shader expects more than we were given: pad with zeros.
        const padded = new Float32Array(p.uboSize / 4);
        padded.set(uniforms);
        gl.bufferData(gl.UNIFORM_BUFFER, padded, gl.DYNAMIC_DRAW);
      }
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, p.ubo);
    }
    for (const [binding, unit] of p.units) {
      const name = inputs[binding];
      const t = name ? this.texs.get(name) : undefined;
      if (!t) throw new Error(`[webgl2] ${shader.name}: no texture bound at binding ${binding} (${name})`);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
    }
    if (out === null) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    } else {
      const t = this.texs.get(out);
      if (!t || !t.fbo) throw new Error(`[webgl2] unknown target ${out}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  flush(): void {}

  lost(): boolean {
    return this.gl.isContextLost();
  }

  destroy(): void {
    for (const name of [...this.texs.keys()]) this.dispose(name);
    for (const p of this.progs.values()) {
      this.gl.deleteProgram(p.prog);
      if (p.ubo) this.gl.deleteBuffer(p.ubo);
    }
    this.progs.clear();
  }

  private dispose(name: string) {
    const t = this.texs.get(name);
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    if (t.fbo) this.gl.deleteFramebuffer(t.fbo);
    this.texs.delete(name);
  }

  private params(tex: WebGLTexture, filter: Filter, wrap: Wrap) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    const w = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  }

  private compile(type: number, src: string, name: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`[webgl2] ${name} failed to compile:\n${log}`);
    }
    return s;
  }

  private program(shader: ShaderModule): Prog {
    const cached = this.progs.get(shader.name);
    if (cached) return cached;
    const gl = this.gl;
    const fs = this.compile(gl.FRAGMENT_SHADER, shader.glsl, `${shader.name}.frag`);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`[webgl2] ${shader.name} failed to link:\n${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(fs);
    let ubo: WebGLBuffer | null = null;
    let uboSize = 0;
    for (const [blockName] of shader.blocks) {
      const idx = gl.getUniformBlockIndex(prog, blockName);
      if (idx === gl.INVALID_INDEX) continue;
      gl.uniformBlockBinding(prog, idx, 0);
      uboSize = gl.getActiveUniformBlockParameter(prog, idx, gl.UNIFORM_BLOCK_DATA_SIZE) as number;
      ubo = gl.createBuffer();
    }
    const units = new Map<number, number>();
    gl.useProgram(prog);
    for (const [samplerName, binding] of shader.samplers) {
      const loc = gl.getUniformLocation(prog, samplerName);
      if (!loc) continue;
      const unit = (binding - 1) >> 1;
      gl.uniform1i(loc, unit);
      units.set(binding, unit);
    }
    const p: Prog = { prog, ubo, uboSize, units };
    this.progs.set(shader.name, p);
    return p;
  }
}
