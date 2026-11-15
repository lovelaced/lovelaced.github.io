// A deliberately small GPU abstraction. Every pass is a fullscreen-triangle
// fragment shader written once in WGSL. Bindings follow one convention:
//   @binding(0)          uniform block of vec4f fields (identical in std140)
//   @binding(1 + 2k)     texture k
//   @binding(2 + 2k)     its sampler
// Texture rows are stored top-first in both APIs, so uv (0,0) is the top-left
// of every target. Only the WebGL2 default framebuffer is bottom-up; the
// backend tells shaders via `flipY` so the final pass can compensate.

export interface ShaderModule {
  name: string;
  wgsl: string;
  glsl: string;
  /** [glsl block name, binding] */
  blocks: [string, number][];
  /** [glsl sampler name, binding] */
  samplers: [string, number][];
}

export type Format = 'rgba16f' | 'rgba8';
export type Filter = 'linear' | 'nearest';
export type Wrap = 'clamp' | 'repeat';

export interface TargetOpts {
  width: number;
  height: number;
  format: Format;
  filter?: Filter;
  wrap?: Wrap;
}

export interface UploadOpts {
  filter?: Filter;
  wrap?: Wrap;
}

export type BackendKind = 'webgl2' | 'webgpu';

export interface Backend {
  readonly kind: BackendKind;
  /** canvas shows values above 1.0 (extended range) */
  readonly hdr: boolean;
  /** colour space of the drawing buffer */
  readonly gamut: 'srgb' | 'p3';
  /** true when the screen pass must flip y (WebGL2 default framebuffer) */
  readonly flipY: boolean;
  /** backing-store size in device pixels */
  resize(width: number, height: number): void;
  /** create or (if size/format changed) recreate a render target */
  target(name: string, opts: TargetOpts): void;
  /** upload a canvas/image into a sampled texture (created on first use) */
  upload(name: string, source: TexImageSource, opts?: UploadOpts): void;
  /**
   * Draw a fullscreen pass.
   * @param out target name, or null for the canvas
   * @param inputs texture binding -> target/texture name
   * @param uniforms packed vec4f data matching the shader's uniform struct
   */
  draw(shader: ShaderModule, out: string | null, inputs: Record<number, string>, uniforms: Float32Array): void;
  /** submit queued work (WebGPU); no-op for WebGL2 */
  flush(): void;
  lost(): boolean;
  destroy(): void;
}

export const FULLSCREEN_VS_WGSL = /* wgsl */ `
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FULLSCREEN_VS_GLSL = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
