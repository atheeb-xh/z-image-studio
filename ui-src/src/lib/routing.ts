// Auto mode and the prompt helper. Both run offline from plain rules.

export type Family = "zimage" | "klein"

const EDIT_WORDS = /\b(add|adding|remove|erase|delete|replace|change|swap|make (him|her|them|it|me|this|the)|put|give (him|her|them|it)|turn (him|her|them|it|this|the)|wear(ing|s)?|hold(ing|s)?|without|instead|recolou?r|fix|move|keep|same (person|face|man|woman))\b/i
const STYLE_WORDS = /\b(in the style of|style of|like this|similar to|inspired by|same (style|vibe|colou?rs?|mood)|variation)\b/i
const TEXT_WORDS = /["“”]|\b(text|says|saying|title|logo|poster|sign|banner|headline|label)\b/i

/** Picks a model family for Auto and says why, in plain words. */
export function route(prompt: string, refs: number): { family: Family; why: string } {
  if (refs >= 2) return { family: "klein", why: "you gave more than one image, and only Klein can combine them" }
  if (refs === 1) {
    if (STYLE_WORDS.test(prompt) && !EDIT_WORDS.test(prompt)) return { family: "zimage", why: "you want a new picture with the feel of your image" }
    return { family: "klein", why: "you gave a photo and a change to make; Klein edits and keeps the rest" }
  }
  if (TEXT_WORDS.test(prompt)) return { family: "zimage", why: "it's good at short text in images" }
  return { family: "zimage", why: "it's fast and realistic for a new picture" }
}

const SUBJECTS: [RegExp, string][] = [
  [/\b(man|woman|boy|girl|person|people|portrait|face|child|kid|uncle|aunty|bride|groom|he|she)\b/i,
    "natural expression, detailed skin and hair, soft directional light, shallow depth of field, shot on a full-frame camera"],
  [/\b(product|bottle|watch|shoe|phone|packaging|jar|perfume|bag|diya)\b/i,
    "studio lighting, clean background, sharp focus, crisp reflections, commercial photography"],
  [/\b(food|dish|biryani|dosa|thali|chai|coffee|cake|curry|street food)\b/i,
    "appetizing, natural window light, close-up, steam and texture visible, food photography"],
  [/\b(city|street|market|village|mountain|beach|forest|river|landscape|sky|temple|house|room|interior)\b/i,
    "wide shot, atmospheric light, rich detail, depth and scale, professional photography"],
  [/\b(poster|logo|banner|sign|text|title)\b/i, "bold clear typography, strong layout, high contrast, print-ready design"],
  [/\b(cat|dog|bird|tiger|elephant|cow|horse|animal)\b/i, "detailed fur and eyes, natural habitat light, wildlife photography, sharp focus"],
]

/** Makes a short prompt more detailed. Edits get a clear "keep everything else" line instead. */
export function enhance(prompt: string, isEdit: boolean): string {
  let p = prompt.trim().replace(/\s+/g, " ")
  if (!p) return p
  if (isEdit) {
    p = p.charAt(0).toUpperCase() + p.slice(1)
    if (!/[.!]$/.test(p)) p += "."
    if (!/\bkeep\b/i.test(p)) p += " Keep the same person, face, pose, clothing and background. Change nothing else."
    return p
  }
  const extra = SUBJECTS.find(([re]) => re.test(p))?.[1] || "highly detailed, beautiful light, sharp focus, professional photography"
  if (!/[,.]$/.test(p)) p += ","
  return `${p} ${extra}`
}
