import {
  FULLSCREEN_VS_WGSL,
  type Backend,
  type Filter,
  type ShaderModule,
  type TargetOpts,
  type UploadOpts,
  type Wrap,
} from './types.ts';

interface Tex {
  tex: GPUTexture;
  view: GPUTextureView;
  w: number;
  h: number;
  format: GPUTextureFormat;
  filter: Filter;
  wrap: Wrap;
}

export interface WebGPUOpts {
  hdr: boolean;
  p3: boolean;
}

/** Ask a throwaway canvas what this browser will really do. */
function probe(device: GPUDevice, format: GPUTextureFormat, colorSpace: PredefinedColorSpace, mode: GPUCanvasToneMappingMode) {
  const ctx = document.createElement('canvas').getContext('webgpu');
  if (!ctx) return null;
  try {
    ctx.configure({ device, format, colorSpace, toneMapping: { mode }, alphaMode: 'opaque' });
  } catch {
    return null; // Firefox throws on rgba16float canvases
  }
  const c = (ctx as GPUCanvasContext & { getConfiguration?: () => GPUCanvasConfiguration | null }).getConfiguration?.();
  ctx.unconfigure();
  return { colorSpace: c?.colorSpace ?? 'srgb', toneMapping: c?.toneMapping?.mode ?? 'standard' };
}

export class WebGPUBackend implements Backend {
  readonly kind = 'webgpu' as const;
  readonly flipY = false;
  readonly hdr: boolean;
  readonly gamut: 'srgb' | 'p3';
  private pipelines = new Map<string, GPURenderPipeline>();
  private modules = new Map<string, GPUShaderModule>();
  private texs = new Map<string, Tex>();
  private samplers = new Map<string, GPUSampler>();
  /** per-shader ring of uniform buffers, reset every flush */
  private ubos = new Map<string, { bufs: GPUBuffer[]; next: number }>();
  private encoder: GPUCommandEncoder | null = null;
  private frameView: GPUTextureView | null = null;
  private isLost = false;
  private canvasFormat: GPUTextureFormat;

  /** Returns null when WebGPU can't give us what was asked for. */
  static async create(canvas: HTMLCanvasElement, want: WebGPUOpts): Promise<WebGPUBackend | null> {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (!adapter) return null;
    const device = await adapter.requestDevice().catch(() => null);
    if (!device) return null;

    const colorSpace: PredefinedColorSpace = want.p3 ? 'display-p3' : 'srgb';
    let format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();
    let hdr = false;
    if (want.hdr) {
      const p = probe(device, 'rgba16float', colorSpace, 'extended');
      if (p?.toneMapping === 'extended') {
        format = 'rgba16float';
        hdr = true;
      }
    }
    const ctx = canvas.getContext('webgpu');
    if (!ctx) {
      device.destroy();
      return null;
    }
    ctx.configure({
      device,
      format,
      colorSpace,
      toneMapping: { mode: hdr ? 'extended' : 'standard' },
      alphaMode: 'opaque',
    });
    const conf = (ctx as GPUCanvasContext & { getConfiguration?: () => GPUCanvasConfiguration | null }).getConfiguration?.();
    const gamut = (conf?.colorSpace ?? colorSpace) === 'display-p3' ? 'p3' : 'srgb';
    return new WebGPUBackend(device, ctx, format, hdr, gamut);
  }

  private constructor(
    private device: GPUDevice,
    private ctx: GPUCanvasContext,
    format: GPUTextureFormat,
    hdr: boolean,
    gamut: 'srgb' | 'p3',
  ) {
    this.canvasFormat = format;
    this.hdr = hdr;
    this.gamut = gamut;
    device.lost.then((info) => {
      this.isLost = true;
      if (info.reason !== 'destroyed') console.warn('[webgpu] device lost', info.message);
    });
    device.addEventListener('uncapturederror', (e) => {
      console.error('[webgpu]', (e as GPUUncapturedErrorEvent).error.message);
    });
  }

  resize(width: number, height: number): void {
    const c = this.ctx.canvas as HTMLCanvasElement;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
  }

