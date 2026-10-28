"""Z-Image Studio engine: a local HTTP server the app's window talks to.

It installs mflux on first run, downloads every model this Mac can run, and
makes images. Nothing is written to disk except the app's own packages and the
model weights: results live in memory until the app quits, and reference
images sit in a temp folder only while an image is being made.

Starts with the standard library only, so it can come up before mflux exists.
"""

import base64
import gc
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from catalog import BY_ID, MODELS

PACKAGES = ["mflux==0.23.0", "pillow==12.3.0"]  # mflux 0.23 breaks on newer Pillow
PORT = int(os.environ.get("ZIS_PORT", "7860"))
UI = Path(os.environ.get("ZIS_UI", Path(__file__).parent.parent / "ui"))
UV = os.environ.get("ZIS_UV", "uv")
RAM_GB = round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30)
MAX_SIDE = 2048
SPARE_DISK_GB = 2  # leave this much free after a download

setup = {"phase": "starting", "error": None}  # starting > installing > ready | error
downloads = {m["id"]: {"state": "unknown", "progress": None, "error": None} for m in MODELS}
download_wake = threading.Event()
jobs = {}
images = {}  # image id -> PNG bytes, in memory only
loaded = {"id": None, "model": None}
# MLX streams belong to the thread that made them, so every model call runs on
# this one worker. One model in memory at a time keeps a 16 GB Mac comfortable.
worker = ThreadPoolExecutor(max_workers=1)


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def runnable(m):
    return RAM_GB >= m["min_ram"]


# ---------- setup and downloads ----------

def install_packages():
    try:
        import mflux  # noqa: F401
    except ImportError:
        setup["phase"] = "installing"
        subprocess.run([UV, "pip", "install", "--python", sys.executable, *PACKAGES], check=True)
        importlib.invalidate_caches()


def hub_dir():
    from huggingface_hub import constants
    return Path(constants.HF_HUB_CACHE)


def is_installed(m):
    from huggingface_hub import snapshot_download
    try:
        snapshot_download(m["repo"], allow_patterns=m["patterns"], local_files_only=True)
        return True
    except Exception:
        return False


def download(m):
    from huggingface_hub import HfApi, snapshot_download
    from huggingface_hub.utils import filter_repo_objects
    from tqdm.auto import tqdm

    d = downloads[m["id"]]
    siblings = HfApi().model_info(m["repo"], files_metadata=True).siblings
    wanted = set(filter_repo_objects([s.rfilename for s in siblings], allow_patterns=m["patterns"]))
    total = sum(s.size or 0 for s in siblings if s.rfilename in wanted) or 1

    class Progress(tqdm):
        # The hub keeps two byte bars: bytes received and bytes written. Xet receives
        # compressed chunks well before it writes files, so show whichever is ahead.
        def update(self, n=1):
            shown = super().update(n)
            if self.unit == "B":
                d["progress"] = min(0.99, max(d["progress"] or 0, self.n / total))
            return shown

    d.update(state="downloading", progress=0.0, error=None)
    snapshot_download(m["repo"], allow_patterns=m["patterns"], tqdm_class=Progress)


def download_loop():
    """Fetch every model this Mac can run."""
    for m in MODELS:
        if not runnable(m):
            downloads[m["id"]].update(state="unsupported")
        elif is_installed(m):
            downloads[m["id"]].update(state="installed", progress=1.0)
        else:
            downloads[m["id"]].update(state="queued")
    while True:
        for m in sorted(MODELS, key=lambda m: m["min_ram"]):  # everything a 16 GB Mac needs comes first
            d = downloads[m["id"]]
            if d["state"] not in ("queued", "retry"):
                continue
            hub = hub_dir()
            hub.mkdir(parents=True, exist_ok=True)
            free_gb = shutil.disk_usage(hub).free / 1e9
            if free_gb < m["size_gb"] + SPARE_DISK_GB:
                d.update(state="no_space", error=f"Needs {m['size_gb'] + SPARE_DISK_GB:.0f} GB free, this Mac has {free_gb:.0f} GB.")
                continue
            try:
                download(m)
                d.update(state="installed", progress=1.0, error=None)
            except Exception as e:
                log(f"Download of {m['id']} failed: {e!r}")
                d.update(state="failed", error=str(e)[:300])
        download_wake.wait()  # sleep until someone asks to retry
        download_wake.clear()


