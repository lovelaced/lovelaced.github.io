import type { Backend, BackendKind } from './types.ts';
import { WebGL2Backend } from './webgl2.ts';
import { WebGPUBackend } from './webgpu.ts';

export interface Display {
  p3: boolean;
  hdr: boolean;
  reducedMotion: boolean;
}

export function display(): Display {
  return {
    p3: matchMedia('(color-gamut: p3)').matches,
    hdr: matchMedia('(dynamic-range: high)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function forced(): BackendKind | null {
  const r = new URLSearchParams(location.search).get('renderer');
  return r === 'webgl2' || r === 'webgpu' ? r : null;
}

/**
 * WebGL2 + P3 for everyone; WebGPU only when it buys us extended range (HDR).
 * A canvas can only ever hold one context type, so WebGPU is probed with
 * throwaway canvases before the real one is claimed.
 */
export async function createBackend(canvas: HTMLCanvasElement, d: Display): Promise<Backend | null> {
  const force = forced();
  if (force !== 'webgl2' && (force === 'webgpu' || d.hdr)) {
    const gpu = await WebGPUBackend.create(canvas, { hdr: d.hdr, p3: d.p3 });
    if (gpu && (gpu.hdr || force === 'webgpu')) return gpu;
    gpu?.destroy();
    // The canvas may now be claimed by a WebGPU context; WebGL2 needs a fresh one.
    if (gpu) canvas = swapCanvas(canvas);
  }
  const gl = WebGL2Backend.create(canvas, d.p3);
  if (gl) return gl;
  if (force !== 'webgl2') return WebGPUBackend.create(swapCanvas(canvas), { hdr: false, p3: d.p3 });
  return null;
}

function swapCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const fresh = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(fresh);
  return fresh;
}
