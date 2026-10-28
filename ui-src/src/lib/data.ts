// Style presets, shapes and starter ideas.

export type Preset = { id: string; name: string; text: string; tint: string }

export const PRESETS: Preset[] = [
  { id: "none", name: "None", text: "", tint: "from-zinc-700 to-zinc-900" },
  { id: "cinematic", name: "Cinematic", text: "cinematic film still, dramatic lighting, shallow depth of field, rich colour grading, 35mm film grain", tint: "from-amber-700 to-slate-900" },
  { id: "portrait", name: "Portrait", text: "professional portrait photo, 85mm lens, soft studio light, sharp focus on the eyes, natural skin texture", tint: "from-rose-800 to-stone-900" },
  { id: "product", name: "Product", text: "studio product photography, clean seamless background, softbox lighting, crisp reflections, high detail", tint: "from-sky-800 to-slate-900" },
  { id: "street", name: "Indian street", text: "candid street photography in India, natural daylight, vibrant colours, documentary style", tint: "from-orange-700 to-red-950" },
  { id: "poster", name: "Film poster", text: "Bollywood movie poster, bold dramatic composition, glossy lighting, large title text", tint: "from-fuchsia-800 to-indigo-950" },
  { id: "anime", name: "Anime", text: "anime illustration, clean line art, cel shading, vibrant colours", tint: "from-pink-600 to-violet-900" },
  { id: "3d", name: "3D cartoon", text: "3D animated film style, soft global illumination, cute expressive character, high detail render", tint: "from-cyan-600 to-blue-950" },
  { id: "watercolor", name: "Watercolour", text: "watercolour painting, soft washes, visible paper texture, gentle colours", tint: "from-teal-600 to-emerald-950" },
  { id: "flat", name: "Flat graphic", text: "flat vector illustration, minimal, bold shapes, solid colours, clean background", tint: "from-lime-600 to-green-950" },
  { id: "food", name: "Food", text: "food photography, natural window light, appetizing, shallow depth of field, high detail", tint: "from-yellow-700 to-orange-950" },
  { id: "noir", name: "Black & white", text: "black and white photograph, high contrast, deep shadows, fine grain", tint: "from-zinc-400 to-zinc-900" },
]

export type Shape = { id: string; name: string; w: number; h: number }

export const SHAPES: Shape[] = [
  { id: "ref", name: "Match", w: 0, h: 0 },
  { id: "1:1", name: "1:1", w: 1024, h: 1024 },
  { id: "3:4", name: "3:4", w: 896, h: 1152 },
  { id: "9:16", name: "9:16", w: 768, h: 1344 },
  { id: "4:3", name: "4:3", w: 1152, h: 896 },
  { id: "16:9", name: "16:9", w: 1344, h: 768 },
]

export const IDEAS = [
  "A chai seller in a Mumbai street at golden hour",
  "Neon poster that says “DIWALI NIGHTS”, bold type",
  "A cosy Kerala houseboat at dawn, mist on the water",
  "Product shot of a brass diya on black marble",
]

// Thumbnails made with the app's own models (see app/make_presets.py).
const thumbs = import.meta.glob("../assets/presets/*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>
export const presetThumb = (id: string) => thumbs[`../assets/presets/${id}.jpg`]