def start():
    try:
        install_packages()
        setup["phase"] = "ready"
    except Exception as e:
        setup.update(phase="error", error=f"{type(e).__name__}: {e}")
        log(f"Setup failed: {setup['error']}")
        return
    download_loop()


# ---------- models ----------

class Stop(Exception):
    pass


class StepHook:
    """mflux calls this once per step: it reports progress, handles Cancel, and
    decodes the half-made image so the UI can show it forming from noise."""
    job = None

    def __init__(self, model, latent_creator):
        self.model = model
        self.latent_creator = latent_creator

    def call_in_loop(self, t, seed, prompt, latents, config, time_steps, **_):
        job = StepHook.job
        if job is None:
            return
        if job["cancel"]:
            from mflux.utils.exceptions import StopImageGenerationException
            raise StopImageGenerationException("Cancelled")
        job["progress"]["step"] += 1
        if job["request"]["preview"] and self.latent_creator and job["progress"]["step"] < job["progress"]["steps"]:
            try:
                job["preview"] = self.preview(latents, config)
                job["preview_n"] += 1
            except Exception as e:  # a preview is a nicety; never fail the image for it
                log(f"Preview failed: {e!r}")
                job["request"]["preview"] = False

    def preview(self, latents, config):
        import io
        from mflux.utils.image_util import ImageUtil
        unpacked = self.latent_creator.unpack_latents(latents=latents, height=config.height, width=config.width)
        vae = self.model.vae
        if hasattr(vae, "decode_packed_latents") and unpacked.shape[1] > getattr(vae, "latent_channels", 32):
            decoded = vae.decode_packed_latents(unpacked)
        else:
            decoded = vae.decode(unpacked)
        image = ImageUtil.to_pil(decoded)
        image.thumbnail((640, 640))
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=80)
        return buf.getvalue()


def parse_args(module, argv, prog):
    saved, sys.argv = sys.argv, [prog, *argv]  # mflux's parsers only read sys.argv
    try:
        return module.build_parser().parse_args()
    finally:
        sys.argv = saved


def unload():
    if loaded["model"] is not None:
        loaded.update(id=None, model=None)
        gc.collect()
        import mlx.core as mx
        mx.clear_cache()


def load(model_id):
    if loaded["id"] == model_id:
        return loaded["model"]
    unload()
    m = BY_ID[model_id]
    if m["family"] == "zimage":
        from mflux.models.z_image.cli import z_image_turbo_generate as zt
        args = parse_args(zt, ["--prompt", "x", "--model", m["repo"], "--base-model", "z-image-turbo"], "mflux-generate-z-image-turbo")
        model = zt.ZImageTurboCommand.load(args)
        latent_creator = zt.ZImageTurboCommand.latent_creator
    elif m["family"] == "klein":
        from mflux.models.common.resolution.config_resolution import ConfigResolution
        from mflux.models.flux2.cli.flux2_edit_generate import DEFAULT_MODEL, FAMILY_MODELS
        from mflux.models.flux2.variants import Flux2KleinEdit
        config = ConfigResolution.resolve_restricted(m["repo"], DEFAULT_MODEL, model_path=None,
                                                     extra_keys=FAMILY_MODELS, base_model="flux2-klein-4b")
        from mflux.models.flux2.latent_creator.flux2_latent_creator import Flux2LatentCreator
        model = Flux2KleinEdit(model_config=config, quantize=None, model_path=None)
        latent_creator = Flux2LatentCreator
    elif m["family"] == "seedvr2":
        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.seedvr2.variants.upscale.seedvr2 import SeedVR2
        model = SeedVR2(quantize=None, model_path=None, model_config=ModelConfig.seedvr2_3b())
        latent_creator = None  # one step, nothing to preview
    else:
        raise ValueError(f"Unknown model family {m['family']}")
    if hasattr(model, "callbacks"):
        model.callbacks.register(StepHook(model, latent_creator))
    loaded.update(id=model_id, model=model)
    return model


