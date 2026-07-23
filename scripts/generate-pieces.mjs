#!/usr/bin/env node
// Reusable themed chess-piece set generator for Corrosion Chess.
//
//   node scripts/generate-pieces.mjs scripts/themes/<theme>.json [--only wq,bq] [--force] [--out DIR]
//
// Pipeline per piece: flux-1.1-pro (Replicate) -> 851-labs/background-remover -> PNG
// into public/pieces/<theme.name>/<key>.png, then writes a preview.html grid there.
// Skips files that already exist unless --force; --only limits to specific keys.
//
// Token: REPLICATE_API_TOKEN env var, else falls back to ../gg/.mcp.json (local dev).
//
// Prompt system: each prompt is assembled from
//   1. recognizability preamble (piece type named twice)
//   2. per-piece IDENTITY spec (below) — the hard-won anti-confusion rules
//   3. the theme's side flavor for that piece (theme JSON)
//   4. the theme's stylePhrase (identical across all 12 -> consistent set)
//   5. studio framing suffix (plain gray bg so background removal cuts clean)
//
// LESSONS LEARNED (keep this list growing):
// - NEVER write the name of an unwanted object in a prompt ("no cross" summons
//   a cross — flux ignores negations). Describe the top of the piece positively
//   and exhaustively instead ("the bare dome is the very top").
// - Pawns drift royal: say "shortest piece", "humble", "bare dome".
// - Only the king gets a cross; queen gets an OPEN ring tiara with "sky visible
//   between the points"; rook "flat rim is the very top"; knight is "the only
//   figural piece".
// - Shared Replicate tokens rate-limit (429) under parallel use: backoff+retry.
// - Verify at small size: a piece must be identifiable at ~60px on both dark
//   and green board swatches (preview.html renders both).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const IDENTITY = {
  k: 'the tallest piece on the board, its crown topped with a small cross finial — the only piece in the set with a cross',
  q: 'a tall slender piece topped with an open ring tiara of five sharp points with a hollow middle; the tiara points are the very top of the piece, sky visible between the points',
  r: 'a sturdy castle tower with a flat top cut with square crenellation notches; the flat notched rim is the very top of the piece',
  b: 'a smooth teardrop mitre head with a single diagonal slit; the smooth tip is the very top of the piece',
  n: 'a dynamic side-profile horse-like head with ears and muzzle, the only figural piece in the set',
  p: 'the shortest piece on the board, a smooth bare round dome head on a simple base; the bare dome is the very top of the piece, humble and simple',
};
const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const KEYS = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'];

function buildPrompt(theme, key) {
  if (theme.promptOverrides?.[key]) return theme.promptOverrides[key];
  const side = key[0]; // 'w' | 'b'
  const type = key[1]; // k q r b n p
  const flavor = (theme.pieces?.[type] ?? '').replaceAll('{SIDE}', theme.sides[side].label);
  const palette = theme.sides[side].palette;
  return [
    `single chess ${PIECE_NAME[type].toUpperCase()} game piece, clearly recognizable classic chess ${PIECE_NAME[type]} silhouette`,
    IDENTITY[type],
    flavor,
    palette,
    theme.stylePhrase,
    'centered composition, plain solid gray studio background, no ground shadow, no text',
  ].filter(Boolean).join(', ');
}

// ---- CLI ----
const args = process.argv.slice(2);
const themeFile = args.find(a => !a.startsWith('--'));
const only = (args.find(a => a.startsWith('--only'))?.split('=')[1] ?? args[args.indexOf('--only') + 1])?.split(',');
const force = args.includes('--force');
const outFlagIdx = args.indexOf('--out');
if (!themeFile) {
  console.error('usage: node scripts/generate-pieces.mjs <theme.json> [--only wq,bq] [--force] [--out DIR]');
  process.exit(1);
}
const theme = JSON.parse(readFileSync(themeFile, 'utf8'));
const outDir = outFlagIdx >= 0 ? args[outFlagIdx + 1] : join(ROOT, 'public', 'pieces', theme.name);
mkdirSync(outDir, { recursive: true });

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

// ---- Replicate helpers (429-aware) ----
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

let rembgVersion;
async function rembg(imageUrl) {
  if (!rembgVersion) {
    const m = await rfetch('https://api.replicate.com/v1/models/851-labs/background-remover', { headers: H });
    rembgVersion = m.latest_version?.id;
    if (!rembgVersion) throw new Error('background-remover version lookup failed');
  }
  return predict('https://api.replicate.com/v1/predictions', { version: rembgVersion, input: { image: imageUrl } });
}

// ---- Run ----
const targets = KEYS.filter(k => !only || only.includes(k));
for (const key of targets) {
  const dest = join(outDir, `${key}.png`);
  if (existsSync(dest) && !force) { console.log(`skip ${key} (exists)`); continue; }
  if (existsSync(dest)) rmSync(dest);
  const prompt = buildPrompt(theme, key);
  console.log(`generating ${key}: ${prompt.slice(0, 110)}...`);
  const gen = await predict('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
    input: { prompt, aspect_ratio: '1:1', output_format: 'png', output_quality: 100, safety_tolerance: 2 },
  });
  console.log(`  removing background...`);
  const cut = await rembg(out1(gen));
  const buf = Buffer.from(await (await fetch(out1(cut))).arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  saved ${dest}`);
}

// ---- Preview grid (dark + green swatches, plus 60px row for the squint test) ----
const cells = KEYS.map(k => `<figure><img src="${k}.png"><figcaption>${k}</figcaption></figure>`).join('');
const small = KEYS.map(k => `<img class="s" src="${k}.png" title="${k}">`).join('');
writeFileSync(join(outDir, 'preview.html'), `<!doctype html><meta charset="utf8">
<title>${theme.name} pieces</title>
<style>
body{font-family:system-ui;background:#1b1a18;color:#eee;margin:20px}
section{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:12px;border-radius:8px;margin-bottom:16px}
.dark{background:#312e2b}.green{background:#779556}
figure{margin:0;text-align:center}img{width:100%;image-rendering:auto}
figcaption{font:12px monospace}
.row{padding:8px;border-radius:8px;margin-bottom:16px}.s{width:60px;height:60px;object-fit:contain}
</style>
<h1>${theme.name}</h1>
<h2>dark board</h2><section class="dark">${cells}</section>
<h2>green board</h2><section class="green">${cells}</section>
<h2>60px squint test</h2><div class="row dark">${small}</div><div class="row green">${small}</div>`);
console.log(`preview: ${join(outDir, 'preview.html')}`);
console.log('done — squint-test the preview: every piece must be identifiable at 60px.');
