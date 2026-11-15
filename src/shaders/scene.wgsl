// The well: looking straight down at still canal water at night.
// Everything above the surface exists only as a reflection.
// Output is linear Display P3, unbounded (HDR); the final pass tone-maps.
// #include "common.wgsl"
// #include "noise.wgsl"

struct U {
  res: vec4f,    // w, h, time, aspect (w/h)
  cam: vec4f,    // x tan(vfov/2), y normal strength, z reflectance, w sky units per pixel
  moon: vec4f,   // xyz direction, w angular radius
  look: vec4f,   // x mist, y text glow, z silt, w glow radius (uv y)
  inkc: vec4f,   // ink colour (linear P3), w ink master alpha
  colr: vec4f,   // the colour: x base hue (rad), y OKLab L, z chroma, w intensity
  colr2: vec4f,  // x dye gain, y silt glow, z mist glow, w hue spread (rad)
  veg: vec4f,    // x glow, y grey, z crumble, w ash
  leaf_a: array<vec4f, 16>,  // falling willow leaves: x, y (uv), angle, length (0 = none)
  leaf_b: array<vec4f, 16>,  // fall scale, alpha, curve, crumble
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var wave: texture_2d<f32>;
@group(0) @binding(2) var wave_s: sampler;
@group(0) @binding(3) var text: texture_2d<f32>;
@group(0) @binding(4) var text_s: sampler;
@group(0) @binding(5) var halo_t: texture_2d<f32>;
@group(0) @binding(6) var halo_s: sampler;
@group(0) @binding(7) var field: texture_2d<f32>;
@group(0) @binding(8) var field_s: sampler;

const UP = vec3f(0.0, 0.0, 1.0);

fn view_ray(uv: vec2f) -> vec3f {
  let s = (uv - 0.5) * 2.0 * u.cam.x;
  return normalize(vec3f(s.x * u.res.w, -s.y, -1.0));
}

/** Stereographic coordinates of a sky direction (zenith = origin). */
fn sky_coord(r: vec3f) -> vec2f {
  return r.xy / (1.0 + max(r.z, 0.0));
}

fn stars(sp: vec2f, px: f32, t: f32) -> vec3f {
  var acc = vec3f(0.0);
  for (var layer = 0; layer < 3; layer++) {
    let fl = f32(layer);
    let scale = 55.0 + fl * 65.0;
    let g = sp * scale + fl * 13.7;
    let cell = floor(g);
    let h = hash22(cell + fl * 31.7);
    let pos = cell + 0.2 + 0.6 * h;
    let b = hash12(cell * 1.31 + fl * 7.7);
    let mag = pow(b, 30.0 + fl * 40.0) * (1.8 - fl * 0.7);
    let dpx = length(g - pos) / (px * scale);
    let size = 0.65 + 0.8 * sqrt(mag);
    let tw = 0.72 + 0.28 * sin(t * (1.1 + 2.7 * h.x) + h.y * 6.283);
    let tint = mix(vec3f(1.0, 0.84, 0.70), vec3f(0.72, 0.84, 1.0), h.y);
    acc += tint * mag * tw * exp(-dpx * dpx / (size * size));
  }
  return acc;
}

/**
 * Willow over the top-left corner. Its canopy is a lacy disc just beyond the
 * corner; its hanging strands are vertical, so in the reflection they point
 * at the zenith (the middle of the frame) and sway at their tips.
 * Returns x = silhouette, y = how leafy this spot is (for the glow).
 */
fn willow(sp: vec2f, corner: vec2f, t: f32, px: f32) -> vec2f {
  let ext = min(abs(corner.x), abs(corner.y));
  let cen = corner * 1.04;
  let rad = ext * 0.80;
  let q = sp + vec2f(sin(t * 0.21), cos(t * 0.17)) * ext * 0.006;
  let bare = u.veg.z;

  let lace = fbm(q / ext * 9.0) - 0.5;
  let edge = (length(q - cen) - rad) / ext + lace * 0.35;
  let body = smoothstep(px * 2.0 / ext, -px * 2.0 / ext, edge);
  let holes = smoothstep(0.58 - bare * 0.22, 0.70 - bare * 0.2, fbm(q / ext * 22.0 + 3.0));
  var m = body * (1.0 - holes * 0.85);
  var leafy = body * (1.0 - holes);

  // strands: polar about the zenith, starting where each ray enters the canopy
  let r = length(q);
  let th = atan2(q.y, q.x);
  let cl = length(cen);
  let thc = atan2(cen.y, cen.x);
  for (var layer = 0; layer < 2; layer++) {
    let n = 130.0 + f32(layer) * 90.0;
    let k = floor(th * n);
    let h = hash22(vec2f(k, f32(layer) * 7.0));
    let th_k = (k + 0.5 + (h.x - 0.5) * 0.6) / n;
    let dth = th_k - thc;
    let disc = rad * rad - cl * cl * sin(dth) * sin(dth);
    if (disc > 0.0 && h.y > 0.35) {
      let r_in = cl * cos(dth) - sqrt(disc);
      let len = rad * (0.2 + 0.6 * hash12(vec2f(k, 3.0 + f32(layer)))) * (1.0 - bare * 0.7);
      let along = (r_in - r) / max(len, 1e-4);
      let sway = sin(t * 0.6 + h.x * 6.283) * 0.002 * max(along, 0.0);
      let off = abs(th - th_k - sway) * r;
      let bead = 0.5 + 0.5 * sin(r / ext * 150.0 + h.x * 40.0);
      let w = max(ext * (0.0022 + 0.0022 * bead) * (1.0 - 0.5 * clamp(along, 0.0, 1.0)), px * 0.9);
      let strand = smoothstep(w + px, w - px * 0.5, off) * step(0.0, along) * smoothstep(1.0, 0.75, along);
      m = max(m, strand * 0.9);
      leafy = max(leafy, strand * bead);
    }
  }
  return vec2f(m, leafy);
}

/** Wind on the water: drifting micro-ripples, gusting in patches. Returns a slope. */
fn breeze(uv: vec2f, asp: f32, t: f32) -> vec2f {
  let p = uv * vec2f(asp, 1.0);
  let gust = smoothstep(0.42, 0.85, fbm3(p * 1.4 + vec2f(t * 0.045, t * 0.018)));
  let e = 0.0025;
  let f = vec2f(t * 0.22, t * 0.07);
  let a0 = vnoise(p * 38.0 + f) + 0.3 * vnoise(p * 71.0 - f * 1.3);
  let ax = vnoise((p + vec2f(e, 0.0)) * 38.0 + f) + 0.3 * vnoise((p + vec2f(e, 0.0)) * 71.0 - f * 1.3);
  let ay = vnoise((p + vec2f(0.0, e)) * 38.0 + f) + 0.3 * vnoise((p + vec2f(0.0, e)) * 71.0 - f * 1.3);
  return vec2f(ax - a0, ay - a0) / e * 0.000010 * (0.25 + 2.4 * gust);
}

fn rot2(a: f32) -> mat2x2f {
  return mat2x2f(cos(a), sin(a), -sin(a), cos(a));
}

/**
 * What floats on the surface: willow leaves that have fallen, a few loosestrife
 * petals adrift, and (after the pour) ash.
 * Returns premultiplied colour + coverage. Glow is emission in pigment hues.
 */
fn floating(uv: vec2f, g: vec2f, t: f32, asp: f32) -> vec4f {
  let p = uv * vec2f(asp, 1.0) + g * 0.0035;
  let glow = u.veg.x;
  let grey = u.veg.y;
  let crumble = u.veg.z;
  let ashc = vec3f(0.016, 0.0155, 0.015);
  var acc = vec4f(0.0);

  // willow leaves that have fallen onto the water
  let pxs = 1.5 / u.res.y;
  for (var i = 0; i < 16; i++) {
    let la = u.leaf_a[i];
    if (la.w <= 0.0) { continue; }
    let lb = u.leaf_b[i];
    let len = la.w * lb.x;
    let lc = la.xy * vec2f(asp, 1.0);
    let rel = p - lc;
    if (dot(rel, rel) > len * len) { continue; }
    var q = rot2(-la.z) * rel;
    let x = q.x / len;                                   // -0.5 .. 0.5 along the leaf
    q.y -= lb.z * len * (x * x - 0.25);                  // a gentle curl
    let w = len * 0.105 * pow(max(0.0, 1.0 - 4.0 * x * x), 0.75);
    var a = smoothstep(pxs, -pxs, abs(q.y) - w) * step(abs(x), 0.5) * lb.y;
    // crumbling: the leaf breaks up from its edges into ash
    let n = vnoise(q / len * 9.0 + f32(i) * 7.3);
    a *= 1.0 - smoothstep(n - 0.15, n + 0.05, lb.w * 1.2 - 0.1 + abs(q.y) / max(w, 1e-4) * 0.3);
    let rib = smoothstep(pxs * 0.8, 0.0, abs(q.y)) * 0.6;
    let lit = vec3f(0.0045, 0.0085, 0.0035) * (1.0 + rib);
    let ash_mix = max(grey, lb.w);
    let base = mix(lit, ashc * (1.0 + rib * 0.5), ash_mix);
    let em = oklch(0.78, 0.22, 2.3 + f32(i) * 0.07) * glow * (1.0 - ash_mix) * (0.7 + 0.5 * rib);
    acc += vec4f((base + em) * a, a) * (1.0 - acc.a);
  }

  // loosestrife petals adrift
  {
    let pd2 = p + vec2f(t * 0.006, -t * 0.002) + vec2f(sin(t * 0.13 + p.y * 3.0), cos(t * 0.11 + p.x * 2.0)) * 0.01;
    let q = pd2 * 8.5;
    let cell = floor(q);
    let h = hash22(cell + 5.5);
    let k = hash12(cell + 9.9);
    let e = rot2(h.x * 6.283 + t * 0.05 * (h.y - 0.5)) * (fract(q) - 0.5 - (h - 0.5) * 0.6);
    let r = length(e / vec2f(0.085, 0.036));
    var a = smoothstep(1.0, 0.7, r) * step(0.965, k);
    a *= 1.0 - smoothstep(0.2, 0.9, crumble + (k - 0.93) * 4.0) * step(0.01, crumble);
    let base = mix(vec3f(0.018, 0.004, 0.022), ashc, grey);
    let em = oklch(0.56, 0.28, 5.45) * glow * (1.0 - grey) * 0.75;
    acc += vec4f((base + em) * a, a) * (1.0 - acc.a);
  }

  // ash: grey flakes drifting in patches after the colour has gone
  if (u.veg.w > 0.001) {
    let pa = p + vec2f(t * 0.004, t * 0.0025);
    let ash_patch = smoothstep(0.42, 0.68, fbm3(pa * 3.2 + 9.0)) * u.veg.w;
    for (var layer = 0; layer < 2; layer++) {
      let lf = f32(layer);
      let q = (rot2(0.7 + lf) * pa) * (34.0 + lf * 46.0);
      let cell = floor(q);
      let h = hash22(cell + 2.2 + lf * 5.0);
      let k = hash12(cell + 4.4 + lf * 2.0);
      let e = rot2(h.x * 6.283) * (fract(q) - 0.5 - (h - 0.5) * 0.6);
      let n = vnoise(e * 9.0 + h * 40.0);
      let sz = 0.18 + 0.14 * h.y;
      let a = smoothstep(sz, sz * 0.7, length(e * vec2f(1.0, 1.7)) - n * 0.08) * step(1.0 - ash_patch * 0.8, k);
      acc += vec4f(ashc * (0.6 + 0.9 * h.y) * a, a * 0.8) * (1.0 - acc.a);
    }
  }
  return acc;
}

fn sky(r: vec3f, px: f32, t: f32) -> vec3f {
  let sp = sky_coord(r);
  // night gradient: brighter toward the horizon, a breath of sodium light low down
  var c = mix(vec3f(0.0105, 0.0100, 0.0125), vec3f(0.0024, 0.0034, 0.0078), smoothstep(0.55, 1.0, r.z));

  // towns beyond the hedges: a faint warm skyglow low down
  c += vec3f(0.017, 0.0105, 0.0058) * smoothstep(0.985, 0.78, r.z);

  // the moon
  let ca = clamp(dot(r, u.moon.xyz), -1.0, 1.0);
  let ang = acos(ca);
  let mr = u.moon.w;
  let apx = px * 2.0;
  let disc = smoothstep(mr + apx, mr - apx, ang);
  let local = (r - u.moon.xyz * ca) / mr;
  let maria = fbm3(local.xy * 2.6 + vec2f(4.0, 1.0));
  let moon_c = vec3f(1.0, 0.95, 0.86) * (1.6 - 0.55 * smoothstep(0.42, 0.68, maria));
  let halo = vec3f(0.55, 0.62, 0.82) * (0.07 * exp(-ang / 0.045) + 0.034 * exp(-ang / 0.32));

  // thin cloud passing across
  let cl = fbm(sp * vec2f(4.5, 7.5) + vec2f(t * 0.0055, t * 0.0018));
  let cloud = smoothstep(0.42, 0.80, cl) * 0.85;

  var st = stars(sp, px, t) * (1.0 - cloud) * (1.0 - smoothstep(0.25, 0.0, ang) * 0.9);
  c += st + halo * (1.0 + cloud * 2.5) + cloud * vec3f(0.0055, 0.0050, 0.0058);
  c = mix(c, moon_c, disc * (1.0 - cloud * 0.6));

  // willow silhouette
  let corner = sky_coord(reflect(view_ray(vec2f(0.0, 0.0)), UP));
  let wt = willow(sp, corner, t, px);
  let tree = wt.x;
  // "a dim though distinct luminosity": single leaves catch a poison-green light
  let ext = min(abs(corner.x), abs(corner.y));
  let glint = smoothstep(0.56, 0.82, fbm(sp / ext * 38.0 + vec2f(t * 0.12, -t * 0.05)));
  let leaf_hue = 2.25 + 0.45 * fbm3(sp / ext * 4.0 - t * 0.02);
  let wem = oklch(0.78, 0.2, leaf_hue) * u.veg.x * (1.0 - u.veg.y) * wt.y * (0.04 + 0.9 * glint * glint);
  let wash = vec3f(0.0035) * u.veg.y * (1.0 - u.veg.z) * wt.y;
  c = mix(c, vec3f(0.0007, 0.0010, 0.0008) + halo * 0.08, tree) + wem + wash;
  return c;
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.res.xy;
  let t = u.res.z;
  let asp = u.res.w;
  let px = u.cam.w;

  let w = textureSampleLevel(wave, wave_s, uv, 0.0);
  let g = w.zw * u.cam.y + breeze(uv, asp, t);
  let n = normalize(vec3f(-g.x, g.y, 1.0));
  let v = view_ray(uv);
  let r = reflect(v, n);

  // surface curvature focuses light coming up from below (cheap caustics)
  let e = vec2f(1.0 / u.res.x, 1.0 / u.res.y) * 2.0;
  let div = textureSampleLevel(wave, wave_s, uv + vec2f(e.x, 0.0), 0.0).z
          - textureSampleLevel(wave, wave_s, uv - vec2f(e.x, 0.0), 0.0).z
          + textureSampleLevel(wave, wave_s, uv + vec2f(0.0, e.y), 0.0).w
          - textureSampleLevel(wave, wave_s, uv - vec2f(0.0, e.y), 0.0).w;
  let focus = clamp(1.0 - div * u.cam.y * 6.0, 0.25, 3.0);

  // under the surface: the colour, murk, silt, the words
  let hp = uv * vec2f(asp, 1.0);
  let warp = vec2f(fbm3(hp * 2.7 + vec2f(t * 0.06, 0.0)), fbm3(hp * 2.7 + vec2f(5.2, -t * 0.05)));
  // tendrils: read the body through a slowly churning warp
  let cf = textureSampleLevel(field, field_s, uv - g * 0.03 + (warp - 0.5) * vec2f(0.03 / asp, 0.03), 0.0);
  // veins: ridged noise, thin bright filaments through the body
  let rn = fbm(hp * 6.0 + warp * 2.4 - vec2f(0.0, t * 0.06));
  let vein = pow(1.0 - abs(2.0 * rn - 1.0), 4.0);
  // isoluminant: lightness is fixed and only hue moves, in bands too fine to
  // settle on, so its borders shimmer and it never resolves into one colour
  let band = fbm3(hp * 13.0 + warp * 3.0 + vec2f(t * 0.11, -t * 0.07));
  let hue = u.colr.x
    + u.colr2.w * sin(6.2831 * fbm(hp * 1.7 + warp * 1.6 - t * 0.035) + t * 0.27)
    + 0.9 * sin(band * 14.0 + t * 0.8)
    + 0.6 * vein;
  let tone = oklch(u.colr.y, u.colr.z, hue);
  let glob = 0.35 + 0.7 * smoothstep(0.35, 0.8, fbm(hp * 8.5 + warp * 2.2 + t * 0.09)) + 1.3 * vein;
  let dens = cf.r * glob;

  var under = vec3f(0.0030, 0.0042, 0.0034);
  under += tone * dens * u.colr.w * focus;
  under += cf.gba * u.colr2.x * focus * (0.55 + 0.9 * vein + 0.5 * glob);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    let depth = 0.012 + fk * 0.018;
    let q = (uv - g * depth) * vec2f(asp, 1.0) * (95.0 + fk * 55.0) + vec2f(t * (0.12 + fk * 0.05), t * 0.07);
    let cell = floor(q);
    let h = hash22(cell + fk * 9.1);
    let dd = length(q - cell - 0.25 - 0.5 * h);
    let speck = smoothstep(0.09, 0.0, dd) * step(0.82, hash12(cell + 2.3 + fk));
    let lit = vec3f(0.0035, 0.0045, 0.004) * u.look.z + tone * cf.r * u.colr2.y + max(cf.gba, vec3f(0.0)) * u.colr2.y;
    under += lit * speck / (1.0 + fk);
  }
  under = max(under, vec3f(0.0));

