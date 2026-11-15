// The colour's body: a density field under the water.
//   r   = density of the colour out of space
//   gba = pigment dye, premultiplied linear P3 (can be negative: jet stains dark)
// Advected by slow curl-noise currents, the creature's swirl, the surface's
// own motion (so your wake stirs it) and the blast of dropped stones.
// #include "noise.wgsl"

struct U {
  res: vec4f,                 // w, h, dt, time
  prm: vec4f,                 // x decay, y diffusion, z current speed, w aspect
  creature: vec4f,            // xy centre (p-space), z radius, w intensity
  lobes: array<vec4f, 6>,     // xy p-space, z radius, w strength
  dye: vec4f,                 // rgb pigment (linear P3), w injection rate
  dye_rect: vec4f,            // hovered element in uv: x0 y0 x1 y1
  stir: vec4f,                // x wave push, y swirl, z pull, w dye decay
  blasts: array<vec4f, 4>,    // xy p-space, z age s, w strength
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var prev: texture_2d<f32>;
@group(0) @binding(2) var prev_s: sampler;
@group(0) @binding(3) var wave: texture_2d<f32>;
@group(0) @binding(4) var wave_s: sampler;

fn potential(p: vec2f, t: f32) -> f32 {
  return fbm3(p * 2.2 + vec2f(t * 0.031, -t * 0.019));
}

fn curl(p: vec2f, t: f32) -> vec2f {
  let e = 0.02;
  let dx = potential(p + vec2f(e, 0.0), t) - potential(p - vec2f(e, 0.0), t);
  let dy = potential(p + vec2f(0.0, e), t) - potential(p - vec2f(0.0, e), t);
  return vec2f(dy, -dx) / (2.0 * e);
}

fn box_mask(uv: vec2f, r: vec4f, soft: f32) -> f32 {
  let c = (r.xy + r.zw) * 0.5;
  let hs = (r.zw - r.xy) * 0.5 + vec2f(soft * 0.5, soft * 0.25);
  let d = abs(uv - c) - hs;
  let o = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
  return smoothstep(soft, 0.0, o);
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.res.xy;
  let dt = u.res.z;
  let t = u.res.w;
  let asp = u.prm.w;
  let toP = vec2f(asp, 1.0);
  let p = uv * toP;

  // velocity in p-space units per second
  var v = curl(p, t) * u.prm.z;
  // dye billows: powder dropped in water rolls outward and upward in plumes
  let plume = box_mask(uv, u.dye_rect, 0.12) * step(0.0, u.dye.w - 0.001);
  v += (curl(p * 2.3 + 11.0, t * 2.0) * 0.09 + vec2f(0.0, -0.035)) * plume;
  let wg = textureSampleLevel(wave, wave_s, uv, 0.0).zw;
  v += vec2f(wg.x, wg.y) * u.stir.x;

  let c = u.creature.xy;
  let rc = p - c;
  let fall = exp(-dot(rc, rc) / (u.creature.z * u.creature.z * 4.0));
  v += vec2f(-rc.y, rc.x) * u.stir.y * fall;
  v -= rc * u.stir.z * fall;

  for (var i = 0; i < 4; i++) {
    let b = u.blasts[i];
    if (b.w != 0.0) {
      let d = p - b.xy;
      let dist = length(d);
      let front = 0.05 + b.z * 0.35;
      let ring = exp(-pow((dist - front) / 0.08, 2.0));
      v += d / max(dist, 1e-3) * b.w * ring * exp(-b.z * 2.2);
    }
  }

  // semi-Lagrangian advection, a little diffusion
  let back = uv - v * dt / toP;
  let px = 1.0 / u.res.xy;
  var s = textureSampleLevel(prev, prev_s, back, 0.0);
  let avg = (textureSampleLevel(prev, prev_s, back + vec2f(px.x, 0.0), 0.0)
           + textureSampleLevel(prev, prev_s, back - vec2f(px.x, 0.0), 0.0)
           + textureSampleLevel(prev, prev_s, back + vec2f(0.0, px.y), 0.0)
           + textureSampleLevel(prev, prev_s, back - vec2f(0.0, px.y), 0.0)) * 0.25;
  s = mix(s, avg, u.prm.y);

  // decay
  s.r *= exp(-dt * u.prm.x);
  s = vec4f(s.r, s.gba * exp(-dt * u.stir.w));

  // the creature feeds its body
  var feed = 0.0;
  for (var i = 0; i < 6; i++) {
    let l = u.lobes[i];
    let d = p - l.xy;
    feed += l.w * exp(-dot(d, d) / (l.z * l.z));
  }
  s.r += feed * u.creature.w * dt;

  // a pigment rising under the hovered word
  if (u.dye.w > 0.0) {
    let m = box_mask(uv, u.dye_rect, 0.035);
    let grain = 0.6 + 0.8 * vnoise(p * 30.0 + t * 0.7);
    s = vec4f(s.r, s.gba + u.dye.rgb * u.dye.w * m * grain * dt);
  }

  // edges drain; nothing piles up forever
  let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  s *= smoothstep(0.0, 0.03, e);
  s.r = min(s.r, 4.0);
  return s;
}
