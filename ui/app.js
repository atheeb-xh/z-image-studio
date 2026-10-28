// Z-Image Studio UI. Talks to the local engine (engine/server.py) and, inside the
// Mac app, to the native shell (app/main.swift) for Save, Copy and Remove background.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- static data ----------

const PRESETS = [
  { id: "none", emoji: "○", name: "None", text: "" },
  { id: "cinematic", emoji: "🎬", name: "Cinematic", text: "cinematic film still, dramatic lighting, shallow depth of field, rich colour grading, 35mm film grain" },
  { id: "portrait", emoji: "👤", name: "Portrait", text: "professional portrait photo, 85mm lens, soft studio light, sharp focus on the eyes, natural skin texture" },
  { id: "product", emoji: "📦", name: "Product", text: "studio product photography, clean seamless background, softbox lighting, crisp reflections, high detail" },
  { id: "street", emoji: "🛺", name: "Indian street", text: "candid street photography in India, natural daylight, vibrant colours, documentary style" },
  { id: "poster", emoji: "🎞️", name: "Film poster", text: "Bollywood movie poster, bold dramatic composition, glossy lighting, large title text" },
  { id: "anime", emoji: "✏️", name: "Anime", text: "anime illustration, clean line art, cel shading, vibrant colours" },
  { id: "3d", emoji: "🧸", name: "3D cartoon", text: "3D animated film style, soft global illumination, cute expressive character, high detail render" },
  { id: "watercolor", emoji: "🎨", name: "Watercolour", text: "watercolour painting, soft washes, visible paper texture, gentle colours" },
  { id: "flat", emoji: "◆", name: "Flat graphic", text: "flat vector illustration, minimal, bold shapes, solid colours, clean background" },
  { id: "food", emoji: "🍛", name: "Food", text: "food photography, natural window light, appetizing, shallow depth of field, high detail" },
  { id: "noir", emoji: "🌑", name: "Black & white", text: "black and white photograph, high contrast, deep shadows, fine grain" },
];

const SHAPES = [
  { id: "ref", name: "Match", w: 0, h: 0 },
  { id: "1:1", name: "1:1", w: 1024, h: 1024 },
  { id: "3:4", name: "3:4", w: 896, h: 1152 },
  { id: "9:16", name: "9:16", w: 768, h: 1344 },
  { id: "4:3", name: "4:3", w: 1152, h: 896 },
  { id: "16:9", name: "16:9", w: 1344, h: 768 },
];

const IDEAS = [
  "A chai seller in a Mumbai street at golden hour",
  "Neon poster that says “DIWALI NIGHTS”, bold type",
  "A cosy Kerala houseboat at dawn, mist on the water",
  "Product shot of a brass diya on black marble",
];

const QUALITY_TIP = {
  title: "Quality",
  text: "Fast uses the 4-bit models, which run on any 16 GB Mac. Best uses the HQ (8-bit) versions: finer detail, a bit slower, and only on a 24 GB Mac.",
};

// ---------- state ----------

const S = {
  status: null,
  model: "auto",
  refs: [],          // [{src, value}] value is "img:<id>" or a data URL
  preset: "none",
  shape: "1:1",
  count: 1,
  quality: "fast",
  job: null,
  gallery: [],       // [{id, seed, model, prompt, settings, w, h, kind}]
  current: [],       // gallery ids shown on the stage
  selected: null,
  shapeTouched: false,
  enhanceBackup: null,
};

const model = (id) => S.status?.models.find((m) => m.id === id);
const installed = (id) => model(id)?.download.state === "installed";
const imageModels = () => (S.status?.models || []).filter((m) => m.kind === "image" && !m.hq_of);

// ---------- native bridge ----------

const inApp = !!window.webkit?.messageHandlers?.native;
const pending = {};
function native(action, payload = {}) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    pending[id] = resolve;
    window.webkit.messageHandlers.native.postMessage({ action, id, ...payload });
  });
}
window.nativeReply = (id, data) => { pending[id]?.(data); delete pending[id]; };

// ---------- API ----------

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ---------- routing (Auto) ----------

