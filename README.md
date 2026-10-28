# Z-Image Studio

A small Mac app for making images with [Z-Image Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) on your own machine. Type a scene, and optionally drop in one reference image. Everything runs locally through [mflux](https://github.com/filipstrand/mflux) (MLX), using the [4-bit model](https://huggingface.co/filipstrand/Z-Image-Turbo-mflux-4bit), so it fits on a 16 GB Mac.

### [⬇ Download Z-Image Studio for Mac](https://github.com/atheeb-xh/z-image-studio/releases/latest/download/Z-Image-Studio.dmg)

Apple Silicon only (M1 or newer). See [Install](#install) for the one-time security step.

**Nothing is stored.** The result goes straight to your browser and is only saved if you press Download. A reference image sits in a temp folder only while the image is made.

## Requirements

- A Mac with Apple Silicon (M1 or newer), macOS 13+
- 16 GB memory, ~9 GB free disk
- Internet on first run

## Install

1. [Download `Z-Image-Studio.dmg`](https://github.com/atheeb-xh/z-image-studio/releases/latest/download/Z-Image-Studio.dmg) (or build it, below).
2. Drag **Z-Image Studio** into Applications and open it.
3. The app isn't notarized, so macOS blocks it the first time: click **Done**, then **System Settings → Privacy & Security → Open Anyway**. Only once.

On first open it installs its own Python and packages (~1 GB) into `~/Library/Application Support/Z-Image Studio` and downloads the model (~5.5 GB, cached in `~/.cache/huggingface`). The page shows progress. After that it opens in seconds.

## Using it

The app opens a page in your browser and stays in the Dock while it runs. Quit from the Dock or the Quit button on the page to free the memory.

- **Keep from reference**: low makes a new picture loosely based on yours; high stays close to your image with small changes. Z-Image Turbo does image-to-image, so it keeps layout and colours, not an exact face or product.
- **Seed**: the same seed and settings give the same picture. "Reuse seed" helps when tweaking a prompt.

## Build

Needs [uv](https://docs.astral.sh/uv/) (the arm64 build is copied into the app).

```bash
./app/build.sh
```

This writes `dist/Z-Image Studio.app` and `dist/Z-Image-Studio.dmg`.

| File | What it does |
|---|---|
| `server.py` | Local server (127.0.0.1:7860). Stdlib only at start; installs mflux on first run, downloads the model, then generates. |
| `index.html` | The page: drop zone, prompt, settings, setup progress. |
| `app/main.applescript` | The app itself: starts the server, reopens the page, stops the server on Quit. |
| `app/launch.sh` | Creates the app's Python on first run and starts the server. |
| `app/build.sh` | Builds the `.app` (icon, Info.plist, ad-hoc signature) and the DMG. |
| `README.txt` | The short read-me that ships inside the DMG. |

To run without building the app: `uv run --with mflux==0.23.0 --with pillow==12.3.0 python server.py`.

## Uninstall

Delete the app, `~/Library/Application Support/Z-Image Studio`, and `~/.cache/huggingface/hub/models--filipstrand--Z-Image-Turbo-mflux-4bit`.
