// Milestone 0 test card: HDR headroom, P3 vs sRGB, gamut mapping, orientation.
// #include "common.wgsl"

struct U {
  res: vec4f,   // xy size, z time, w flipY
  outp: vec4f,  // x gamut (0 srgb, 1 p3), y hdr, z peak
}
@group(0) @binding(0) var<uniform> u: U;

fn lin(e: vec3f) -> vec3f {
  // inverse sRGB transfer, for colours specified as encoded P3 coordinates
  return select(pow((e + 0.055) / 1.055, vec3f(2.4)), e / 12.92, e <= vec3f(0.04045));
}

fn swatch(row: i32, col: i32) -> vec3f {
  if (row == 0) {
    return vec3f(exp2(f32(col)));                              // 1x 2x 4x 8x white
  }
  if (row == 1) {
    if (col == 0) { return SRGB_TO_P3 * vec3f(0.0, 1.0, 0.0); }  // sRGB green
    if (col == 1) { return vec3f(0.0, 1.0, 0.0); }               // P3 green
    if (col == 2) { return lin(vec3f(0.0, 0.996, 0.769)); }      // olo at the P3 edge
    return lin(vec3f(0.0, 0.935, 0.186)) * 2.0;                  // uranium glass x2
  }
  if (col == 0) { return SRGB_TO_P3 * vec3f(1.0, 0.0, 0.0); }    // sRGB red
  if (col == 1) { return vec3f(1.0, 0.0, 0.0); }                 // P3 red
  if (col == 2) { return oklch(0.52, 0.30, radians(312.0)); }    // cobalt violet, past the edge
  return oklch(0.561, 0.191, radians(134.6));                    // scheele's green, P3 stretch
}

@fragment fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var p = fc.xy;
  if (u.res.w > 0.5) { p.y = u.res.y - p.y; }
  let uv = p / u.res.xy;
  let peak = u.outp.z;

  var c = vec3f(0.02);
  let grid = vec2f(uv.x, uv.y / 0.6);
  if (grid.y < 1.0) {
    let cell = vec2i(floor(grid * vec2f(4.0, 3.0)));
    let f = fract(grid * vec2f(4.0, 3.0));
    if (all(f > vec2f(0.06, 0.1)) && all(f < vec2f(0.94, 0.78))) {
      c = swatch(cell.y, cell.x);
    }
  } else if (uv.y > 0.84 && uv.y < 0.95) {
    // linear ramp 0..8 with ticks at 1, 2, 4
    let v = uv.x * 8.0;
    c = vec3f(v);
    for (var k = 0; k < 3; k++) {
      let x = exp2(f32(k)) / 8.0;
      if (abs(uv.x - x) < 1.0 / u.res.x) { c = vec3f(0.0); }
    }
  }
  // orientation marker: a small triangle in the top-left corner
  if (p.x < 24.0 && p.y < 24.0 && p.x + p.y < 24.0) { c = vec3f(1.0, 0.2, 0.2); }

  var o = c;
  if (u.outp.x < 0.5) { o = P3_TO_SRGB * o; }
  o = gamut_map(o, peak);
  let d = (ign(fc.xy + u.res.z) - 0.5) / 255.0;
  return vec4f(srgb_oetf(o) + d, 1.0);
}