const EDIT_WORDS = /\b(add|adding|remove|erase|delete|replace|change|swap|make (him|her|them|it|me|this|the)|put|give (him|her|them|it)|turn (him|her|them|it|this|the)|wear(ing|s)?|hold(ing|s)?|without|instead|recolou?r|fix|move|keep|same (person|face|man|woman))\b/i;
const STYLE_WORDS = /\b(in the style of|style of|like this|similar to|inspired by|same (style|vibe|colou?rs?|mood)|variation)\b/i;

/** Picks a model for Auto and says why. */
function route(prompt, refs) {
  const p = prompt.toLowerCase();
  if (refs >= 2) return { family: "klein", why: "you gave more than one image, and only Klein can combine them" };
  if (refs === 1) {
    if (STYLE_WORDS.test(p) && !EDIT_WORDS.test(p)) return { family: "zimage", why: "you want a new picture in the feel of your image" };
    return { family: "klein", why: "you gave a photo and a change to make; Klein edits and keeps the rest" };
  }
  if (/["“”]|\b(text|says|saying|title|logo|poster|sign|banner|headline|label)\b/.test(p))
    return { family: "zimage", why: "it's good at short text in images" };
  return { family: "zimage", why: "it's fast and realistic for a new picture" };
}

/** Turns a family into a concrete installed model, preferring HQ for Best. */
function pick(family) {
  const base = S.status.models.find((m) => m.family_id === family) || S.status.models.find((m) => m.id === family);
  const hq = S.status.models.find((m) => m.hq_of === base.id);
  if (S.quality === "best" && hq?.runnable && installed(hq.id)) return hq;
  return base;
}

function chosen() {
  const prompt = $("prompt").value;
  if (S.model === "auto") {
    const r = route(prompt, S.refs.length);
    let m = pick(r.family);
    let why = r.why;
    if (!installed(m.id)) {  // fall back while it downloads
      const other = pick(r.family === "klein" ? "zimage" : "klein");
      if (installed(other.id) && !(r.family === "klein" && S.refs.length > 1)) {
        why = `${m.name} is still downloading, so using ${other.name} for now`;
        m = other;
      }
    }
    return { m, why, auto: true };
  }
  let m = model(S.model);
  if (m.kind === "image") m = pick(m.id);
  return { m, auto: false };
}

// ---------- prompt helper ----------

const SUBJECTS = [
  [/\b(man|woman|boy|girl|person|people|portrait|face|child|kid|uncle|aunty|bride|groom|he|she)\b/i,
    "natural expression, detailed skin and hair, soft directional light, shallow depth of field, shot on a full-frame camera"],
  [/\b(product|bottle|watch|shoe|phone|packaging|jar|perfume|bag|diya)\b/i,
    "studio lighting, clean background, sharp focus, crisp reflections, commercial photography"],
  [/\b(food|dish|biryani|dosa|thali|chai|coffee|cake|curry|street food)\b/i,
    "appetizing, natural window light, close-up, steam and texture visible, food photography"],
  [/\b(city|street|market|village|mountain|beach|forest|river|landscape|sky|temple|house|room|interior)\b/i,
    "wide shot, atmospheric light, rich detail, depth and scale, professional photography"],
  [/\b(poster|logo|banner|sign|text|title)\b/i,
    "bold clear typography, strong layout, high contrast, print-ready design"],
  [/\b(cat|dog|bird|tiger|elephant|cow|horse|animal)\b/i,
    "detailed fur and eyes, natural habitat light, wildlife photography, sharp focus"],
];

function enhance(prompt, isEdit) {
  let p = prompt.trim().replace(/\s+/g, " ");
  if (!p) return p;
  if (isEdit) {
    p = p.charAt(0).toUpperCase() + p.slice(1);
    if (!/[.!]$/.test(p)) p += ".";
    if (!/\bkeep\b/i.test(p)) p += " Keep the same person, face, pose, clothing and background. Change nothing else.";
    return p;
  }
  const extra = SUBJECTS.find(([re]) => re.test(p))?.[1] || "highly detailed, beautiful light, sharp focus, professional photography";
  if (!/[,.]$/.test(p)) p += ",";
  return `${p} ${extra}`;
}

// ---------- rendering ----------

function renderPicker() {
  const box = $("modelPicker");
  const opts = [{ id: "auto", name: "Auto", sub: "Picks the best model for your prompt", icon: "✦" },
    ...imageModels().map((m) => ({ id: m.id, name: m.name, sub: m.tagline, icon: m.id === "klein" ? "✎" : "◐", m }))];
  box.replaceChildren(...opts.map((o) => {
    const b = el("button", "model-opt" + (S.model === o.id ? " on" : ""));
    const st = o.m?.download.state;
    const badge = !o.m ? "" : st === "installed" ? "" : st === "downloading"
      ? `<span class="badge dl">${Math.round((o.m.download.progress || 0) * 100)}%</span>`
      : st === "unsupported" ? `<span class="badge off">${o.m.min_ram} GB</span>` : `<span class="badge">waiting</span>`;
    b.innerHTML = `<span class="m-icon">${o.icon}</span><span class="m-text"><span class="m-name">${esc(o.name)} ${badge}</span><span class="m-sub">${esc(o.sub)}</span></span>`;
    if (o.m) {
      const i = el("span", "info-btn", "i");
      i.dataset.model = o.m.id;
      b.append(i);
    }
    b.onclick = () => { S.model = o.id; renderAll(); };
    return b;
  }));
}

function renderNote() {
  if (!S.status) return;
  const { m, why, auto } = chosen();
  const note = $("autoNote");
  if (auto) note.innerHTML = `Using <b>${esc(m.name)}</b>: ${esc(why)}.`;
  else if (m.id !== S.model) note.innerHTML = `Using <b>${esc(m.name)}</b> for Best quality.`;
  else note.textContent = "";
}

function renderRefs() {
  const box = $("refs");
  const { m } = S.status ? chosen() : { m: null };
  const limit = m?.family_id === "zimage" ? 1 : 3;
  box.querySelectorAll(".ref").forEach((n) => n.remove());
  S.refs.forEach((r, i) => {
    const d = el("div", "ref" + (i >= limit ? " unused" : ""));
    d.title = i >= limit ? `${m.name} uses only the first image` : "";
    d.innerHTML = `<img src="${r.src}" alt=""><button class="x" title="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${S.refs.length > 1 ? `<span class="tag">${i + 1}</span>` : ""}`;
    d.querySelector(".x").onclick = () => { S.refs.splice(i, 1); renderAll(); };
    box.insertBefore(d, $("refAdd"));
  });
  $("refAdd").hidden = S.refs.length >= 3;
  $("refHint").textContent = S.refs.length ? (m?.family_id === "zimage" ? "Z-Image uses 1" : "up to 3") : "optional";
  $("strengthBox").hidden = !(S.refs.length && m?.family_id === "zimage");
  if (S.refs.length && !S.shapeTouched) S.shape = "ref";
  if (!S.refs.length && S.shape === "ref") S.shape = "1:1";
}

function renderPresets() {
  $("presets").replaceChildren(...PRESETS.map((p) => {
    const b = el("button", "preset" + (S.preset === p.id ? " on" : ""), `<span class="p-emoji">${p.emoji}</span>${esc(p.name)}`);
    b.title = p.text || "No added style";
    b.onclick = () => { S.preset = p.id; renderPresets(); };
    return b;
  }));
}

function renderSeg(id, items, current, onPick) {
  $(id).replaceChildren(...items.map((it) => {
    const b = el("button", it.id === current ? "on" : "", it.html || esc(it.name));
    b.disabled = !!it.disabled;
    if (it.title) b.title = it.title;
    b.onclick = () => onPick(it.id);
    return b;
  }));
}

function renderControls() {
  renderSeg("shapes", SHAPES.map((s) => {
    const [w, h] = s.id === "ref" ? [14, 14] : [s.w / 80, s.h / 80].map((n) => Math.round(n));
    const icon = s.id === "ref" ? `<svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/></svg>`
      : `<span class="shape-ic" style="width:${w}px;height:${h}px"></span>`;
    return { ...s, html: `${icon}<span>${s.name}</span>`, disabled: s.id === "ref" && !S.refs.length, title: s.id === "ref" ? "Same shape as your first image" : "" };
  }), S.shape, (id) => { S.shape = id; S.shapeTouched = true; renderControls(); });

  const isTool = S.status && chosen().m.kind === "tool";
  renderSeg("count", [1, 2, 3, 4].map((n) => ({ id: n, name: String(n), disabled: isTool && n > 1 })), S.count,
    (n) => { S.count = n; renderControls(); });

  const hqAvail = (S.status?.models || []).some((m) => m.hq_of && m.runnable);
  renderSeg("quality", [
    { id: "fast", name: "Fast" },
    { id: "best", name: "Best", disabled: !hqAvail, title: hqAvail ? "" : "Needs a 24 GB Mac" },
  ], S.quality, (q) => { S.quality = q; renderAll(); });
}

function renderGenerate() {
  const msg = $("genMsg");
  const go = $("go");
  if (!S.status) { go.disabled = true; return; }
  if (S.status.setup.phase !== "ready") {
    go.disabled = true;
    msg.textContent = S.status.setup.phase === "error" ? "Setup failed: " + S.status.setup.error : "Installing the engine (one time, a few minutes)…";
    return;
  }
  const { m } = chosen();
  const d = m.download;
  let text = "";
  if (!m.runnable) text = `${m.name} needs a ${m.min_ram} GB Mac.`;
  else if (d.state === "downloading") text = `${m.name} is downloading (${Math.round((d.progress || 0) * 100)}%).`;
  else if (d.state === "no_space") text = d.error;
  else if (d.state === "failed") text = `${m.name} failed to download. Open Models to retry.`;
  else if (d.state !== "installed") text = `${m.name} is waiting to download.`;
  else if (m.kind === "tool" && !S.refs.length) text = "Add an image to upscale.";
  msg.textContent = text;
  go.disabled = !!text || !!S.job;
  $("goText").textContent = S.job ? "Working…" : m.kind === "tool" ? "Upscale" : S.count > 1 ? `Generate ${S.count}` : "Generate";
}

function renderModelsChip() {
  const ms = (S.status?.models || []).filter((m) => m.runnable);
  const done = ms.filter((m) => m.download.state === "installed").length;
  const dl = ms.find((m) => m.download.state === "downloading");
  const problem = ms.some((m) => ["failed", "no_space"].includes(m.download.state));
  const dot = $("modelsDot");
  dot.className = "dot " + (dl ? "busy" : problem ? "warn" : done === ms.length && ms.length ? "good" : "");
  $("modelsChipText").textContent = !S.status ? "Starting…" : S.status.setup.phase !== "ready" ? "Installing engine…"
    : dl ? `Downloading ${dl.name} · ${Math.round((dl.download.progress || 0) * 100)}%`
    : problem ? `Models ${done}/${ms.length} · needs attention` : `Models ${done}/${ms.length} ready`;
}

function renderSheet() {
  if ($("modelsSheet").hidden || !S.status) return;
  const st = S.status;
  $("machineLine").textContent = `This Mac has ${st.ram_gb} GB of memory and ${st.free_disk_gb} GB free disk. Models download in the background, one at a time.`;
  $("modelCards").replaceChildren(...st.models.map((m) => {
    const d = m.download;
    const c = el("div", "card" + (m.runnable ? "" : " off"));
    const state =
      d.state === "installed" ? `<div class="state good">✓ Ready</div>`
      : d.state === "downloading" ? `<div class="state"><div class="bar"><div class="fill" style="width:${Math.round((d.progress || 0) * 100)}%"></div></div>${Math.round((d.progress || 0) * 100)}%</div>`
      : d.state === "unsupported" ? `<div class="state warn">Needs a ${m.min_ram} GB Mac. Turned off here.</div>`
      : d.state === "no_space" ? `<div class="state warn">${esc(d.error)}</div>`
      : d.state === "failed" ? `<div class="state warn">Download failed. ${esc(d.error || "")}</div>`
      : `<div class="state">Waiting to download</div>`;
    c.innerHTML = `
      <h4>${esc(m.name)} <span class="badge${m.hq_of ? " hq" : ""}">${m.min_ram} GB+</span>${m.kind === "tool" ? '<span class="badge">tool</span>' : ""}</h4>
      <p class="tagline">${esc(m.tagline)}</p>
      <ul>${m.best.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <ul class="weak">${m.weak.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="facts"><b>Images</b><span>${esc(m.reference)}</span><b>Speed</b><span>${esc(m.speed)}</span>
        <b>Size</b><span>${m.size_gb} GB download</span><b>License</b><span>${esc(m.license)}</span></div>
      ${state}`;
    return c;
  }));
  const retry = st.models.some((m) => ["failed", "no_space"].includes(m.download.state));
  $("sheetFoot").innerHTML = `<span>Models are stored in ~/.cache/huggingface and shared with other apps that use them.</span>`
    + (retry ? `<button class="btn-ghost" id="retryDl">Retry downloads</button>` : "");
  if (retry) $("retryDl").onclick = async () => { await api("/downloads/retry", { method: "POST" }); toast("Retrying…"); };
}

function renderAll() {
  if (!S.status) return;
  renderPicker();
  renderRefs();
  renderNote();
  renderControls();
  renderGenerate();
  renderModelsChip();
  renderSheet();
}

// ---------- info tooltips ----------

function showTip(target) {
  const tip = $("tip");
  let html;
  if (target.dataset.tip === "quality") html = `<h5>${QUALITY_TIP.title}</h5><p>${QUALITY_TIP.text}</p>`;
  else {
    const m = model(target.dataset.model);
    if (!m) return;
    html = `<h5>${esc(m.name)}</h5><p>${esc(m.tagline)}</p>
      <div class="t-sec">Best for</div><ul>${m.best.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="t-sec">Not great at</div><ul>${m.weak.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="t-sec">With your images</div><p>${esc(m.reference)}</p>
      <div class="t-sec">Speed · memory</div><p>${esc(m.speed)} · needs ${m.min_ram} GB Mac</p>`;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 316, r.right + 10);
  tip.style.left = left + "px";
  tip.style.top = Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, r.top - 20)) + "px";
}
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest(".info-btn");
  if (t) showTip(t); else $("tip").hidden = true;
});
document.addEventListener("click", (e) => { if (e.target.closest(".info-btn")) e.stopPropagation(); }, true);

