import { Info, Sparkles, SquarePen, Aperture } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import type { Model } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ModelInfo } from "./ModelInfo"

const ICONS: Record<string, typeof Sparkles> = { auto: Sparkles, zimage: Aperture, klein: SquarePen }

export function ModelPicker({ models, value, onChange }: { models: Model[]; value: string; onChange: (id: string) => void }) {
  const options = [
    { id: "auto", name: "Auto", sub: "Picks the best model for what you ask", m: undefined as Model | undefined },
    ...models.map((m) => ({ id: m.id, name: m.name, sub: m.tagline, m })),
  ]
  return (
    <div className="grid gap-1.5">
      {options.map((o) => {
        const Icon = ICONS[o.id] || Aperture
        const on = value === o.id
        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => e.key === "Enter" && onChange(o.id)}
            className={cn(
              "group flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_0_1px] shadow-primary/20" : "border-border bg-card/60 hover:bg-accent/60 hover:border-white/15",
            )}
          >
            <div className={cn("grid size-8 place-items-center rounded-lg shrink-0 transition-colors",
              on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground group-hover:text-foreground")}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {o.name}
                {o.m && <StateBadge m={o.m} />}
              </div>
              <div className="truncate text-xs text-muted-foreground">{o.sub}</div>
            </div>
            {o.m && (
              <HoverCard openDelay={150} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <button className="text-muted-foreground/60 hover:text-foreground p-1 -m-1 rounded-md" onClick={(e) => e.stopPropagation()} aria-label={`About ${o.name}`}>
                    <Info className="size-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent side="right" align="start" className="w-80">
                  <ModelInfo m={o.m} />
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function StateBadge({ m }: { m: Model }) {
  const d = m.download
  if (d.state === "installed") return null
  if (d.state === "downloading") return <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] text-primary border-primary/40">{Math.round((d.progress || 0) * 100)}%</Badge>
  if (d.state === "unsupported") return <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] text-amber-400 border-amber-400/30">{m.min_ram} GB</Badge>
  if (d.state === "failed" || d.state === "no_space") return <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] text-amber-400 border-amber-400/30">needs attention</Badge>
  return <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] text-muted-foreground">waiting</Badge>
}
