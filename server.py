"""Z-Image Studio: a local page for Z-Image Turbo with an optional reference image.

Nothing is kept on disk. The reference image goes into a temp folder that is
deleted as soon as the image is made, and the result is sent straight back to
the browser. Only the app's packages and the model weights are cached.

This file only needs the standard library to start. On first run it installs
mflux into its own Python (with uv) and downloads the model, and the page shows
progress while that happens.
"""

import base64
import importlib
import io
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PACKAGES = ["mflux==0.23.0", "pillow==12.3.0"]  # mflux 0.23 breaks on newer Pillow
MODEL_REPO = "filipstrand/Z-Image-Turbo-mflux-4bit"  # pre-quantized 4-bit, ~5.5 GB
PORT = 7860
HERE = Path(__file__).parent
MAX_SIDE = 1536
UV = os.environ.get("ZIS_UV", "uv")

state = {"phase": "starting", "progress": None, "error": None, "busy": False}
model = None
mflux_cmd = None  # (ZImageTurboCommand, build_parser) once mflux is importable
# MLX streams belong to the thread that made them, so setup and every model call
# run on this one worker. One image at a time also keeps memory inside 16 GB.
worker = ThreadPoolExecutor(max_workers=1)


def set_phase(phase, progress=None):
    state.update(phase=phase, progress=progress)
    print(f"[{phase}]", flush=True)


def import_mflux():
    global mflux_cmd
    importlib.invalidate_caches()
    from mflux.models.z_image.cli.z_image_turbo_generate import ZImageTurboCommand, build_parser
    mflux_cmd = (ZImageTurboCommand, build_parser)


def download_model():
    from huggingface_hub import HfApi, snapshot_download
    try:
        snapshot_download(MODEL_REPO, local_files_only=True)
        return  # already on this Mac
    except Exception:
        pass
    set_phase("downloading", 0.0)
    from tqdm.auto import tqdm

    total = sum(f.size or 0 for f in HfApi().model_info(MODEL_REPO, files_metadata=True).siblings) or 1

    class Progress(tqdm):
        # The hub keeps two byte bars: bytes received and bytes written. Xet receives
        # compressed chunks well before it writes files, so show whichever is ahead.
        def update(self, n=1):
            shown = super().update(n)
            if self.unit == "B":
                state["progress"] = min(0.99, max(state["progress"] or 0, self.n / total))
            return shown

    snapshot_download(MODEL_REPO, tqdm_class=Progress)


def setup():
    global model
    try:
        try:
            import_mflux()
        except ImportError:
            set_phase("installing")
            subprocess.run([UV, "pip", "install", "--python", sys.executable, *PACKAGES], check=True)
            import_mflux()
        download_model()
        set_phase("loading")
        command, _ = mflux_cmd
        model = command.load(make_args("warmup", 9, 0, 1024, 1024))
        set_phase("ready")
    except (Exception, SystemExit) as e:
        state["error"] = f"{type(e).__name__}: {e}"
        set_phase("error")
        print(f"Setup failed: {state['error']}", file=sys.stderr, flush=True)


def make_args(prompt, steps, seed, width, height, image_path=None, strength=None):
    argv = ["--prompt", prompt, "--model", MODEL_REPO, "--base-model", "z-image-turbo", "--steps", str(steps),
            "--seed", str(seed), "--width", str(width), "--height", str(height), "--no-exif"]
    if image_path:
        argv += ["--image", str(image_path), str(strength)]
    saved, sys.argv = sys.argv, ["mflux-generate-z-image-turbo", *argv]  # mflux's parser only reads sys.argv
    try:
        return mflux_cmd[1]().parse_args()
    finally:
        sys.argv = saved


def snap(n):
    return max(256, min(MAX_SIDE, int(n) // 16 * 16))


def run(req):
    if model is None:
        raise RuntimeError(state["error"] or "The model isn't ready yet.")
    state["busy"] = True
    try:
        prompt = req["prompt"]
        with tempfile.TemporaryDirectory(prefix="zimage-") as tmp:
            ref_path = None
            if req["image"]:
                ref_path = Path(tmp) / "ref"
                ref_path.write_bytes(base64.b64decode(req["image"].split(",", 1)[-1]))
            args = make_args(prompt, req["steps"], req["seed"], req["width"], req["height"], ref_path, req["strength"])
            started = time.time()
            result = mflux_cmd[0].generate(model, args, req["seed"], prompt)
            buf = io.BytesIO()
            result.image.save(buf, format="PNG")
        return {"image": base64.b64encode(buf.getvalue()).decode(), "seed": req["seed"],
                "seconds": round(time.time() - started, 1), "width": req["width"], "height": req["height"]}
    finally:
        state["busy"] = False


def generate(req):
    prompt = (req.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Write a prompt first.")
    seed = str(req.get("seed", "")).strip()
    clean = {
        "prompt": prompt,
        "image": req.get("image") or None,
        "steps": max(1, min(20, int(req.get("steps", 9)))),
        "seed": int(seed) if seed else random.randint(0, 2**31 - 1),
        "width": snap(req.get("width", 1024)),
        "height": snap(req.get("height", 1024)),
        "strength": max(0.05, min(0.95, float(req.get("strength", 0.4)))),
    }
    return worker.submit(run, clean).result()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/status":
            self.send(200, state)
        else:
            self.send(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/quit":
            self.send(200, {"ok": True})
            threading.Timer(0.3, os._exit, [0]).start()
            return
        if self.path != "/generate":
            return self.send(404, {"error": "Not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            self.send(200, generate(req))
        except ValueError as e:
            self.send(400, {"error": str(e)})
        except (Exception, SystemExit) as e:  # show the real reason on the page
            print(f"Error: {e!r}", file=sys.stderr, flush=True)
            self.send(500, {"error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    # A run that was closed mid-image can leave its reference behind; clear those.
    for old in Path(tempfile.gettempdir()).glob("zimage-*"):
        shutil.rmtree(old, ignore_errors=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # this Mac only
    url = f"http://127.0.0.1:{PORT}"
    print(f"Z-Image Studio is running at {url}", flush=True)
    worker.submit(setup)
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    server.serve_forever()