function toast(text, bad) {
  const t = $("toast");
  t.textContent = text;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- references ----------

function addRef(value, src) {
  if (S.refs.length >= 3) return toast("Up to 3 reference images.");
  S.refs.push({ value, src: src || value });
  renderAll();
}
function readFiles(files) {
  [...files].filter((f) => f.type.startsWith("image/")).slice(0, 3 - S.refs.length).forEach((f) => {
    const r = new FileReader();
    r.onload = () => downscale(r.result).then((d) => addRef(d));
    r.readAsDataURL(f);
  });
}
// Big phone photos are slow to send and the models work at ~1 MP anyway.
function downscale(dataUrl, max = 2048) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      if (s === 1) return resolve(dataUrl);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.92));
    };
    img.src = dataUrl;
  });
}
$("refAdd").onclick = () => $("file").click();
$("file").onchange = (e) => { readFiles(e.target.files); e.target.value = ""; };
document.addEventListener("paste", (e) => {
  const files = [...e.clipboardData.items].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
  if (files.length) { e.preventDefault(); readFiles(files); }
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { if (hasImage(e)) { dragDepth++; $("dropOverlay").hidden = false; } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropOverlay").hidden = true; } });
document.addEventListener("dragover", (e) => { if (hasImage(e)) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true;
  const own = e.dataTransfer.getData("text/zis-image");
  if (own) return addRef("img:" + own, `/images/${own}.png`);
  readFiles(e.dataTransfer.files);
});
const hasImage = (e) => [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/zis-image");

// ---------- generate ----------

function sizeFor() {
  if (S.shape === "ref" && S.refs.length) return refSize();
  const s = SHAPES.find((x) => x.id === S.shape) || SHAPES[1];
  return Promise.resolve([s.w, s.h]);
}
function refSize() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.sqrt((1024 * 1024) / (img.width * img.height));  // ~1 megapixel, same shape
      resolve([img.width * k, img.height * k].map((n) => Math.max(256, Math.round(n / 16) * 16)));
    };
    img.onerror = () => resolve([1024, 1024]);
    img.src = S.refs[0].src;
  });
}

