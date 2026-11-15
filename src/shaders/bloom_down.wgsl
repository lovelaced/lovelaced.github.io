// Dual-filter (Kawase) downsample. On the first level, a soft threshold and a
// Karis-style weight keep single bright pixels from sparkling.

struct U {
  src: vec4f,  // 1/srcW, 1/srcH, dstW, dstH
  prm: vec4f,  // x threshold, y first level (0/1)
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var src_s: sampler;

fn tap(uv: vec2f) -> vec3f {
  return textureSampleLevel(src, src_s, uv, 0.0).rgb;
}

fn prefilter(c: vec3f) -> vec3f {
  let l = max(c.r, max(c.g, c.b));
  let k = max(l - u.prm.x, 0.0);
  let soft = k * k / (4.0 * u.prm.x + 1e-4);
  return c * max(soft, k) / max(l, 1e-4) / (1.0 + l * 0.25);
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.src.zw;
  let hp = u.src.xy;
  var a = tap(uv);
  var b = tap(uv - hp);
  var c = tap(uv + hp);
  var d = tap(uv + vec2f(hp.x, -hp.y));
  var e = tap(uv - vec2f(hp.x, -hp.y));
  if (u.prm.y > 0.5) {
    a = prefilter(a); b = prefilter(b); c = prefilter(c); d = prefilter(d); e = prefilter(e);
  }
  return vec4f((a * 4.0 + b + c + d + e) / 8.0, 1.0);
}
