import { oklch, type Vec3 } from './colour/oklch.ts';
import { LOVECRAFT, PIGMENTS, type Phase, type Pigment } from './content.ts';
import { createBackend, display } from './gpu/probe.ts';
import { arcAt } from './scene/arc.ts';
import { Creature, type Target } from './scene/colour.ts';
import { Input } from './scene/input.ts';
import { Leaves } from './scene/leaves.ts';
import bloomDown from './shaders/bloom_down.wgsl';
import bloomUp from './shaders/bloom_up.wgsl';
import blur from './shaders/blur.wgsl';
import finalShader from './shaders/final.wgsl';
import sceneShader from './shaders/scene.wgsl';
import simColour from './shaders/sim_colour.wgsl';
import simWave from './shaders/sim_wave.wgsl';
import { Ink } from './text/raster.ts';

const params = new URLSearchParams(location.search);
const T_OFFSET = Number(params.get('t') ?? 0) || 0;
const FREEZE = params.has('freeze');
const DEBUG = params.has('debug');

const root = document.documentElement;
const disp = display();
const be = await createBackend(document.getElementById('well') as HTMLCanvasElement, disp);
if (!be) {
  root.classList.add('no-gl');
  throw new Error('no usable GPU backend; showing the static page');
}
// createBackend may have swapped the element for a fresh one
const canvas = document.getElementById('well') as HTMLCanvasElement;

// ---------------------------------------------------------------- constants
const TAN_HALF = Math.tan((50 / 2) * (Math.PI / 180));
const COARSE = matchMedia('(pointer: coarse)').matches;
const DPR_CAP = COARSE ? 1.5 : 2;
const SIM_HZ = 120;
const INK: Vec3 = oklch(0.93, 0.025, 88); // bone
const JET: Vec3 = oklch(0.12, 0.01, 270);
const PEAK = be.hdr ? 3 : 1;
const POUR_HUE = (128 * Math.PI) / 180;
const POUR_GAIN = be.hdr ? 2.6 : 1;
/** how much brighter the colour may glow where the display allows it */
const GLOW_GAIN = be.hdr ? 2.4 : 1;

// per-element ink alpha, indexed by data-ink id
const BASE_ALPHA = [0, 1, 0.9, 1, 1, 1, 0.85, 0.62, 0.45];
const INK_ALPHA = new Float32Array(16);

// pigment colours, pushed to (and past) the edge of what screens can show
const DYE: Record<Pigment, Vec3> = {
  jet: [-0.55, -0.55, -0.5],
  scheele: oklch(...PIGMENTS.scheele.oklch),
  cobalt: oklch(...PIGMENTS.cobalt.oklch),
  paris: oklch(...PIGMENTS.paris.oklch),
};
const TINT: Record<Pigment, Vec3> = {
  jet: oklch(0.55, 0.02, 280),
  scheele: oklch(0.9, 0.12, PIGMENTS.scheele.oklch[2]),
  cobalt: oklch(0.86, 0.1, PIGMENTS.cobalt.oklch[2]),
  paris: oklch(0.92, 0.12, PIGMENTS.paris.oklch[2]),
};

// ---------------------------------------------------------------- layout
let W = 0;
let H = 0;
let SW = 0;
let SH = 0;
let WW = 0;
let WH = 0;
let CW = 0;
let CH = 0;
// adaptive resolution for the heavy scene pass: step down when frames run long
const SCALES = [0.75, 0.62, 0.5, 0.4];
let scaleIdx = 0;
let scale = SCALES[0];
const bloomSizes: [number, number][] = [];
const frameRect = () => canvas.getBoundingClientRect();

function fit(long: number): [number, number] {
  return W >= H ? [long, Math.max(2, Math.round((long * H) / W))] : [Math.max(2, Math.round((long * W) / H)), long];
}

function sizeScene() {
  SW = Math.max(2, Math.round(W * scale));
  SH = Math.max(2, Math.round(H * scale));
  be!.target('scene', { width: SW, height: SH, format: 'rgba16f' });
  bloomSizes.length = 0;
  for (let i = 1; i <= 4; i++) {
    const s: [number, number] = [Math.max(1, SW >> i), Math.max(1, SH >> i)];
    bloomSizes.push(s);
    be!.target(`d${i}`, { width: s[0], height: s[1], format: 'rgba16f' });
    if (i < 4) be!.target(`u${i}`, { width: s[0], height: s[1], format: 'rgba16f' });
  }
}