  target(name: string, o: TargetOpts): void {
    const format: GPUTextureFormat = o.format === 'rgba16f' ? 'rgba16float' : 'rgba8unorm';
    const filter = o.filter ?? 'linear';
    const wrap = o.wrap ?? 'clamp';
    const old = this.texs.get(name);
    if (old && old.w === o.width && old.h === o.height && old.format === format) {
      old.filter = filter;
      old.wrap = wrap;
      return;
    }
    old?.tex.destroy();
    const tex = this.device.createTexture({
      size: [o.width, o.height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    this.texs.set(name, { tex, view: tex.createView(), w: o.width, h: o.height, format, filter, wrap });
  }

  upload(name: string, source: TexImageSource, o: UploadOpts = {}): void {
    const s = source as { width: number; height: number };
    const w = s.width;
    const h = s.height;
    let t = this.texs.get(name);
    if (!t || t.w !== w || t.h !== h) {
      t?.tex.destroy();
      const tex = this.device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      t = { tex, view: tex.createView(), w, h, format: 'rgba8unorm', filter: 'linear', wrap: 'clamp' };
      this.texs.set(name, t);
    }
    t.filter = o.filter ?? 'linear';
    t.wrap = o.wrap ?? 'clamp';
    this.device.queue.copyExternalImageToTexture(
      { source: source as GPUCopyExternalImageSource },
      { texture: t.tex },
      [w, h],
    );
  }

  draw(shader: ShaderModule, out: string | null, inputs: Record<number, string>, uniforms: Float32Array): void {
    if (this.isLost) return;
    const target = out === null ? null : this.texs.get(out);
    if (out !== null && !target) throw new Error(`[webgpu] unknown target ${out}`);
    const format = target ? target.format : this.canvasFormat;
    const pipeline = this.pipeline(shader, format);

    const entries: GPUBindGroupEntry[] = [];
    if (shader.blocks.length) {
      entries.push({ binding: 0, resource: { buffer: this.uniformBuffer(shader.name, uniforms) } });
    }
    for (const [, binding] of shader.samplers) {
      const name = inputs[binding];
      const t = name ? this.texs.get(name) : undefined;
      if (!t) throw new Error(`[webgpu] ${shader.name}: no texture bound at binding ${binding} (${name})`);
      entries.push({ binding, resource: t.view });
      entries.push({ binding: binding + 1, resource: this.sampler(t.filter, t.wrap) });
    }
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });

    this.encoder ??= this.device.createCommandEncoder();
    let view: GPUTextureView;
    if (target) {
      view = target.view;
    } else {
      this.frameView ??= this.ctx.getCurrentTexture().createView();
      view = this.frameView;
    }
    const pass = this.encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  flush(): void {
    if (this.encoder) this.device.queue.submit([this.encoder.finish()]);
    this.encoder = null;
    this.frameView = null;
    for (const ring of this.ubos.values()) ring.next = 0;
  }

  lost(): boolean {
    return this.isLost;
  }

  destroy(): void {
    for (const t of this.texs.values()) t.tex.destroy();
    this.texs.clear();
    this.device.destroy();
  }

  private module(shader: ShaderModule): GPUShaderModule {
    let m = this.modules.get(shader.name);
    if (!m) {
      m = this.device.createShaderModule({ label: shader.name, code: `${FULLSCREEN_VS_WGSL}\n${shader.wgsl}` });
      this.modules.set(shader.name, m);
    }
    return m;
  }

  private pipeline(shader: ShaderModule, format: GPUTextureFormat): GPURenderPipeline {
    const key = `${shader.name}|${format}`;
    let p = this.pipelines.get(key);
    if (!p) {
      const module = this.module(shader);
      p = this.device.createRenderPipeline({
        label: key,
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.pipelines.set(key, p);
    }
    return p;
  }

  private uniformBuffer(name: string, data: Float32Array): GPUBuffer {
    let ring = this.ubos.get(name);
    if (!ring) {
      ring = { bufs: [], next: 0 };
      this.ubos.set(name, ring);
    }
    const size = Math.max(16, Math.ceil(data.byteLength / 16) * 16);
    let buf = ring.bufs[ring.next];
    if (!buf || buf.size < size) {
      buf?.destroy();
      buf = this.device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      ring.bufs[ring.next] = buf;
    }
    ring.next++;
    this.device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength);
    return buf;
  }

  private sampler(filter: Filter, wrap: Wrap): GPUSampler {
    const key = `${filter}|${wrap}`;
    let s = this.samplers.get(key);
    if (!s) {
      const mode: GPUAddressMode = wrap === 'repeat' ? 'repeat' : 'clamp-to-edge';
      s = this.device.createSampler({
        magFilter: filter,
        minFilter: filter,
        addressModeU: mode,
        addressModeV: mode,
      });
      this.samplers.set(key, s);
    }
    return s;
  }
}
