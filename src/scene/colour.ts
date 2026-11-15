// The colour out of space, as a creature. It lives under the words, it gets
// curious about a cursor that holds still, it shies from fast movement, and it
// scatters when a stone lands near it. All positions are p-space: uv scaled so
// x runs 0..aspect and y runs 0..1 (distances are isotropic).
import type { Input } from './input.ts';

interface Lobe {
  phase: number;
  speed: number;
  reach: number;
  r: number;
}

export interface Target {
  x: number;
  y: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Creature {
  x = 0.5;
  y = 0.6;
  vx = 0;
  vy = 0;
  /** 0 calm, 1 freshly scattered */
  scatter = 0;
  /** 0 indifferent, 1 fascinated by the cursor */
  curiosity = 0;
  radius = 0.11;
  private lobes: Lobe[];
  private seenStones = 0;
  blasts: { x: number; y: number; age: number; s: number }[] = [];

  constructor(seed = Math.random()) {
    this.lobes = Array.from({ length: 6 }, (_, i) => ({
      phase: seed * 10 + i * 1.7,
      speed: 0.15 + ((i * 0.37 + seed) % 1) * 0.35 * (i % 2 ? 1 : -1),
      reach: 0.25 + ((i * 0.61 + seed * 3) % 1) * 0.75,
      r: 0.035 + ((i * 0.29 + seed * 7) % 1) * 0.04,
    }));
  }

  place(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  update(dt: number, t: number, input: Input, aspect: number, home: Target, lure: Target | null) {
    const px = input.x * aspect;
    const py = input.y;
    const dx = px - this.x;
    const dy = py - this.y;
    const dist = Math.hypot(dx, dy);

    // curiosity builds while the cursor rests, collapses when it darts about
    const resting = input.active ? smooth(0.25, 2.2, input.idle) : 0;
    const darting = smooth(0.8, 2.5, input.speed);
    this.curiosity += ((resting * (1 - darting)) - this.curiosity) * Math.min(1, dt * (resting > this.curiosity ? 0.6 : 2.5));

    let tx = home.x;
    let ty = home.y;
    let k = 0.9;
    if (lure) {
      tx = lure.x;
      ty = lure.y;
      k = 2.2;
    } else if (this.curiosity > 0.01) {
      // approach, but stop just short of the cursor, circling a little
      const stop = 0.06 + 0.05 * Math.sin(t * 0.7);
      const f = Math.max(0, 1 - stop / Math.max(dist, 1e-3)) * this.curiosity * 0.95;
      tx = this.x + dx * f + (home.x - this.x) * (1 - this.curiosity) * 0.3;
      ty = this.y + dy * f + (home.y - this.y) * (1 - this.curiosity) * 0.3;
      k = 0.5 + this.curiosity * 0.9;
    }

    // a slow wander so it never sits perfectly still
    tx += Math.sin(t * 0.23 + 1.3) * 0.03 + Math.sin(t * 0.61) * 0.012;
    ty += Math.cos(t * 0.19 + 0.4) * 0.025 + Math.sin(t * 0.47 + 2.0) * 0.01;

    let ax = (tx - this.x) * k - this.vx * 1.7;
    let ay = (ty - this.y) * k - this.vy * 1.7;

    // shy: a fast cursor nearby pushes it away
    if (input.active && darting > 0 && dist < 0.3) {
      const push = darting * (1 - dist / 0.3) * 1.6;
      ax -= (dx / Math.max(dist, 1e-3)) * push;
      ay -= (dy / Math.max(dist, 1e-3)) * push;
    }

    // stones
    if (input.stones !== this.seenStones) {
      this.seenStones = input.stones;
      const sx = input.x * aspect;
      const sy = input.y;
      this.blasts.unshift({ x: sx, y: sy, age: 0, s: 0.9 });
      this.blasts.length = Math.min(this.blasts.length, 4);
      const sd = Math.hypot(this.x - sx, this.y - sy);
      if (sd < 0.4) {
        this.scatter = Math.min(1, this.scatter + (1 - sd / 0.4));
        const away = 0.5 * (1 - sd / 0.4);
        this.vx += ((this.x - sx) / Math.max(sd, 1e-3)) * away;
        this.vy += ((this.y - sy) / Math.max(sd, 1e-3)) * away;
      }
    }
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < 2.5);
    this.scatter = Math.max(0, this.scatter - dt * 0.45);

    this.vx += ax * dt;
    this.vy += ay * dt;
    const sp = Math.hypot(this.vx, this.vy);
    const max = 0.45;
    if (sp > max) {
      this.vx *= max / sp;
      this.vy *= max / sp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = Math.min(aspect - 0.02, Math.max(0.02, this.x));
    this.y = Math.min(0.98, Math.max(0.02, this.y));
  }

  /** Six lobes as vec4 (x, y, radius, strength) in p-space. */
  lobeData(t: number, out: Float32Array, offset: number) {
    const spread = 1 + this.scatter * 2.8;
    const pull = 1 - this.scatter * 0.6;
    this.lobes.forEach((l, i) => {
      const a = l.phase + t * l.speed + Math.sin(t * 0.3 + i) * 0.6;
      const reach = this.radius * l.reach * spread * (0.75 + 0.25 * Math.sin(t * 0.9 + l.phase));
      out.set(
        [this.x + Math.cos(a) * reach, this.y + Math.sin(a) * reach * 0.8, l.r * (1 + this.scatter * 0.5), pull],
        offset + i * 4,
      );
    });
  }
}
