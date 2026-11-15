// Shared colour maths. Everything renders in *linear Display P3*.
// Output: convert to the canvas colour space, gamut-map, tone-map toward the
// display peak, then apply the (extended) sRGB transfer curve.

const P3_TO_SRGB = mat3x3f(
  vec3f( 1.2249401, -0.0420569, -0.0196376),
  vec3f(-0.2249404,  1.0420571, -0.0786361),
  vec3f( 0.0000000,  0.0000000,  1.0982735),
);
const SRGB_TO_P3 = mat3x3f(
  vec3f(0.8224621, 0.0331941, 0.0170827),
  vec3f(0.1775380, 0.9668058, 0.0723974),
  vec3f(0.0000000, 0.0000000, 0.9105199),
);

// OKLab from linear sRGB (Björn Ottosson). We go P3 -> sRGB(linear, unclamped) -> OKLab.
fn lsrgb_to_oklab(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = sign(l) * pow(abs(l), 1.0 / 3.0);
  let m_ = sign(m) * pow(abs(m), 1.0 / 3.0);
  let s_ = sign(s) * pow(abs(s), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  );
}

fn oklab_to_lsrgb(c: vec3f) -> vec3f {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076949978 * s,
  );
}

fn p3_to_oklab(c: vec3f) -> vec3f { return lsrgb_to_oklab(P3_TO_SRGB * c); }
fn oklab_to_p3(c: vec3f) -> vec3f { return SRGB_TO_P3 * oklab_to_lsrgb(c); }

/** OKLCH (L 0..1, C, h radians) -> linear P3 (may be out of gamut) */
fn oklch(l: f32, c: f32, h: f32) -> vec3f {
  return oklab_to_p3(vec3f(l, c * cos(h), c * sin(h)));
}

/** Extended sRGB transfer curve (mirrored for negatives). */
fn srgb_oetf(c: vec3f) -> vec3f {
  let a = abs(c);
  let lo = a * 12.92;
  let hi = 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055;
  return sign(c) * select(hi, lo, a <= vec3f(0.0031308));
}

/**
 * Pull a linear colour into the [0, peak] cube by reducing OKLab chroma at
 * constant lightness and hue (no hue shifts, unlike per-channel clipping).
 */
fn gamut_map(c: vec3f, peak: f32) -> vec3f {
  let lo = min(c.r, min(c.g, c.b));
  let hi = max(c.r, max(c.g, c.b));
  if (lo >= 0.0 && hi <= peak) { return c; }
  let lab = lsrgb_to_oklab(c);
  // grey of equal lightness, already clamped to the cube
  let grey = clamp(oklab_to_lsrgb(vec3f(lab.x, 0.0, 0.0)), vec3f(0.0), vec3f(peak));
  // binary search the largest chroma fraction that stays inside
  var t0 = 0.0;
  var t1 = 1.0;
  for (var i = 0; i < 8; i++) {
    let t = 0.5 * (t0 + t1);
    let q = mix(grey, c, t);
    let ok = min(q.r, min(q.g, q.b)) >= 0.0 && max(q.r, max(q.g, q.b)) <= peak;
    if (ok) { t0 = t; } else { t1 = t; }
  }
  return mix(grey, c, t0);
}

/** Hue-preserving soft shoulder toward `peak`, C1 at the knee. */
fn shoulder(c: vec3f, peak: f32, knee: f32) -> vec3f {
  let m = max(c.r, max(c.g, c.b));
  if (m <= knee) { return c; }
  let r = peak - knee;
  return c * ((knee + r * (1.0 - exp(-(m - knee) / r))) / m);
}

/**
 * linear P3 scene colour -> encoded canvas value.
 * gamut: 0 = sRGB canvas, 1 = P3 canvas.  peak: 1.0 SDR, >1 HDR headroom.
 */
fn present(p3: vec3f, gamut: f32, peak: f32) -> vec3f {
  var c = max(p3, vec3f(-1.0));
  c = shoulder(c, peak, peak * 0.7);
  if (gamut < 0.5) {
    c = gamut_map(P3_TO_SRGB * c, peak);
  } else {
    c = gamut_map(c, peak);
  }
  return srgb_oetf(c);
}

/** Interleaved gradient noise, for dithering the final 8 bits. */
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