async function generate(override) {
  if ($("go").disabled && !override) return;
  const { m, why } = chosen();
  const preset = PRESETS.find((p) => p.id === S.preset);
  let prompt = $("prompt").value.trim();
  const isEdit = m.family_id === "klein" && S.refs.length;
  if (preset.text) prompt = isEdit ? `${prompt}${/[.!]$/.test(prompt) ? "" : "."} Style: ${preset.text}.` : `${prompt}, ${preset.text}`;
  const [width, height] = await sizeFor();
  const steps = +$("steps").value || undefined;
  const req = override || {
    model: m.id, prompt, refs: S.refs.map((r) => r.value), count: m.kind === "tool" ? 1 : S.count,
    width, height, steps, seed: $("seed").value, strength: +$("strength").value,
  };
  const settings = { model: S.model, preset: S.preset, shape: S.shape, count: S.count, quality: S.quality,
    prompt: $("prompt").value, refs: [...S.refs], strength: $("strength").value, steps: $("steps").value };
  try {
    const job = await api("/jobs", { method: "POST", body: req });
    S.job = { ...job, settings, prompt: req.prompt, why, name: model(req.model).name, size: [req.width, req.height] };
    showProgress(true);
    renderGenerate();
    showPending(job.progress.count);
    poll();
  } catch (e) { toast(e.message, true); }
}