  let glow = textureSampleLevel(halo_t, halo_s, uv - g * 0.012, 0.0).r;
  under += u.inkc.rgb * glow * u.look.y * u.inkc.w * focus;

  // above: the sky, by reflection
  let cosv = max(dot(-v, n), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  let refl = clamp(u.cam.z * (0.7 + 0.3 * smoothstep(0.0, 0.25, 1.0 - cosv)) + fres, 0.0, 1.0);
  var col = mix(under, sky(r, px, t), refl);

  // what floats on the surface sits above both
  let fl = floating(uv, g, t, asp);
  col = col * (1.0 - fl.a) + fl.rgb;

  // mist drifting over the water, lit by the moon
  let mp = uv * vec2f(asp, 1.0);
  let m1 = fbm(mp * 1.6 + vec2f(t * 0.016, t * 0.005));
  let m2 = fbm(mp * 3.1 - vec2f(t * 0.010, -t * 0.008) + m1 * 0.9);
  let mist = smoothstep(0.56, 1.0, m1 * 0.62 + m2 * 0.5) * u.look.x;
  let rf = reflect(v, UP);
  let moon_near = exp(-acos(clamp(dot(rf, u.moon.xyz), -1.0, 1.0)) / 0.35);
  col = col * (1.0 - mist * 0.25) + mist * (vec3f(0.006, 0.0072, 0.0095) * (1.0 + 6.0 * moon_near) + tone * cf.r * u.colr2.z);

  return vec4f(col, 1.0);
}
