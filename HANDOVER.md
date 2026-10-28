# Handover: Z-Image Studio v2 (native app, many models)

Branch: `v2-native-app`. `main` still holds v1.0 (the browser-based single-model app) and the
public release at https://github.com/atheeb-xh/z-image-studio/releases. Don't merge this branch
until the v2 checklist below is done; the README download link serves whatever release is latest.

## What the owner (Atheeb) asked for

- A **proper Mac app**, not a page in the browser. A lightweight framework.
- **Many image models**, each with an **(i) button** saying what it's best for.
- Models that need a 24 GB Mac are **turned off automatically on a 16 GB Mac** (he has one of each).
- **Auto mode**: reads the prompt (and whether reference images were given) and picks the best model.
- **Every model this Mac can run downloads automatically** after install.
- **Higgsfield-style conveniences**: style presets, 1-4 variations, upscale + remove background, a prompt helper.
- **Session-only history**: a gallery strip that's gone on quit. Nothing saved unless the user saves it.
- **shadcn/ui look**, premium and clean, graphics sourced properly.
- **Live preview**: show the image going from noise to clarity while it's made.

His choices when asked: ready-made models only (no self-hosted conversions, no gated models);
session-only history; all four convenience features.

## Architecture

```
Z-Image Studio.app
  Contents/MacOS/Z-Image Studio   <- app/main.swift (AppKit + WKWebView, ~150 KB)
  Contents/Resources/uv           <- bundled uv (arm64), installs Python + mflux on first run
  Contents/Resources/engine/      <- engine/*.py, the local HTTP engine
  Contents/Resources/ui/          <- built UI (from ui-src via Vite)
~/Library/Application Support/Z-Image Studio/{venv,python,cache,log.txt}
~/.cache/huggingface/hub/         <- model weights (shared with other HF apps)
```

- **Swift shell** (`app/main.swift`): makes the venv with bundled `uv` if missing, starts
  `engine/server.py` on a free port (`ZIS_PORT`), waits for the `LISTENING <port>` line, loads
  `http://127.0.0.1:<port>/` in a WKWebView. Kills the engine on quit. Native bridge
  (`window.webkit.messageHandlers.native`, replies via `window.nativeReply(id, data)`):
  `save` (NSSavePanel), `copy` (pasteboard), `removeBackground` (Apple Vision
  `VNGenerateForegroundInstanceMaskRequest`, macOS 14+), `restart`. A `DragStrip` view over the
  44 px header makes the window draggable (WKWebView swallows mouse events). Real menus so
  Cmd-Q/C/V/A work. External links open in the real browser.
- **Engine** (`engine/server.py` + `engine/catalog.py`): stdlib-only at start. Installs
  `mflux==0.23.0` + `pillow==12.3.0` into its venv, then a download loop fetches every runnable
  model (16 GB-tier first, then 24 GB HQ), checking free disk first (needs size + 2 GB). One
  worker thread does all MLX work. Jobs: `POST /jobs`, `GET /jobs/<id>`, `POST /jobs/<id>/cancel`,
  `GET /jobs/<id>/preview.jpg` (live step preview), `GET /images/<id>.png`, `POST /images`
  (store an image made in the app, e.g. a cutout), `DELETE /images/<id>`, `GET /status`,
  `POST /downloads/retry`. Results live in memory only.
- **UI**: `ui-src/` is a Vite + React 19 + Tailwind v4 + shadcn (radix, "nova" preset, Lucide
  icons, Geist font bundled locally) project that builds into `ui/`. `ui/` currently still holds
  the **older vanilla-JS v2 UI** (index.html/app.js/app.css), which works against the engine and
  is the reference for behaviour; `npm run build` in `ui-src` will replace it (`emptyOutDir`).

### Models (`engine/catalog.py`)

All Apache 2.0, ungated, already in mflux's format. RAM via `os.sysconf` (24 on this Mac).

| id | repo | download | Mac | status here |
|---|---|---|---|---|
| zimage | filipstrand/Z-Image-Turbo-mflux-4bit | 5.9 GB | 16 | downloaded, tested |
| klein | mflux-community/flux2-klein-4b-mflux-q4 | 4.6 GB | 16 | downloaded, **not yet run** |
| upscaler | numz/SeedVR2_comfyUI (3B fp16 + VAE only) | 7.3 GB | 16 | **partial** (3.1 GB), resumes on next engine start |
| zimage-hq | OsaurusAI/Z-Image-Turbo-mflux-8bit | 11 GB | 24 | not downloaded |
| klein-hq | mflux-community/flux2-klein-4b-mflux-q8 (skip the stray `" /"` duplicate folder via `patterns`) | 8.6 GB | 24 | not downloaded |

Excluded on purpose: gated repos (FLUX.1 Kontext/schnell, Klein 9B, Krea 2, FIBO, Ideogram 4 need
a Hugging Face login per user), Qwen-Image-Edit (text encoder alone ~15 GB), FLUX 3 Klein
(18.5 GB peak at 4-bit, non-commercial), Ming (~17 GB). The `speed` strings in the catalog are
**guesses**; replace them with measured numbers.

## Status