function showPending(n) {
  const box = $("results");
  box.className = "results n" + n;
  box.replaceChildren(...Array.from({ length: n }, () => el("div", "result pending")));
  box.hidden = false;
  $("empty").hidden = true;
  $("toolbar").hidden = true;
}

async function poll() {
  const job = S.job;
  if (!job) return;
  let j;
  try { j = await api(`/jobs/${job.id}`); } catch { return setTimeout(poll, 800); }
  const p = j.progress;
  const frac = (p.index + Math.min(p.step, p.steps) / p.steps) / p.count;
  $("progTitle").textContent = j.state === "loading" ? `Loading ${job.name}…` : j.state === "queued" ? "Waiting…" : `Making ${p.count > 1 ? `image ${p.index + 1} of ${p.count}` : "your image"} with ${job.name}`;
  $("progFill").classList.toggle("indet", j.state !== "running");
  $("progFill").style.width = Math.round(frac * 100) + "%";
  $("progText").textContent = j.state === "running" ? `Step ${Math.min(p.step, p.steps)} of ${p.steps}` : j.state === "loading" ? "First use of a model takes up to a minute" : "";

  // Show each image as it finishes.
  j.images.forEach((im, i) => {
    if (S.gallery.some((g) => g.id === im.id)) return;
    S.gallery.unshift({ ...im, prompt: job.prompt, settings: job.settings, w: job.size[0], h: job.size[1],
      kind: model(im.model).kind === "tool" ? "upscaled" : "image" });
    const slot = $("results").children[i];
    if (slot) fillSlot(slot, im.id);
  });

  if (["done", "error", "cancelled"].includes(j.state)) {
    S.job = null;
    showProgress(false);
    if (j.state === "error") toast(j.error, true);
    if (j.state === "cancelled") toast("Cancelled.");
    const made = j.images.map((x) => x.id);
    if (made.length) setCurrent(made); else if (!S.current.length) resetStage(); else setCurrent(S.current);
    renderAll();
    renderFilmstrip();
    return;
  }
  setTimeout(poll, 500);
}

