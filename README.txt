Z-Image Studio
==============
Make images on your own Mac with Z-Image Turbo. Type a scene, and optionally
drop in one reference image. Nothing leaves your Mac and nothing is saved
unless you press Download.

Needs: a Mac with Apple Silicon (M1 or newer), 16 GB memory, ~9 GB free disk,
and internet for the first run.

INSTALL
  Drag Z-Image Studio into Applications, then open it.

  The first time, macOS will say it can't check the app. Click Done, then go to
  System Settings > Privacy & Security, scroll down, and click "Open Anyway".
  You only do this once.

FIRST RUN
  The app sets itself up: it installs what it needs (~1 GB) and downloads the
  model (~5.5 GB). Your browser shows the progress. After that it opens in
  seconds.

USING IT
  The app opens in your browser. Keep the app running while you use it (it's
  in the Dock). To stop it, press Quit on the page or quit it from the Dock.
  Clicking the Dock icon again brings the page back.

  - "Keep from reference": low = new picture loosely based on yours,
    high = close to your image with small changes.
  - Same seed + same settings = same picture. "Reuse seed" helps tweak a prompt.

REMOVE IT
  Delete the app, then these two folders:
    ~/Library/Application Support/Z-Image Studio     (the app's Python, ~2 GB)
    ~/.cache/huggingface/hub/models--filipstrand--Z-Image-Turbo-mflux-4bit   (the model)
