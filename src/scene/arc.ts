// The story, compressed for people who won't stay long. One cycle:
//   still 0-2 · welling 2-7 · bloom 7-13 · blight 13-18 · pour 18-23 ·
//   (cut) · aftermath 23-40 · healing 40-62 · living 62-90, then again.
// Every value here is a plain number the shaders read as uniforms.
import type { Phase } from '../content.ts';

export const CYCLE = 90;

export interface ArcState {
  phase: Phase | 'living';
  /** seconds into the cycle */
  at: number;
  /** emission of the colour (before HDR scaling) */
  intensity: number;
  /** vegetation glowing with pigment (0..1) */
  glow: number;
  /** vegetation greying (0..1) */
  grey: number;
  /** vegetation breaking up into flakes (0..1) */
  crumble: number;
  /** the colour gathering into one point before the pour (0..1) */
  gather: number;
  /** the colour filling the frame (0..1) */
  pour: number;
  /** grey ash on the water after the cut (0..1) */
  ash: number;
  /** creature size multiplier */
  size: number;
  /** whole-frame greying after the cut (0..1) */
  desat: number;
  /** whole-frame exposure: the blackout after the cut, for the afterimage */
  exposure: number;
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function arcAt(t: number, reducedMotion = false): ArcState {
  const at = ((t % CYCLE) + CYCLE) % CYCLE;
  if (reducedMotion) {
    // no story, no pour: the colour simply lives under the words
    return { phase: 'living', at, intensity: 0.75 * ss(1, 4, t), glow: 0.4, grey: 0, crumble: 0, gather: 0, pour: 0, ash: 0, size: 1, desat: 0, exposure: 1 };
  }
  const phase: ArcState['phase'] =
    at < 2 ? 'still'
    : at < 7 ? 'welling'
    : at < 13 ? 'bloom'
    : at < 18 ? 'blight'
    : at < 23 ? 'pour'
    : at < 40 ? 'aftermath'
    : at < 62 ? 'healing'
    : 'living';

  const welling = ss(2, 6.5, at);
  const bloom = ss(7, 11, at);
  const cut = at >= 23 ? 1 : 0;
  const heal = ss(40, 60, at);
  const pourUp = ss(19.4, 20.6, at) * (1 - cut);

  // the living state eases out at the end of the cycle so the next welling is fresh
  const ebb = 1 - ss(84, 90, at);
  let intensity = 0.7 * welling + 0.3 * bloom + 0.35 * ss(13, 18, at) + 0.6 * ss(18, 19.5, at);
  if (cut) intensity = (0.22 + 0.5 * heal) * ebb;

  const glow = cut ? 0.35 * heal * ebb : ss(7, 11.5, at);
  const grey = cut ? 1 - heal : ss(13, 16.5, at);
  const crumble = cut ? 1 - ss(44, 60, at) : ss(15, 18, at);
  const gather = cut ? 0 : ss(17.5, 19.6, at);
  const ash = cut ? 1 - ss(30, 48, at) : 0;
  const size = cut ? 0.45 + 0.55 * heal : 1 + 0.35 * bloom - 0.85 * gather;

  const desat = cut ? 0.82 * (1 - ss(36, 58, at)) : 0;
  const exposure = cut ? 0.05 + 0.95 * ss(25.2, 28.5, at) : 1;

  return { phase, at, intensity, glow, grey, crumble, gather, pour: pourUp, ash, size, desat, exposure };
}