function fillSlot(slot, id) {
  slot.className = "result";
  slot.dataset.id = id;
  slot.replaceChildren(el("img"));
  slot.firstChild.src = `/images/${id}.png`;
  slot.firstChild.onload = (e) => {  // the real size (an upscale's size is decided by the engine)
    const g = S.gallery.find((x) => x.id === id);
    if (g) { g.w = e.target.naturalWidth; g.h = e.target.naturalHeight; if (S.selected === id) select(id); }
  };
  slot.firstChild.draggable = true;
  slot.firstChild.ondragstart = (e) => e.dataTransfer.setData("text/zis-image", id);
  slot.onclick = () => select(id);
  slot.ondblclick = () => setCurrent([id]);
}

function showProgress(on) { $("progress").hidden = !on; }
$("cancel").onclick = () => S.job && api(`/jobs/${S.job.id}/cancel`, { method: "POST" });

function resetStage() {
  $("results").hidden = true; $("empty").hidden = false; $("toolbar").hidden = true; S.current = []; S.selected = null;
}

function setCurrent(ids) {
  ids = ids.filter((id) => S.gallery.some((g) => g.id === id));
  if (!ids.length) return resetStage();
  S.current = ids;
  const box = $("results");
  box.className = "results n" + ids.length;
  box.replaceChildren(...ids.map((id) => { const d = el("div", "result"); fillSlot(d, id); return d; }));
  box.hidden = false;
  $("empty").hidden = true;
  select(ids.includes(S.selected) ? S.selected : ids[0]);
}

