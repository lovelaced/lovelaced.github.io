// Water surface: a damped 2D wave equation on a heightfield (9-point
// isotropic Laplacian, so rings stay round). One call = one simulation step.
// out: r = new height, g = current height, ba = gradient of current height.

struct U {
  res: vec4f,              // w, h, 1/w, 1/h
  wake: vec4f,             // segment a.xy -> b.xy (uv, y down)
  wake2: vec4f,            // x radius (uv-height units), y strength, z damping, w aspect (w/h)
  drops: array<vec4f, 8>,  // xy uv, z radius, w strength (0 = unused)
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var state_s: sampler;

fn at(uv: vec2f) -> vec4f {
  return textureSampleLevel(state, state_s, uv, 0.0);
}

fn seg_dist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * u.res.zw;
  let dx = vec2f(u.res.z, 0.0);
  let dy = vec2f(0.0, u.res.w);
  let c = at(uv);
  let l = at(uv - dx).r;
  let r = at(uv + dx).r;
  let t = at(uv - dy).r;
  let b = at(uv + dy).r;
  let d = at(uv - dx - dy).r + at(uv + dx - dy).r + at(uv - dx + dy).r + at(uv + dx + dy).r;

  // 2c - prev + k * L9, k = 0.5
  var h = c.r / 3.0 + (l + r + t + b) / 3.0 + d / 12.0 - c.g;

  // absorb at the screen edges so rings leave instead of bouncing
  let asp = vec2f(u.wake2.w, 1.0);
  let edge = min(min(uv.x, 1.0 - uv.x) * asp.x, min(uv.y, 1.0 - uv.y));
  h *= u.wake2.z * mix(0.94, 1.0, smoothstep(0.0, 0.05, edge));

  // the visitor's wake: a moving depression along this step's segment
  let p = uv * asp;
  if (u.wake2.y != 0.0) {
    let wd = seg_dist(p, u.wake.xy * asp, u.wake.zw * asp) / u.wake2.x;
    h -= u.wake2.y * exp(-wd * wd);
  }
  // stones, drips, rising fish
  for (var i = 0; i < 8; i++) {
    let s = u.drops[i];
    if (s.w != 0.0) {
      let q = distance(p, s.xy * asp) / s.z;
      h -= s.w * exp(-q * q);
    }
  }
  return vec4f(h, c.r, (r - l) * 0.5, (b - t) * 0.5);
}
