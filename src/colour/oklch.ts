// OKLCH -> linear Display P3, matching src/shaders/common.wgsl.
export type Vec3 = [number, number, number];

export function oklabToLinearSrgb([L, a, b]: Vec3): Vec3 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707694997 * s,
  ];
}

export function linearSrgbToP3([r, g, b]: Vec3): Vec3 {
  return [
    0.8224621 * r + 0.177538 * g,
    0.0331941 * r + 0.9668058 * g,
    0.0170827 * r + 0.0723974 * g + 0.9105199 * b,
  ];
}

/** OKLCH (L 0..1, C, hue in degrees) -> linear P3. May be out of gamut. */
export function oklch(L: number, C: number, hDeg: number): Vec3 {
  const h = (hDeg * Math.PI) / 180;
  return linearSrgbToP3(oklabToLinearSrgb([L, C * Math.cos(h), C * Math.sin(h)]));
}

const encode = (x: number) => {
  const a = Math.min(1, Math.max(0, x));
  return a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055;
};

/** linear P3 -> CSS `color(display-p3 …)`, clipped to the gamut. */
export function cssP3([r, g, b]: Vec3, alpha = 1): string {
  const f = (x: number) => encode(x).toFixed(4);
  return `color(display-p3 ${f(r)} ${f(g)} ${f(b)}${alpha < 1 ? ` / ${alpha}` : ''})`;
}
