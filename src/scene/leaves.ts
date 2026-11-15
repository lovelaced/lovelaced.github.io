// Willow leaves: they glow in the bloom, then fall one by one as the blight
// takes the tree. Each lands with a small ring, drifts on the current, gets
// nudged by your wake and by stones, and finally crumbles to ash.
// Positions are uv (0..1, y down); the shader draws them in floating().
import type { ArcState } from './arc.ts';
import type { Drop, Input } from './input.ts';

const MAX = 16;
const FALL = 0.9;

interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  spin: number;
  len: number;
  curve: number;
  /** cycle time the leaf let go */
  born: number;
  landed: boolean;
  /** seconds after landing before it starts to crumble */
  life: number;
  age: number;
}

/** cycle seconds at which a leaf lets go: a few glowing ones, then the blight */
const SCHEDULE = [8.6, 10.2, 11.8, 13.4, 14.1, 14.7, 15.2, 15.8, 16.3, 16.7, 17.2, 17.6, 24.5, 27.0];

export class Leaves {
  private leaves: Leaf[] = [];
  private nextIdx = 0;
  private lastAt = 0;
  private stones = 0;

  update(dt: number, arc: ArcState, input: Input, aspect: number, drops: Drop[], reducedMotion: boolean) {
    const at = arc.at;
    if (at < this.lastAt) {
      // a new cycle: the tree has healed, the water is clear
      this.leaves.length = 0;
      this.nextIdx = 0;
    }
    this.lastAt = at;
    if (reducedMotion) return;

    while (this.nextIdx < SCHEDULE.length && at >= SCHEDULE[this.nextIdx]) {
      if (this.leaves.length < MAX) this.leaves.push(this.spawn(at, aspect));
      this.nextIdx++;
    }

    const moved = input.active && input.speed > 0.15;
    const stone = input.stones !== this.stones;
    this.stones = input.stones;

    for (const l of this.leaves) {
      const k = (at - l.born) / FALL;
      if (!l.landed && k >= 1) {
        l.landed = true;
        drops.push({ x: l.x, y: l.y, r: 0.0045, s: 0.42 });
      }
      if (!l.landed) {
        // a falling leaf flutters sideways as it comes down
        l.x += Math.sin(at * 7 + l.born) * 0.012 * dt;
        l.a += l.spin * 3 * dt;
        continue;
      }
      l.age += dt;
      // the canal's slow current, plus a little wander
      l.vx += (0.006 - l.vx) * dt * 0.5 + Math.sin(at * 0.3 + l.born * 5) * 0.0015 * dt;
      l.vy += (0.0025 - l.vy) * dt * 0.5;
      // your wake pushes leaves along with it
      if (moved) {
        const dx = (l.x - input.x) * aspect;
        const dy = l.y - input.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.07) {
          const f = (1 - d / 0.07) * Math.min(input.speed, 2) * 0.08;
          l.vx += ((input.x - input.ax) / Math.max(dt, 1e-3)) * f * dt * 4;
          l.vy += ((input.y - input.ay) / Math.max(dt, 1e-3)) * f * dt * 4;
          l.spin += (Math.random() - 0.5) * f * 2;
        }
      }
      // stones push them outward
      if (stone) {
        const dx = (l.x - input.x) * aspect;
        const dy = l.y - input.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.3) {
          const f = (1 - d / 0.3) * 0.12;
          l.vx += (dx / Math.max(d, 1e-3)) * f / aspect;
          l.vy += (dy / Math.max(d, 1e-3)) * f;
          l.spin += (Math.random() - 0.5) * 1.5;
        }
      }
      l.vx *= 1 - dt * 0.6;
      l.vy *= 1 - dt * 0.6;
      l.spin *= 1 - dt * 0.8;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.a += l.spin * dt;
    }
    this.leaves = this.leaves.filter((l) => this.crumble(l, arc) < 1 && l.x > -0.05 && l.x < 1.05 && l.y < 1.05);
  }

  private crumble(l: Leaf, arc: ArcState) {
    const own = l.landed ? Math.max(0, (l.age - l.life) / 3) : 0;
    // leaves that fell glowing in the bloom go when the blight comes
    return Math.min(1, Math.max(own, l.born < 13 ? arc.crumble * 1.1 : 0));
  }

  private spawn(at: number, aspect: number): Leaf {
    // under the willow, which overhangs the top-left
    const u = Math.random();
    const v = Math.random();
    const x = 0.03 + Math.pow(u, 1.4) * Math.min(0.42, 0.42 / Math.max(aspect, 0.6));
    const y = 0.03 + Math.pow(v, 1.3) * 0.42;
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      a: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.6,
      len: 0.026 + Math.random() * 0.016,
      curve: (Math.random() - 0.5) * 0.5,
      born: at,
      landed: false,
      life: 2.5 + Math.random() * 3,
      age: 0,
    };
  }

  /**
   * Pack into two vec4 arrays:
   *   a[i] = x, y (uv), angle, length (uv-height, 0 = unused)
   *   b[i] = fall scale, alpha, curve, crumble
   */
  pack(arc: ArcState, out: Float32Array, offA: number, offB: number) {
    out.fill(0, offA, offA + MAX * 4);
    out.fill(0, offB, offB + MAX * 4);
    this.leaves.forEach((l, i) => {
      const k = Math.min(1, (arc.at - l.born) / FALL);
      const scale = 1 + 0.9 * (1 - k) * (1 - k);
      const alpha = Math.sqrt(Math.max(0, k));
      out.set([l.x, l.y, l.a, l.len], offA + i * 4);
      out.set([scale, alpha, l.curve, this.crumble(l, arc)], offB + i * 4);
    });
  }
}
