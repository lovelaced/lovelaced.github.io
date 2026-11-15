import { createBackend, display } from './gpu/probe.ts';
import spike from './shaders/spike.wgsl';

const status = document.getElementById('s')!;
const d = display();
const canvas = document.getElementById('c') as HTMLCanvasElement;

const be = await createBackend(canvas, d);
const live = document.querySelector('canvas') as HTMLCanvasElement;

const lines = [
  `renderer       ${be?.kind ?? 'none'}${be?.hdr ? ' (hdr, extended)' : ''}`,
  `canvas gamut   ${be?.gamut ?? '-'}`,
  `display        color-gamut:p3=${d.p3}  dynamic-range:high=${d.hdr}`,
  `ua             ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '')}`,
  '',
  'swap: <a href="?renderer=webgl2">webgl2</a> · <a href="?renderer=webgpu">webgpu</a> · <a href="?">auto</a>',
];
status.innerHTML = lines.join('\n');
(window as unknown as { __spike: object }).__spike = { kind: be?.kind, hdr: be?.hdr, gamut: be?.gamut, display: d };

if (be) {
  const u = new Float32Array(8);
  const frame = (t: number) => {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(live.clientWidth * dpr);
    const h = Math.round(live.clientHeight * dpr);
    be.resize(w, h);
    u.set([w, h, t / 1000, be.flipY ? 1 : 0, be.gamut === 'p3' ? 1 : 0, be.hdr ? 1 : 0, be.hdr ? 8 : 1, 0]);
    be.draw(spike, null, {}, u);
    be.flush();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
