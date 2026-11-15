// The DOM is the source of truth for every word on the page. This draws each
// [data-ink] element's text into a canvas at exactly its on-screen position,
// word by word, so the shader can render it *in the water* while the real DOM
// text stays selectable, focusable and readable by assistive tech.
//
// Channels (stored un-premultiplied): A = coverage, R = 1 wherever there's ink,
// G = id * 16 / 255. The shader recovers the id as G / R, which survives
// linear filtering at glyph edges.

export class Ink {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private range = document.createRange();

  constructor(private root: ParentNode = document) {}

  draw(width: number, height: number, frame: DOMRect): void {
    const c = this.canvas;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const sx = width / frame.width;
    const sy = height / frame.height;
    ctx.setTransform(sx, 0, 0, sy, -frame.left * sx, -frame.top * sy);
    ctx.textBaseline = 'alphabetic';
    ctx.fontKerning = 'normal';

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-ink]')) {
      const id = Number(el.dataset.ink);
      if (!id || id > 15) continue;
      ctx.fillStyle = `rgb(255 ${id * 16} 0)`;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        if (!parent) continue;
        const cs = getComputedStyle(parent);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
        const ascent = ctx.measureText('x').fontBoundingBoxAscent;
        const re = /\S+/g;
        for (let m = re.exec(node.data); m; m = re.exec(node.data)) {
          this.range.setStart(node, m.index);
          this.range.setEnd(node, m.index + m[0].length);
          const r = this.range.getClientRects()[0];
          if (r) ctx.fillText(m[0], r.left, r.top + ascent);
        }
      }
    }
  }
}