def save_inputs(tmp, refs):
    paths = []
    for i, ref in enumerate(refs):
        p = Path(tmp) / f"ref{i}"
        if ref.startswith("img:"):
            p.write_bytes(images[ref[4:]])
        else:
            p.write_bytes(base64.b64decode(ref.split(",", 1)[-1]))
        paths.append(p)
    return paths


def keep(pil_image):
    import io
    buf = io.BytesIO()
    pil_image.save(buf, format="PNG")
    image_id = uuid.uuid4().hex[:12]
    images[image_id] = buf.getvalue()
    return image_id


def make_one(job, model, m, paths, seed):
    r = job["request"]
    if m["family"] == "zimage":
        from mflux.models.z_image.cli import z_image_turbo_generate as zt
        argv = ["--prompt", r["prompt"], "--model", m["repo"], "--base-model", "z-image-turbo",
                "--steps", str(r["steps"]), "--seed", str(seed), "--width", str(r["width"]),
                "--height", str(r["height"]), "--no-exif"]
        if paths:
            argv += ["--image", str(paths[0]), str(r["strength"])]
        args = parse_args(zt, argv, "mflux-generate-z-image-turbo")
        return zt.ZImageTurboCommand.generate(model, args, seed, r["prompt"]).image
    if m["family"] == "klein":
        return model.generate_image(seed=seed, prompt=r["prompt"], width=r["width"], height=r["height"],
                                    guidance=1.0, image_paths=paths or None, num_inference_steps=r["steps"],
                                    scheduler="flow_match_euler_discrete").image
    # SeedVR2: `resolution` is the target length of the shortest side.
    from PIL import Image
    with Image.open(paths[0]) as im:
        short = min(im.size)
    target = min(MAX_SIDE, short * r.get("scale", 2)) // 16 * 16
    return model.generate_image(seed=seed, image_path=paths[0], resolution=target).image


def run_job(job):
    r = job["request"]
    m = BY_ID[r["model"]]
    job["state"] = "loading"
    StepHook.job = job
    try:
        if downloads[m["id"]]["state"] != "installed":
            raise RuntimeError(f"{m['name']} isn't downloaded yet.")
        model = load(m["id"])
        job["state"] = "running"
        with tempfile.TemporaryDirectory(prefix="zimage-") as tmp:
            paths = save_inputs(tmp, r["refs"])
            for i, seed in enumerate(r["seeds"]):
                job["progress"].update(index=i, step=0)
                job["preview"] = None
                started = time.time()
                image_id = keep(make_one(job, model, m, paths, seed))
                job["images"].append({"id": image_id, "seed": seed, "model": m["id"],
                                      "seconds": round(time.time() - started, 1)})
        job["state"] = "done"
    except Exception as e:
        if job["cancel"] or "Cancelled" in str(e):
            job["state"] = "cancelled"
        else:
            log(f"Job failed: {e!r}")
            job.update(state="error", error=f"{type(e).__name__}: {e}")
    except SystemExit as e:  # mflux's argument parser exits on bad input
        job.update(state="error", error=f"Bad settings: {e}")
    finally:
        StepHook.job = None