Done and verified:
- Engine starts, reports RAM/disk/model states, queues downloads, shows download progress.
- Z-Image generation through the job API with step progress (seen: "image 1 of 2, step 1 of 9").
- Swift shell compiles (`swiftc -O -target arm64-apple-macos14.0 app/main.swift`).
- shadcn initialised; components added: badge button collapsible dialog hover-card input kbd
  progress scroll-area separator slider sonner switch textarea toggle-group toggle tooltip.
- Dark theme tokens with gold primary in `ui-src/src/index.css`; sonner fixed to dark (no next-themes).

Written, **not yet run**:
- Klein load/generate path, SeedVR2 load/upscale path, Cancel via `StopImageGenerationException`.
- Live preview (`StepHook.preview`: unpack latents → VAE decode → 640px JPEG each step).
  Expect ~1 s extra per step; if too slow, decode a 2× pooled latent or only every other step.
- The Swift app as a whole (never launched), the drag strip, Vision cutout, Save/Copy bridge.
- `app/build.sh` v2 (compiles Swift, copies engine/ui/uv, writes Info.plist, icon, DMG).

## Next steps (in order)

1. **Finish the React UI** in `ui-src/src`. Done: `lib/api.ts`, `lib/data.ts` (presets, shapes,
   ideas, `presetThumb()`), `lib/routing.ts` (Auto `route()`, `enhance()`),
   `components/ModelInfo.tsx`, `ModelPicker.tsx` (hover-card (i)), `ModelsDialog.tsx`.
   To write: `References.tsx` (drop/paste/click, up to 3, drag from gallery via
   `text/zis-image`, downscale to 2048 px), `Presets.tsx` (thumbnail grid, falls back to the
   preset's gradient `tint`), `Stage.tsx` (empty state with ideas, results grid 1-4, **live preview
   crossfading `jobs/<id>/preview.jpg?n=<preview_n>`**, progress card with Cancel/Esc, toolbar:
   Save, Copy, Use as reference, Upscale 2×, Remove background (app only), Reuse settings,
   Delete), `Filmstrip.tsx`, `App.tsx` (state, polling `/status` every 1.5 s and the job every
   0.5 s), `main.tsx` (TooltipProvider + Toaster). Port behaviour from `ui/app.js`. Add a "Live
   preview" Switch that sends `preview: false`. Then `npm run build` (it replaces `ui/`).
2. **Preset thumbnails**: write `app/make_presets.py` to render one 384 px JPEG per preset with
   Z-Image into `ui-src/src/assets/presets/<id>.jpg` (license-clean; Atheeb asked for "graphics
   from the internet": use Lucide for icons, and tell him why preset imagery is generated).
3. **Test every model** on this Mac (`ZIS_PORT=7861 python engine/server.py`, then the UI):
   Klein edit with a reference (the cowboy-hat case), Klein text-to-image, 2-4 variations,
   cancel, upscale, live preview. Measure peak memory (`/usr/bin/time -l` or Activity Monitor)
   for each and correct `min_ram`/`speed`. Make sure a 16 GB Mac can hold each one.
4. **Build and run the real app**: `./app/build.sh`, open `dist/Z-Image Studio.app`, check first
   run on a clean `~/Library/Application Support/Z-Image Studio`, menus, drag, Save, Copy,
   Remove background, quit kills the engine (`lsof -i` shows nothing after).
5. **Try on the 16 GB Mac**: HQ models must show as turned off and not download.
6. Update `README.md`, `README.txt`, version → 2.0, merge to `main`, `gh release create v2.0
   dist/Z-Image-Studio.dmg` (the README link picks it up). Note: publishing a release was
   blocked by the permission classifier last time; Atheeb ran the command himself.
7. Clean up the stray **v1.1** release (same DMG as 1.0, notes say "What changed") if Atheeb wants:
   `gh release delete v1.1 --cleanup-tag --yes`.

## Gotchas learned the hard way

- mflux 0.23 breaks on the newest Pillow: keep `pillow==12.3.0`.
- mflux's CLI parsers only read `sys.argv` (no list argument); the engine swaps `sys.argv`.
- **MLX streams are per thread**: load and generate on the same thread (the single worker).
- Use `--model <repo> --base-model z-image-turbo` (there is no `--model-path` flag).
- HF downloads use Xet: bytes arrive as chunks long before files are written, so measure
  progress with `snapshot_download(tqdm_class=...)` and take the max of both byte bars.
- `snapshot_download(local_files_only=True)` is the cheap "is it installed?" check.
- This Mac has little free disk (~20-29 GB). The 24 GB HQ models won't all fit beside the rest;
  the engine reports `no_space` instead of filling the disk.
- Apps aren't notarized (no Developer ID): users click System Settings → Privacy & Security →
  Open Anyway once. Signing is ad-hoc in `build.sh`.
- Don't run generation tests while `npm run narrate` (CEO For A Day, VoiceStudio) is running:
  they share the GPU and steps go from seconds to a minute or more.

## Commands

```bash
# engine on a test port, against the existing venv
cd engine && ZIS_PORT=7861 "$HOME/Library/Application Support/Z-Image Studio/venv/bin/python" -u server.py
# UI dev server (proxies the API to :7861)
cd ui-src && npm run dev
# build UI into ui/, then the app + DMG
cd ui-src && npm run build && cd .. && ./app/build.sh
```
