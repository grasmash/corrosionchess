#!/usr/bin/env node
// One-off generator for plan 006's "Corroded" board theme tile textures.
//
//   node scripts/generate-board-textures.mjs
//
// Pipeline: flux-1.1-pro (Replicate) -> PNG straight into public/vfx/board/.
// No rembg step (unlike generate-pieces.mjs) -- these are opaque, full-bleed
// tile textures, not cutout sprites.
//
// Token: REPLICATE_API_TOKEN env var, else falls back to ../gg/.mcp.json.

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'vfx', 'board');
mkdirSync(OUT_DIR, { recursive: true });

let TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  try {
    const mcp = JSON.parse(readFileSync(join(ROOT, '..', 'gg', '.mcp.json'), 'utf8'));
    TOKEN = mcp.mcpServers?.replicate?.env?.REPLICATE_API_TOKEN;
  } catch { /* fall through */ }
}
if (!TOKEN) {
  console.error('Set REPLICATE_API_TOKEN (or keep ../gg/.mcp.json readable).');
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function rfetch(url, opts, attempt = 0) {
  const r = await fetch(url, opts);
  if (r.status === 429 && attempt < 6) {
    const wait = Math.min(60, 5 * 2 ** attempt);
    console.log(`  429 rate-limited, backing off ${wait}s...`);
    await new Promise(res => setTimeout(res, wait * 1000));
    return rfetch(url, opts, attempt + 1);
  }
  return r.json();
}
async function poll(url) {
  for (let i = 0; i < 150; i++) {
    const r = await rfetch(url, { headers: H });
    if (r.status === 'succeeded') return r;
    if (r.status === 'failed' || r.status === 'canceled') throw new Error(`prediction ${r.status}: ${r.error}`);
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('poll timeout');
}
async function predict(url, body) {
  const r = await rfetch(url, { method: 'POST', headers: { ...H, Prefer: 'wait' }, body: JSON.stringify(body) });
  if (r.status === 'succeeded') return r;
  if (!r.urls?.get) throw new Error(`bad response: ${JSON.stringify(r).slice(0, 300)}`);
  return poll(r.urls.get);
}
const out1 = o => (Array.isArray(o.output) ? o.output[0] : o.output);

const TILES = [
  {
    key: 'stone-dark',
    prompt:
      'seamless tileable texture, top-down flat lighting photo of near-black charcoal cracked stone slab, ' +
      'volcanic dark rock surface, fine cracks and fissures, faint glowing acid-green veins running through ' +
      'the cracks, muted and subtle glow -- not overpowering, no text, no watermark, no vignette, uniform ' +
      'edge-to-edge texture ready to tile seamlessly',
  },
  {
    key: 'stone-light',
    prompt:
      'seamless tileable texture, top-down flat lighting photo of slightly lighter graphite gray cracked stone ' +
      'slab, dark stone surface with fine cracks and fissures, no colored veins, subtle and muted, no text, ' +
      'no watermark, no vignette, uniform edge-to-edge texture ready to tile seamlessly',
  },
];

for (const tile of TILES) {
  const dest = join(OUT_DIR, `${tile.key}.png`);
  console.log(`generating ${tile.key}...`);
  const gen = await predict('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
    input: { prompt: tile.prompt, aspect_ratio: '1:1', output_format: 'png', output_quality: 100, safety_tolerance: 2 },
  });
  const buf = Buffer.from(await (await fetch(out1(gen))).arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  saved ${dest}`);
}

writeFileSync(join(OUT_DIR, 'preview.html'), `<!doctype html><meta charset="utf8">
<title>board textures</title>
<style>
body{font-family:system-ui;background:#1b1a18;color:#eee;margin:20px}
.tile{width:96px;height:96px;background-size:96px 96px}
.repeat{width:192px;height:192px;background-size:96px 96px}
h2{font-size:14px;margin:20px 0 6px}
.row{display:flex;gap:16px}
</style>
<h1>board tile textures</h1>
${TILES.map(t => `
<h2>${t.key} (1x1 vs 2x2 tiled)</h2>
<div class="row">
<div class="tile" style="background-image:url('${t.key}.png')"></div>
<div class="repeat" style="background-image:url('${t.key}.png');background-repeat:repeat"></div>
</div>`).join('')}
`);
console.log('preview: public/vfx/board/preview.html -- eyeball 2x2 tiling for seam quality.');
