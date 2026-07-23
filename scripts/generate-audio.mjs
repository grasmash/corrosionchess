#!/usr/bin/env node
// One-off generator for plan 008's ambient background-music loop.
//
//   node scripts/generate-audio.mjs
//
// Pipeline: meta/musicgen (Replicate) -> mp3 straight into public/audio/.
// Same token lookup and poll-prediction loop as
// scripts/generate-board-textures.mjs / scripts/generate-pieces.mjs.
//
// Token: REPLICATE_API_TOKEN env var, else falls back to ../gg/.mcp.json.

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio');
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

const dest = join(OUT_DIR, 'music-loop.mp3');
console.log('generating music-loop...');
// meta/musicgen is not a Replicate "official model" (unlike flux-1.1-pro in
// generate-board-textures.mjs), so the /v1/models/{owner}/{name}/predictions
// shortcut 404s -- it must be called version-pinned via /v1/predictions.
const model = await rfetch('https://api.replicate.com/v1/models/meta/musicgen', { headers: H });
const version = model.latest_version.id;
const gen = await predict('https://api.replicate.com/v1/predictions', {
  version,
  input: {
    prompt:
      'dark ambient dungeon-synth loop, slow brooding pads, faint metallic drips and distant industrial hum, ' +
      'seamless loop, no drums, no melody spikes, 60 bpm',
    duration: 30,
    output_format: 'mp3',
    model_version: 'stereo-large',
  },
});
const buf = Buffer.from(await (await fetch(out1(gen))).arrayBuffer());
writeFileSync(dest, buf);
console.log(`  saved ${dest}`);
