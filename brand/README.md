# VISR mark

The VISR logo is a 3D icon built entirely from code (`brand/logo.py`, Blender 4.2 LTS, Cycles) and rendered in GitHub Actions. Nothing is modelled by hand and nothing needs to run on your machine.

## Rationale

1. VISR is a visor: the thing you look through to see what matters. The tile is the helmet, the dark glass with a nose bridge is the visor.
2. What the visor shows is the product: one trend line, read at a glance. Its last leg is a check mark, so "the data" and "the decision" are the same stroke.
3. The single warm point is the signal: where the line ends up, the one thing to act on. It is the only use of `#eb6834`.
4. Accent blue `#2a78d6` is the body so the mark carries its own background and sits equally on light and dark headers; graphite `#151518` and near-white `#f4f4f5` do the rest.
5. One light story: a soft key from the upper left, a diffuse fill, a rim and a top strip that draws a hairline on the bevels and the glass edge. No glow, no decorative gradients.

## Files

| File | What it is |
| --- | --- |
| `brand/logo.py` | Builds every scene (geometry, materials, lights, camera) and renders it. `visr` is the mark, `visr_s` the heavier drawing for 32 px and below, `visr_hero` the three-quarter angle. The other concepts are the exploration. |
| `brand/post.py` | Pillow step: tight crops, downscaled sizes, contact sheet, light/dark small-size strips, site deliverables. |
| `brand/visr.blend` | The scene of the mark as saved by CI. Open it in Blender 4.2+ to look around; edit `logo.py`, not the file. |
| `brand/concepts.png` | Contact sheet of everything explored, on `#ffffff` and `#151518`. |
| `brand/visr-hero.png` | Three-quarter render for READMEs and social cards. |
| `static/brand/visr-mark-{1024,512,256,128,64,32}.png` | The mark, transparent, square, about 6% padding. 32 px uses the small-size drawing. |
| `static/favicon-32.png`, `static/apple-touch-icon.png` | Favicon and the 180 px touch icon (opaque `#151518`). |

## Re-rendering

Rendering happens in the `Render VISR logo` workflow (`.github/workflows/logo-render.yml`).

1. Create a branch named `logo/<anything>`, edit `brand/logo.py` (or `brand/post.py`) and push. A push that touches `brand/*.py` on a `logo/**` branch starts the workflow. Once the workflow file is on the default branch it can also be started by hand: `gh workflow run logo-render.yml --ref <branch> -f concepts=mark`.
2. Four parallel jobs render the concepts with Cycles on CPU (about 12 minutes for the full set), then one job builds the sheets.
3. Download the result: `gh run download <run-id> -n visr-logo -D out`.
4. Look at `out/contact-sheet.png` and `out/final/small-sizes.png` (the mark at 128 to 16 px on white and on `#151518`, with 4x zooms). Judge it there, not only at 1024.
5. `out/final/` mirrors the repository layout. Copy its `static/` and `brand/` folders over the checkout and commit.

`logo.py` arguments (after `--`): `--concepts all|mark|id,id`, `--samples` (the mark, default 256), `--study-samples` (exploration, default 96), `--res` (default 1024), `--blend <path>`, `--shard i/n`.