function select(id) {
  S.selected = id;
  document.querySelectorAll(".result").forEach((r) => r.classList.toggle("sel", r.dataset.id === id));
  document.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("on", t.dataset.id === id));
  const g = S.gallery.find((x) => x.id === id);
  if (!g) return;
  $("toolbar").hidden = false;
  const name = model(g.model)?.name || (g.kind === "cutout" ? "Background removed" : "");
  $("meta").textContent = [name, g.w && `${g.w}×${g.h}`, g.seed != null && `seed ${g.seed}`, g.seconds && `${g.seconds}s`].filter(Boolean).join(" · ")
    + (g.prompt ? `  —  ${g.prompt}` : "");
  $("meta").title = g.prompt || "";
  const up = model("upscaler");
  const btn = (a) => document.querySelector(`[data-act="${a}"]`);
  btn("upscale").disabled = !up?.runnable || !installed("upscaler") || !!S.job;
  btn("upscale").title = installed("upscaler") ? "Make it 2× larger and sharper" : "The upscaler is still downloading";
  btn("cutout").hidden = !inApp;
  btn("reuse").disabled = !g.settings;
}

function renderFilmstrip() {
  const strip = $("filmstrip");
  strip.hidden = !S.gallery.length;
  strip.replaceChildren(...S.gallery.map((g) => {
    const b = el("button", "thumb" + (g.id === S.selected ? " on" : ""));
    b.dataset.id = g.id;
    b.innerHTML = `<img src="/images/${g.id}.png" alt="" draggable="true">${g.kind === "upscaled" ? '<span class="t-tag">2×</span>' : g.kind === "cutout" ? '<span class="t-tag">PNG</span>' : ""}`;
    b.querySelector("img").ondragstart = (e) => e.dataTransfer.setData("text/zis-image", g.id);
    b.onclick = () => (S.current.includes(g.id) ? select(g.id) : setCurrent([g.id]));
    return b;
  }));
}

// ---------- result actions ----------