let frameEma = 1 / 60;
let slowFor = 0;
let fastFor = 0;
function adapt(dt: number) {
  frameEma += (dt - frameEma) * 0.06;
  if (frameEma > 1 / 42) {
    slowFor += dt;
    fastFor = 0;
  } else if (frameEma < 1 / 56) {
    fastFor += dt;
    slowFor = Math.max(0, slowFor - dt);
  }
  if (slowFor > 1 && scaleIdx < SCALES.length - 1) {
    scale = SCALES[++scaleIdx];
    slowFor = 0;
    frameEma = 1 / 60;
    sizeScene();
  } else if (fastFor > 8 && scaleIdx > 0) {
    scale = SCALES[--scaleIdx];
    fastFor = 0;
    sizeScene();
  }
}

function layout(): boolean {
  const r = frameRect();
  const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
  const w = Math.max(2, Math.round(r.width * dpr));
  const h = Math.max(2, Math.round(r.height * dpr));
  if (w === W && h === H) return false;
  W = w;
  H = h;
  be!.resize(W, H);
  sizeScene();
  [WW, WH] = fit(COARSE ? 384 : 512);
  be!.target('waveA', { width: WW, height: WH, format: 'rgba16f' });
  be!.target('waveB', { width: WW, height: WH, format: 'rgba16f' });
  [CW, CH] = fit(COARSE ? 192 : 256);
  be!.target('colA', { width: CW, height: CH, format: 'rgba16f' });
  be!.target('colB', { width: CW, height: CH, format: 'rgba16f' });
  be!.target('h1', { width: Math.max(2, W >> 2), height: Math.max(2, H >> 2), format: 'rgba8' });
  be!.target('h2', { width: Math.max(2, W >> 2), height: Math.max(2, H >> 2), format: 'rgba8' });
  inkDirty = true;
  haloDirty = true;
  return true;
}

function moonDir(aspect: number): Vec3 {
  const [ux, uy] = aspect >= 1 ? [0.74, 0.26] : [0.76, 0.12];
  const v: Vec3 = [(ux - 0.5) * 2 * TAN_HALF * aspect, -(uy - 0.5) * 2 * TAN_HALF, -1];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, -v[2] / l];
}

/** an element's box in uv, and its centre in p-space */
function boxOf(el: Element) {
  const f = frameRect();
  const r = el.getBoundingClientRect();
  const uv: [number, number, number, number] = [
    (r.left - f.left) / f.width,
    (r.top - f.top) / f.height,
    (r.right - f.left) / f.width,
    (r.bottom - f.top) / f.height,
  ];
  const aspect = f.width / f.height;
  return { uv, centre: { x: ((uv[0] + uv[2]) / 2) * aspect, y: (uv[1] + uv[3]) / 2 } };
}

// ---------------------------------------------------------------- text
const ink = new Ink();
let inkDirty = true;
let haloDirty = true;
let fontsReady = false;
let inkShownAt = -1;
{
  const blank = document.createElement('canvas');
  blank.width = blank.height = 1;
  blank.getContext('2d');
  be.upload('text', blank);
}
document.fonts.ready.then(() => {
  fontsReady = true;
  inkDirty = true;
});
let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => (inkDirty = true), 80);
}).observe(document.body);

const heading = document.querySelector('h1')!;
const quote = document.querySelector<HTMLElement>('.lovecraft [data-ink="7"]')!;
let quoteFor: Phase | null = 'welling';
let quoteAlpha = 0;
const story = document.querySelector<HTMLElement>('.story')!;
let home: Target = { x: 0.4, y: 0.55 };

// ---------------------------------------------------------------- input
const input = new Input(frameRect);
let paused = false;
const still = document.getElementById('still') as HTMLButtonElement | null;
still?.addEventListener('click', () => {
  paused = !paused;
  still.textContent = paused ? 'stir the water' : 'still the water';
  still.setAttribute('aria-pressed', String(paused));
});

