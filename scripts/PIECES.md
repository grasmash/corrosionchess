# Themed piece-set generation

Generate a full 12-piece themed chess set (wk…bp PNGs, transparent background)
with Replicate, ready for `public/pieces/<theme>/`.

```bash
# full set
node scripts/generate-pieces.mjs scripts/themes/fireice.json

# regenerate just the queens (e.g. after a failed squint test)
node scripts/generate-pieces.mjs scripts/themes/fireice.json --only wq,bq --force

# then downscale in place (macOS)
sips -Z 512 public/pieces/fireice/*.png
```

Token: `REPLICATE_API_TOKEN` env var (falls back to `../gg/.mcp.json` on this machine).
Cost: ~$0.50/set (12 × flux-1.1-pro + background removal).

## Adding a theme

Copy `scripts/themes/fireice.json`. You supply only: `name`, one `stylePhrase`
(repeated verbatim across all 12 images — this is what makes the set cohesive),
per-side `label` + `palette`, and a short flavor line per piece type
(`{SIDE}` expands to the side label). The script injects the piece-identity
rules automatically. `promptOverrides: { "wq": "full custom prompt" }` bypasses
assembly for stubborn pieces.

File convention consumed by the app: `public/pieces/<theme>/{wk,wq,wr,wb,wn,wp,bk,bq,br,bb,bn,bp}.png`.

## Hard-won prompt rules (do not relearn these)

1. **Never name an unwanted object.** "no cross" summons a cross — flux ignores
   negation. Describe the top of the piece positively and exhaustively instead:
   "the bare dome is the very top of the piece".
2. **Only the king gets a cross.** Queen = open ring tiara, "sky visible between
   the points". Pawn = shortest, humble, bare dome. Rook = "flat notched rim is
   the very top". Knight = "the only figural piece". These live in `IDENTITY`
   in the script — improve them there, not in theme files.
3. **Squint test is the acceptance test.** Open the generated `preview.html`:
   every piece must be identifiable as its type at 60px on both the dark and
   green swatches, and the two sides must be instantly distinguishable.
4. **Rate limits:** shared tokens 429 under parallel use; the script backs off
   automatically. Avoid >2 concurrent set generations.
5. **The crown/tiara concept itself triggers flux's cross bias** on tall
   regal pieces — even fully positive spike/tiara wording can still summon a
   cross above it. When a queen keeps growing a cross after 2 retries, drop
   the crown shape entirely: use soft, non-geometric toppers (flame wisps,
   frosting swirl, flowing hair/energy) — verified fix on multiple themes.
6. **Dark/gothic castle framing also triggers the cross bias** (rooks grow a
   cross finial above the crenellations). If positive flat-top phrasing fails
   twice, change the FRAMING, not the wording — e.g. "dark stone gothic
   tower" → "cozy painted brick tower" fixed it immediately.
7. **Species/theme drop-out:** on themed sets (e.g. animals), flux sometimes
   renders a plain classic piece — check that the theme actually appears on
   every piece, not just that the silhouette is right.