document.querySelector(".actions").onclick = async (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  const g = S.gallery.find((x) => x.id === S.selected);
  if (!act || !g) return;
  const url = `/images/${g.id}.png`;
  const name = `z-image-${g.seed ?? g.id}${g.kind === "upscaled" ? "-2x" : g.kind === "cutout" ? "-cutout" : ""}.png`;
  if (act === "save") {
    if (inApp) native("save", { url, name });
    else { const a = el("a"); a.href = url; a.download = name; a.click(); }
  } else if (act === "copy") {
    if (inApp) { await native("copy", { url }); toast("Copied."); }
    else { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Copied."); }
  } else if (act === "ref") {
    addRef("img:" + g.id, url); toast("Added as a reference.");
  } else if (act === "upscale") {
    generate({ model: "upscaler", refs: ["img:" + g.id], count: 1, prompt: "", width: g.w * 2, height: g.h * 2 })
      .then(() => S.job && Object.assign(S.job, { prompt: g.prompt, settings: g.settings, size: [g.w * 2, g.h * 2] }));
  } else if (act === "cutout") {
    toast("Removing background…");
    const r = await native("removeBackground", { url });
    if (r.error) return toast(r.error, true);
    const { id } = await api("/images", { method: "POST", body: { data: r.data } });
    S.gallery.unshift({ id, kind: "cutout", prompt: g.prompt, w: g.w, h: g.h, settings: g.settings });
    renderFilmstrip();
    setCurrent([id]);
  } else if (act === "reuse") {
    const s = g.settings;
    Object.assign(S, { model: s.model, preset: s.preset, shape: s.shape, count: s.count, quality: s.quality, refs: [...s.refs], shapeTouched: true });
    $("prompt").value = s.prompt; $("strength").value = s.strength; $("steps").value = s.steps; $("seed").value = g.seed ?? "";
    syncSliders(); renderPresets(); renderAll(); toast("Settings restored, including the seed.");
  } else if (act === "delete") {
    fetch(`/images/${g.id}`, { method: "DELETE" });
    S.gallery = S.gallery.filter((x) => x.id !== g.id);
    renderFilmstrip();
    setCurrent(S.current.filter((id) => id !== g.id));
  }
};

// ---------- wiring ----------

function syncSliders() {
  $("strengthVal").textContent = Math.round($("strength").value * 100) + "%";
  $("stepsVal").textContent = +$("steps").value ? $("steps").value : "auto";
}
$("strength").oninput = syncSliders;
$("steps").oninput = syncSliders;
$("prompt").oninput = () => { renderNote(); renderRefs(); $("enhanceUndo").hidden = true; };
$("go").onclick = () => generate();
$("enhance").onclick = () => {
  const p = $("prompt").value;
  if (!p.trim()) return $("prompt").focus();
  const { m } = chosen();
  const next = enhance(p, m.family_id === "klein" && S.refs.length > 0);
  if (next === p) return toast("That prompt is already detailed.");
  S.enhanceBackup = p;
  $("prompt").value = next;
  $("enhanceUndo").hidden = false;
};
$("undoEnhance").onclick = () => { $("prompt").value = S.enhanceBackup; $("enhanceUndo").hidden = true; };
$("modelsChip").onclick = $("openModels").onclick = () => { $("modelsSheet").hidden = false; renderSheet(); };
$("closeModels").onclick = () => ($("modelsSheet").hidden = true);
$("modelsSheet").onclick = (e) => { if (e.target === $("modelsSheet")) $("modelsSheet").hidden = true; };
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
  if (e.key === "Escape") {
    if (!$("modelsSheet").hidden) $("modelsSheet").hidden = true;
    else if (S.job) $("cancel").click();
  }
  if (["ArrowLeft", "ArrowRight"].includes(e.key) && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT" && S.gallery.length) {
    const i = S.gallery.findIndex((g) => g.id === S.selected);
    const next = S.gallery[Math.max(0, Math.min(S.gallery.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    if (next) S.current.includes(next.id) ? select(next.id) : setCurrent([next.id]);
  }
});
$("ideas").replaceChildren(...IDEAS.map((t) => {
  const b = el("button", "idea", esc(t));
  b.onclick = () => { $("prompt").value = t; $("prompt").focus(); renderNote(); };
  return b;
}));

async function refresh() {
  try {
    const st = await api("/status");
    // family_id: the base model an HQ variant belongs to, so routing can treat them as one.
    st.models.forEach((m) => (m.family_id = m.hq_of || m.id));
    const first = !S.status;
    S.status = st;
    if (first) { renderPresets(); syncSliders(); }
    if (!S.job) renderAll(); else { renderModelsChip(); renderSheet(); renderPicker(); }
  } catch { /* engine restarting */ }
}
refresh();
setInterval(refresh, 1500);
