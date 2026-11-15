// Separable Gaussian (9 taps folded into 5 linear samples). Used to grow a soft
// halo from the text mask; mode 0 reads coverage (.a), mode 1 reads .r.

struct U {
  res: vec4f,  // dstW, dstH, 1/srcW, 1/srcH
  dir: vec4f,  // xy step in source texels, z mode
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var src_s: sampler;

fn tap(uv: vec2f) -> f32 {
  let c = textureSampleLevel(src, src_s, uv, 0.0);
  return select(c.r, c.a, u.dir.z < 0.5);
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.res.xy;
  let d = u.dir.xy * u.res.zw;
  var s = tap(uv) * 0.2270270;
  s += (tap(uv + d * 1.3846154) + tap(uv - d * 1.3846154)) * 0.3162162;
  s += (tap(uv + d * 3.2307692) + tap(uv - d * 3.2307692)) * 0.0702703;
  return vec4f(s, 0.0, 0.0, 1.0);
}
