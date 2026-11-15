// Pointer, touch and keyboard -> things that happen to the water.
// Positions are uv over the canvas (0..1, y down).

export interface Drop {
  x: number;
  y: number;
  /** radius in uv-height units */
  r: number;
  /** depth of the impulse */
  s: number;
  /** seconds to wait before it lands */
  delay?: number;
}

export class Input {
  x = 0.5;
  y = 0.5;
  /** position at the start of this frame's wake segment */
  ax = 0.5;
  ay = 0.5;
  /** pointer is over the page and (for touch) pressed */
  active = false;
  /** seconds since the pointer last moved */
  idle = 1e9;
  /** smoothed speed, uv-height units per second */
  speed = 0;
  drops: Drop[] = [];
  /** data-ink id of the hovered or focused link, 0 for none */
  hover = 0;
  /** pigment key of the hovered or focused element */
  pigment: string | null = null;

  private down: { x: number; y: number; t: number; id: number } | null = null;
  private moved = false;

  constructor(private frame: () => DOMRect) {
    addEventListener('pointermove', (e) => this.move(e), { passive: true });
    addEventListener('pointerdown', (e) => this.press(e), { passive: true });
    addEventListener('pointerup', (e) => this.release(e), { passive: true });
    addEventListener('pointercancel', () => (this.down = null));
    document.documentElement.addEventListener('pointerleave', () => (this.active = false));

    for (const el of document.querySelectorAll<HTMLElement>('[data-pigment]')) {
      const on = () => {
        this.hover = Number(el.dataset.ink) || 0;
        this.pigment = el.dataset.pigment ?? null;
      };
      const off = () => {
        if (this.hover === Number(el.dataset.ink)) {
          this.hover = 0;
          this.pigment = null;
        }
      };
      el.addEventListener('pointerenter', on);
      el.addEventListener('pointerleave', off);
      el.addEventListener('focus', on);
      el.addEventListener('blur', off);
    }
  }

  private uv(e: PointerEvent) {
    const f = this.frame();
    return { x: (e.clientX - f.left) / f.width, y: (e.clientY - f.top) / f.height };
  }

  private move(e: PointerEvent) {
    const p = this.uv(e);
    // touch only stirs the water while a finger is down
    if (e.pointerType === 'touch' && !this.down) return;
    if (!this.active) {
      this.ax = p.x;
      this.ay = p.y;
    }
    this.x = p.x;
    this.y = p.y;
    this.active = true;
    this.idle = 0;
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 10) this.moved = true;
  }

  private press(e: PointerEvent) {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    this.moved = false;
    if (e.pointerType === 'touch') {
      const p = this.uv(e);
      this.x = this.ax = p.x;
      this.y = this.ay = p.y;
      this.active = true;
      this.idle = 0;
    }
  }

  private release(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (e.pointerType === 'touch') this.active = false;
    if (!d || this.moved || performance.now() - d.t > 450) return;
    const target = e.target as Element | null;
    if (target?.closest('a, button, [data-pigment]')) return;
    const p = this.uv(e);
    // a stone leaves a train of rings: the plunge, the rebound, the splash-back
    this.drops.push({ x: p.x, y: p.y, r: 0.014, s: 2.4 });
    this.drops.push({ x: p.x, y: p.y, r: 0.008, s: -1.6, delay: 0.09 });
    this.drops.push({ x: p.x, y: p.y, r: 0.005, s: 1.1, delay: 0.2 });
    this.stones++;
  }

  /** number of stones dropped so far (the colour reacts to these) */
  stones = 0;

  /** Call once per frame after reading the wake segment. */
  advance(dt: number) {
    const dist = Math.hypot(this.x - this.ax, this.y - this.ay);
    this.speed += (dist / Math.max(dt, 1e-3) - this.speed) * Math.min(1, dt * 10);
    this.ax = this.x;
    this.ay = this.y;
    this.idle += dt;
  }
}