def snap(n):
    return max(256, min(MAX_SIDE, int(n) // 16 * 16))


def new_job(req):
    if setup["phase"] != "ready":
        raise ValueError("Still setting up. One moment.")
    model_id = req.get("model")
    if model_id not in BY_ID:
        raise ValueError("Pick a model.")
    m = BY_ID[model_id]
    if not runnable(m):
        raise ValueError(f"{m['name']} needs a {m['min_ram']} GB Mac.")
    prompt = (req.get("prompt") or "").strip()
    refs = [x for x in (req.get("refs") or []) if isinstance(x, str)][:3]
    if m["kind"] == "image" and not prompt:
        raise ValueError("Write a prompt first.")
    if m["kind"] == "tool" and not refs:
        raise ValueError("Pick an image to upscale.")
    count = max(1, min(4, int(req.get("count", 1))))
    seed = str(req.get("seed", "")).strip()
    first = int(seed) if re.fullmatch(r"\d+", seed) else int.from_bytes(os.urandom(4), "big") >> 1
    job = {
        "id": uuid.uuid4().hex[:12], "state": "queued", "error": None, "cancel": False, "images": [],
        "preview": None, "preview_n": 0,
        "progress": {"index": 0, "count": count, "step": 0, "steps": int(req.get("steps") or m["steps"])},
        "request": {
            "model": model_id, "prompt": prompt, "refs": refs, "seeds": [first + i for i in range(count)],
            "steps": max(1, min(30, int(req.get("steps") or m["steps"]))),
            "width": snap(req.get("width", 1024)), "height": snap(req.get("height", 1024)),
            "strength": max(0.05, min(0.95, float(req.get("strength", 0.45)))),
            "scale": 2,
            "preview": bool(req.get("preview", True)),
        },
    }
    job["progress"]["steps"] = job["request"]["steps"]
    jobs[job["id"]] = job
    worker.submit(run_job, job)
    return job


def public_job(job):
    return {k: job[k] for k in ("id", "state", "error", "images", "progress", "preview_n")} | {"model": job["request"]["model"]}


def status():
    return {
        "setup": setup, "ram_gb": RAM_GB, "loaded": loaded["id"],
        "free_disk_gb": round(shutil.disk_usage(Path.home()).free / 1e9, 1),
        "models": [{k: v for k, v in m.items() if k not in ("repo", "patterns", "family")}
                   | {"runnable": runnable(m), "download": downloads[m["id"]]} for m in MODELS],
    }


# ---------- HTTP ----------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
         ".svg": "image/svg+xml", ".png": "image/png"}


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

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/status":
            return self.send(200, status())
        if m := re.fullmatch(r"/jobs/(\w+)", path):
            job = jobs.get(m[1])
            return self.send(200, public_job(job)) if job else self.send(404, {"error": "No such job"})
        if m := re.fullmatch(r"/jobs/(\w+)/preview\.jpg", path):
            data = (jobs.get(m[1]) or {}).get("preview")
            return self.send(200, data, "image/jpeg") if data else self.send(404, {"error": "No preview"})
        if m := re.fullmatch(r"/images/(\w+)\.png", path):
            data = images.get(m[1])
            return self.send(200, data, "image/png") if data else self.send(404, {"error": "Gone"})
        file = (UI / (path.lstrip("/") or "index.html")).resolve()
        if file.is_file() and UI.resolve() in file.parents:
            return self.send(200, file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"))
        self.send(404, {"error": "Not found"})

    def do_POST(self):
        try:
            if self.path == "/jobs":
                return self.send(200, public_job(new_job(self.body())))
            if m := re.fullmatch(r"/jobs/(\w+)/cancel", self.path):
                if job := jobs.get(m[1]):
                    job["cancel"] = True
                return self.send(200, {"ok": True})
            if self.path == "/images":  # keep an image made in the app (e.g. background removed)
                data = base64.b64decode(self.body()["data"].split(",", 1)[-1])
                image_id = uuid.uuid4().hex[:12]
                images[image_id] = data
                return self.send(200, {"id": image_id})
            if self.path == "/downloads/retry":
                for d in downloads.values():
                    if d["state"] in ("failed", "no_space"):
                        d["state"] = "retry"
                download_wake.set()
                return self.send(200, {"ok": True})
            self.send(404, {"error": "Not found"})
        except ValueError as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            log(f"Error: {e!r}")
            self.send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_DELETE(self):
        if m := re.fullmatch(r"/images/(\w+)", self.path):
            images.pop(m[1], None)
        self.send(200, {"ok": True})


if __name__ == "__main__":
    # A run that was closed mid-image can leave its reference behind; clear those.
    for old in Path(tempfile.gettempdir()).glob("zimage-*"):
        shutil.rmtree(old, ignore_errors=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # this Mac only
    threading.Thread(target=start, daemon=True).start()
    print(f"LISTENING {PORT}", flush=True)  # the app waits for this line
    server.serve_forever()