// the pigment story under the links
let storyFor: Pigment | null = null;
let storyAlpha = 0;
let hoverAmt = 0;
let lastPigment: Pigment = 'scheele';
let lastAt = 0;
function setStory(p: Pigment | null) {
  if (p === storyFor) return;
  storyFor = p;
  if (p) {
    const info = PIGMENTS[p];
    story.innerHTML = `<span class="name">${info.name}.</span> ${info.story}`;
    inkDirty = true;
  }
}

// ---------------------------------------------------------------- uniforms
const uWave = new Float32Array(4 * 11);
const uColour = new Float32Array(4 * 16);
const uScene = new Float32Array(4 * (8 + 32));
const uDown = new Float32Array(8);
const uUp = new Float32Array(8);
const uBlur = new Float32Array(8);
const uFinal = new Float32Array(4 * 13);

let waveSrc = 'waveA';
let waveDst = 'waveB';
let colSrc = 'colA';
let colDst = 'colB';
let simAcc = 0;
let nextDrip = 1.2;
let nextFish = 4.5;
const rnd = Math.random;
const creature = new Creature();
const leaves = new Leaves();
let placed = false;

function stepWave(i: number, steps: number) {
  const k0 = i / steps;
  const k1 = (i + 1) / steps;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const moving = input.active && (input.x !== input.ax || input.y !== input.ay);
  const strength = moving ? Math.min(1.4, input.speed * 0.7) : 0;
  uWave.set([WW, WH, 1 / WW, 1 / WH], 0);
  uWave.set(
    [lerp(input.ax, input.x, k0), lerp(input.ay, input.y, k0), lerp(input.ax, input.x, k1), lerp(input.ay, input.y, k1)],
    4,
  );
  uWave.set([0.011, strength, 0.9955, W / H], 8);
  uWave.fill(0, 12);
  if (i === 0) {
    const ready = input.drops.filter((d) => !d.delay || d.delay <= 0).slice(0, 8);
    input.drops = input.drops.filter((d) => !ready.includes(d));
    ready.forEach((d, j) => uWave.set([d.x, d.y, d.r, d.s], 12 + j * 4));
  }
  be!.draw(simWave, waveDst, { 1: waveSrc }, uWave);
  [waveSrc, waveDst] = [waveDst, waveSrc];
}

// ---------------------------------------------------------------- loop
let last = 0;
let clock = T_OFFSET;
let fps = 60;
const state = { phase: 'still' as string };

