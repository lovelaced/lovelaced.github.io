// Final composite at full resolution: scene + bloom, the crisp words in the
// water (refracted by the live surface), grain, tone and gamut mapping, dither.
// #include "common.wgsl"
// #include "noise.wgsl"

struct U {
  res: vec4f,    // w, h, time, flipY
  outp: vec4f,   // x gamut (0 srgb, 1 p3), y hdr, z peak, w exposure
  ink: vec4f,    // rgb light ink (linear P3), w text refraction
  look: vec4f,   // x bloom, y grain, z vignette, w ink master alpha
  dark: vec4f,   // rgb dark ink (used over bright water), w unused
  ids: array<vec4f, 4>,  // per-element alpha, indexed by data-ink id
  hov: vec4f,    // x hovered id, y amount
  hovc: vec4f,   // rgb tint for the hovered word (linear P3)
  pour: vec4f,   // x amount, yz centre uv, w intensity
  post: vec4f,   // x desaturate, y exposure, z force dark ink, w pour hue (rad)
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var scene_s: sampler;
@group(0) @binding(3) var bloom: texture_2d<f32>;
@group(0) @binding(4) var bloom_s: sampler;
@group(0) @binding(5) var wave: texture_2d<f32>;
@group(0) @binding(6) var wave_s: sampler;
@group(0) @binding(7) var text: texture_2d<f32>;
@group(0) @binding(8) var text_s: sampler;
@group(0) @binding(9) var halo: texture_2d<f32>;
@group(0) @binding(10) var halo_s: sampler;

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2290, 0.6917, 0.0793)); // P3 luminance weights
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var p = fc.xy;
  if (u.res.w > 0.5) { p.y = u.res.y - p.y; }
  let uv = p / u.res.xy;
  let t = u.res.z;

  var col = textureSampleLevel(scene, scene_s, uv, 0.0).rgb;
  col += textureSampleLevel(bloom, bloom_s, uv, 0.0).rgb * u.look.x;

  // the aftermath: everything the colour touched goes grey
  let lum0 = luma(col);
  col = mix(col, vec3f(lum0), u.post.x);
  col *= u.post.y;

  // the pour: the colour rushes up at the viewer and fills the frame
  let gw = textureSampleLevel(wave, wave_s, uv, 0.0).zw;
  if (u.pour.x > 0.0) {
    let asp = u.res.x / u.res.y;
    let d = length((uv - u.pour.yz) * vec2f(asp, 1.0));
    let front = u.pour.x * 1.9;
    let m = smoothstep(front, front - 0.35, d) * smoothstep(0.0, 0.15, u.pour.x);
    let q = uv * vec2f(asp, 1.0);
    let shimmer = (fbm3(q * 7.0 + vec2f(t * 0.3, -t * 0.2)) - 0.5) * 0.22;
    let swell = clamp(1.0 + (gw.x + gw.y) * 2.5, 0.6, 1.5);
    let pc = oklch(0.86, 0.27, u.post.w + shimmer + gw.x * 0.6) * u.pour.w * swell;
    col = mix(col, pc, m);
  }

  // the words, seen through the moving surface
  let off = gw * u.ink.w;
  let tx = textureSampleLevel(text, text_s, uv - off, 0.0);
  // dispersion: each primary refracts a little differently as ripples pass
  let ar = textureSampleLevel(text, text_s, uv - off * 1.22, 0.0).a;
  let ab = textureSampleLevel(text, text_s, uv - off * 0.78, 0.0).a;
  let id = clamp(i32(round(tx.g / max(tx.r, 1e-3) * 255.0 / 16.0)), 0, 15);
  let ida = u.ids[id >> 2u][id & 3] * u.look.w;
  let cov = vec3f(ar, tx.a, ab) * ida;
  let bg = luma(col);
  // over bright water the words get a soft shadow beneath them, not a new colour
  let shade = textureSampleLevel(halo, halo_s, uv - off, 0.0).r;
  col *= 1.0 - min(shade * 1.6, 0.85) * smoothstep(0.12, 0.9, bg) * (1.0 - u.post.z) * u.look.w;
  var ink = mix(u.ink.rgb, u.dark.rgb, u.post.z);
  if (id == i32(u.hov.x) && id > 0) { ink = mix(ink, u.hovc.rgb, u.hov.y * 0.35); }
  col = mix(col, ink, cov * 0.94);

  // vignette and grain
  let vq = (uv - 0.5) * vec2f(u.res.x / u.res.y, 1.0);
  col *= 1.0 - u.look.z * dot(vq, vq);
  let grain = hash12(p + fract(t * 7.13) * 1000.0) - 0.5;
  col += grain * u.look.y * (0.012 + col * 0.06);

  col *= u.outp.w;
  let o = present(col, u.outp.x, u.outp.z);
  let d = (ign(p + fract(t * 3.7) * 64.0) - 0.5) / 255.0;
  return vec4f(o + d, 1.0);
}
