// Talking to the local engine (engine/server.py) and, inside the Mac app, to the
// native shell (app/main.swift) for Save, Copy and Remove background.

export type DownloadState = "unknown" | "queued" | "downloading" | "installed" | "unsupported" | "no_space" | "failed" | "retry"

export type Model = {
  id: string
  name: string
  kind: "image" | "tool"
  hq_of?: string
  size_gb: number
  min_ram: number
  steps: number
  tagline: string
  best: string[]
  weak: string[]
  reference: string
  speed: string
  license: string
  runnable: boolean
  download: { state: DownloadState; progress: number | null; error: string | null }
}

export type Status = {
  setup: { phase: "starting" | "installing" | "ready" | "error"; error: string | null }
  ram_gb: number
  free_disk_gb: number
  loaded: string | null
  models: Model[]
}

export type JobImage = { id: string; seed: number; model: string; seconds: number }

export type Job = {
  id: string
  state: "queued" | "loading" | "running" | "done" | "error" | "cancelled"
  error: string | null
  images: JobImage[]
  progress: { index: number; count: number; step: number; steps: number }
  preview_n: number
  model: string
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || "Something went wrong")
  return data as T
}

type NativeHandler = { postMessage: (m: unknown) => void }
const handler = (window as unknown as { webkit?: { messageHandlers?: { native?: NativeHandler } } }).webkit?.messageHandlers?.native

export const inApp = !!handler
const pending: Record<string, (data: Record<string, unknown>) => void> = {}

;(window as unknown as { nativeReply: unknown }).nativeReply = (id: string, data: Record<string, unknown>) => {
  pending[id]?.(data)
  delete pending[id]
}

export function native(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2)
    pending[id] = resolve
    handler?.postMessage({ action, id, ...payload })
  })
}

export const imageUrl = (id: string) => `images/${id}.png`