function frame(now: number) {
  requestAnimationFrame(frame);
  if (last && now - last < 1000 / 60 - 2) return; // hold 60 fps on 120 Hz screens
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  fps += (1 / dt - fps) * 0.05;
  if (be!.lost()) return;
  const live = !paused && !FREEZE;
  if (live) clock += dt;
  if (W && dt < 0.1) adapt(dt);
  const t = clock;

  layout();
  const aspect = W / H;
  if (inkDirty && fontsReady) {
    ink.draw(W, H, frameRect());
    be!.upload('text', ink.canvas);
    inkDirty = false;
    haloDirty = true;
    home = boxOf(heading).centre;
    home.y += 0.04;
    if (!placed) {
      creature.place(home.x, home.y + 0.25);
      placed = true;
    }
    if (inkShownAt < 0) {
      inkShownAt = now;
      root.classList.add('gl');
    }
  }
  const inkAlpha = inkShownAt < 0 ? 0 : T_OFFSET ? 1 : Math.min(1, (now - inkShownAt) / 900);
  const arc = arcAt(t, disp.reducedMotion);
  state.phase = arc.phase;

  // the Lovecraft line follows the story (after the blackout, not during it)
  const ph = arc.phase as Phase;
  const wantQuote: Phase | null = LOVECRAFT[ph] && !(ph === 'aftermath' && arc.at < 25.5) ? ph : null;
  if (wantQuote !== quoteFor) {
    quoteAlpha = Math.max(0, quoteAlpha - dt * 2.2);
    if (quoteAlpha <= 0.001) {
      quoteFor = wantQuote;
      quote.innerHTML = wantQuote ? LOVECRAFT[wantQuote]! : '';
      inkDirty = true;
    }
  } else if (quoteFor) {
    quoteAlpha = Math.min(1, quoteAlpha + dt * 1.1);
  }

  // the surface heaves as the colour rises, and collapses when it's gone
  const cx = creature.x / aspect;
  const cy = creature.y;
  if (live && !disp.reducedMotion) {
    if (lastAt < 19.4 && arc.at >= 19.4) input.drops.push({ x: cx, y: cy, r: 0.07, s: -2.6 });
    if (lastAt < 23 && arc.at >= 23) input.drops.push({ x: cx, y: cy, r: 0.05, s: 3.2 });
  }
  lastAt = arc.at;

  // hover: which pigment is rising, and the story beneath the links
  const pig = (input.pigment as Pigment | null) ?? null;
  if (pig) {
    lastPigment = pig;
    setStory(pig);
  }
  hoverAmt += ((pig ? 1 : 0) - hoverAmt) * Math.min(1, dt * 5);
  storyAlpha += ((pig ? 1 : 0) - storyAlpha) * Math.min(1, dt * (pig ? 4 : 2));
  if (!pig && storyAlpha < 0.01 && storyFor) {
    storyFor = null;
    story.textContent = '';
    inkDirty = true;
  }
  BASE_ALPHA.forEach((a, i) => (INK_ALPHA[i] = a));
  INK_ALPHA[6] = BASE_ALPHA[6] * storyAlpha;
  INK_ALPHA[7] = BASE_ALPHA[7] * quoteAlpha;
  INK_ALPHA[8] = BASE_ALPHA[8] * quoteAlpha;

  // ambient life: drips from the willow, the odd rising fish
  if (live && !disp.reducedMotion) {
    if (t > nextDrip) {
      input.drops.push({ x: rnd() * 0.42, y: rnd() * 0.32, r: 0.0045, s: 0.55 });
      nextDrip = t + 0.9 + rnd() * 2.6;
    }
    if (t > nextFish) {
      input.drops.push({ x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8, r: 0.009, s: 0.9 });
      nextFish = t + 7 + rnd() * 10;
    }
  }

  // water
  for (const d of input.drops) if (d.delay) d.delay -= dt;
  if (live) {
    simAcc += dt;
    const steps = Math.min(4, Math.floor(simAcc * SIM_HZ));
    simAcc -= steps / SIM_HZ;
    if (steps >= 4) simAcc = 0;
    for (let i = 0; i < steps; i++) stepWave(i, steps);
  }

  // the colour
  const hovered = input.hover ? document.querySelector(`[data-ink="${input.hover}"]`) : null;
  const hbox = hovered ? boxOf(hovered) : null;
  if (live) {
    creature.radius = 0.11 * arc.size;
    const lure = arc.gather > 0.05 ? home : hbox ? { x: hbox.centre.x, y: hbox.centre.y + 0.03 } : null;
    creature.update(dt, t, input, aspect, home, lure);
    uColour.set([CW, CH, dt, t], 0);
    // at the cut the colour has poured away into the sky: flush its body
    const flush = arc.at >= 23 && arc.at < 23.4 ? 30 : 0.55;
    uColour.set([flush, 0.12, 0.035, aspect], 4);
    uColour.set([creature.x, creature.y, creature.radius, arc.intensity * (1 + arc.gather * 1.5)], 8);
    creature.lobeData(t, uColour, 12);
    uColour.set([...DYE[lastPigment], pig ? 1.1 : 0], 36);
    const pad = 0.012;
    const r = hbox?.uv ?? [0, 0, 0, 0];
    uColour.set([r[0] - pad, r[1] + (r[3] - r[1]) * 0.35, r[2] + pad, r[3] + pad * 2], 40);
    uColour.set([1.2, 0.55, 0.22, 1.1], 44);
    uColour.fill(0, 48);
    creature.blasts.forEach((b, i) => uColour.set([b.x, b.y, b.age, b.s], 48 + i * 4));
    be!.draw(simColour, colDst, { 1: colSrc, 3: waveSrc }, uColour);
    [colSrc, colDst] = [colDst, colSrc];
  }
  if (live) leaves.update(dt, arc, input, aspect, input.drops, disp.reducedMotion);
  input.advance(dt);

  // a soft halo grown from the words (only when they change)
  if (haloDirty) {
    const hw = Math.max(2, W >> 2);
    const hh = Math.max(2, H >> 2);
    const pass = (src: string, dst: string, sw: number, sh: number, dx: number, dy: number, mode: number) => {
      uBlur.set([hw, hh, 1 / sw, 1 / sh, dx, dy, mode, 0]);
      be!.draw(blur, dst, { 1: src }, uBlur);
    };
    pass('text', 'h1', W, H, 3, 0, 0);
    pass('h1', 'h2', hw, hh, 0, 1.6, 1);
    pass('h2', 'h1', hw, hh, 1.6, 0, 1);
    pass('h1', 'h2', hw, hh, 0, 1.6, 1);
    haloDirty = false;
  }

  // scene
  const moon = moonDir(aspect);
  uScene.set([SW, SH, t, aspect], 0);
  uScene.set([TAN_HALF, 1.6, 0.36, TAN_HALF / SH], 4);
  uScene.set([...moon, 0.018], 8);
  uScene.set([0.8, 0.22, 0.35, 0.011], 12);
  uScene.set([...INK, inkAlpha], 16);
  const baseHue = ((165 - 37 * arc.gather) * Math.PI) / 180;
  uScene.set([baseHue, 0.8, 0.3, 0.42 * GLOW_GAIN], 20);
  uScene.set([1.0 * GLOW_GAIN, 0.6, 0.35, 1.1 * (1 - arc.gather * 0.8)], 24);
  uScene.set([arc.glow * GLOW_GAIN, arc.grey, arc.crumble, arc.ash], 28);
  leaves.pack(arc, uScene, 32, 96);
  be!.draw(sceneShader, 'scene', { 1: waveSrc, 3: 'text', 5: 'h2', 7: colSrc }, uScene);

  // bloom
  let src = 'scene';
  let sw = SW;
  let sh = SH;
  bloomSizes.forEach(([w, h], i) => {
    uDown.set([1 / sw, 1 / sh, w, h, 0.55, i === 0 ? 1 : 0, 0, 0]);
    be!.draw(bloomDown, `d${i + 1}`, { 1: src }, uDown);
    src = `d${i + 1}`;
    sw = w;
    sh = h;
  });
  for (let i = 3; i >= 1; i--) {
    const [w, h] = bloomSizes[i - 1];
    const [lw, lh] = bloomSizes[i];
    uUp.set([1 / lw, 1 / lh, w, h, 1, 0, 0, 0]);
    be!.draw(bloomUp, `u${i}`, { 1: i === 3 ? 'd4' : `u${i + 1}`, 3: `d${i}` }, uUp);
  }

  // final
  uFinal.set([W, H, t, be!.flipY ? 1 : 0], 0);
  uFinal.set([be!.gamut === 'p3' ? 1 : 0, be!.hdr ? 1 : 0, PEAK, 1], 4);
  uFinal.set([...INK, 0.022], 8);
  uFinal.set([0.5, 1, 0.22, inkAlpha], 12);
  uFinal.set([...JET, 0], 16);
  uFinal.set(INK_ALPHA, 20);
  uFinal.set([input.hover, hoverAmt, 0, 0], 36);
  uFinal.set([...TINT[lastPigment], 0], 40);
  uFinal.set([arc.pour, cx, cy, POUR_GAIN], 44);
  uFinal.set([arc.desat, arc.exposure, arc.pour, POUR_HUE], 48);
  be!.draw(finalShader, null, { 1: 'scene', 3: 'u1', 5: waveSrc, 7: 'text', 9: 'h2' }, uFinal);
  be!.flush();

  if (!root.classList.contains('live')) root.classList.add('live');
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- introspection
const info = () => ({
  kind: be!.kind,
  hdr: be!.hdr,
  gamut: be!.gamut,
  display: disp,
  fps: Math.round(fps),
  phase: state.phase,
  t: Math.round(clock * 10) / 10,
  size: [W, H],
  scene: [SW, SH],
  scale,
  creature: [Math.round(creature.x * 100) / 100, Math.round(creature.y * 100) / 100, Math.round(creature.curiosity * 100) / 100],
});
Object.defineProperty(window, '__jet', { get: info });

if (DEBUG) {
  const hud = document.createElement('pre');
  hud.className = 'hud';
  document.body.append(hud);
  setInterval(() => (hud.textContent = JSON.stringify(info(), null, 1).replace(/[{}"]/g, '')), 500);
}

console.log(
  '%cjet.tf%c\nthe water is a wave equation, the words are drawn into it from the DOM, and the colour is not a colour.\nsource: https://github.com/lovelaced',
  'font: italic 20px serif',
  'font: 12px monospace; color: #8a8',
);
