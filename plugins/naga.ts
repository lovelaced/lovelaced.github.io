// Vite plugin: every `*.wgsl` import becomes a ShaderModule holding the WGSL
// source (for WebGPU) and naga's GLSL ES 3.00 translation (for WebGL2), plus the
// binding reflection both backends need. WGSL has no includes, so we support a
// tiny `// #include "file.wgsl"` directive resolved relative to the importer.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const INCLUDE = /^\s*\/\/\s*#include\s+"([^"]+)"\s*$/;

function expand(file: string, seen: Set<string>, deps: string[]): string {
  if (seen.has(file)) return '';
  seen.add(file);
  deps.push(file);
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => {
      const m = line.match(INCLUDE);
      return m ? expand(resolve(dirname(file), m[1]), seen, deps) : line;
    })
    .join('\n');
}

const work = mkdtempSync(join(tmpdir(), 'naga-'));

function toGlsl(wgsl: string, name: string): string {
  const src = join(work, `${name}.wgsl`);
  const out = join(work, `${name}.frag`);
  writeFileSync(src, wgsl);
  try {
    execFileSync(
      'naga',
      ['--compact', '--entry-point', 'fs_main', '--profile', 'es300', '--shader-stage', 'frag', src, out],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer };
    throw new Error(`naga failed on ${name}.wgsl\n${err.stderr?.toString() ?? ''}${err.stdout?.toString() ?? ''}`);
  }
  return readFileSync(out, 'utf8');
}

function reflect(glsl: string) {
  const blocks: [string, number][] = [];
  const samplers: [string, number][] = [];
  for (const m of glsl.matchAll(/uniform\s+(\w+)\s*\{\s*\w+\s+_group_0_binding_(\d+)_fs;/g)) {
    blocks.push([m[1], Number(m[2])]);
  }
  for (const m of glsl.matchAll(/uniform\s+highp\s+sampler2D\s+(_group_0_binding_(\d+)_fs)\s*;/g)) {
    samplers.push([m[1], Number(m[2])]);
  }
  return { blocks, samplers };
}

export default function naga(): Plugin {
  return {
    name: 'wgsl-naga',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.wgsl')) return null;
      const deps: string[] = [];
      const wgsl = expand(file, new Set(), deps);
      for (const d of deps) this.addWatchFile(d);
      const name = basename(file, '.wgsl');
      const glsl = toGlsl(wgsl, name);
      const module = { name, wgsl, glsl, ...reflect(glsl) };
      return `export default ${JSON.stringify(module)};`;
    },
  };
}
