// Dual-filter (Kawase) upsample, added onto the same-size downsample level.

struct U {
  src: vec4f,  // 1/lowW, 1/lowH, dstW, dstH
  prm: vec4f,  // x weight of the upsampled level
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var low: texture_2d<f32>;
@group(0) @binding(2) var low_s: sampler;
@group(0) @binding(3) var cur: texture_2d<f32>;
@group(0) @binding(4) var cur_s: sampler;

fn tap(uv: vec2f) -> vec3f {
  return textureSampleLevel(low, low_s, uv, 0.0).rgb;
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.src.zw;
  let hp = u.src.xy * 0.5;
  var s = tap(uv + vec2f(-hp.x * 2.0, 0.0));
  s += tap(uv + vec2f(-hp.x, hp.y)) * 2.0;
  s += tap(uv + vec2f(0.0, hp.y * 2.0));
  s += tap(uv + vec2f(hp.x, hp.y)) * 2.0;
  s += tap(uv + vec2f(hp.x * 2.0, 0.0));
  s += tap(uv + vec2f(hp.x, -hp.y)) * 2.0;
  s += tap(uv + vec2f(0.0, -hp.y * 2.0));
  s += tap(uv + vec2f(-hp.x, -hp.y)) * 2.0;
  let base = textureSampleLevel(cur, cur_s, uv, 0.0).rgb;
  return vec4f(base + s / 12.0 * u.prm.x, 1.0);
}
