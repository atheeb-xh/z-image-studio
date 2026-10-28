import { Check, Clock, Cpu, HardDrive, ImageIcon, Minus, Zap } from "lucide-react"
import type { Model } from "@/lib/api"

/** What a model is good and bad at. Used in hover cards and the Models dialog. */
export function ModelInfo({ m }: { m: Model }) {
  return (
    <div className="space-y-3 text-[12.5px]">
      <div>
        <div className="font-semibold text-sm">{m.name}</div>
        <p className="text-muted-foreground mt-0.5">{m.tagline}</p>
      </div>
      <Section title="Best for">
        {m.best.map((b) => (
          <li key={b} className="flex gap-2"><Check className="size-3.5 mt-0.5 text-primary shrink-0" />{b}</li>
        ))}
      </Section>
      <Section title="Not great at">
        {m.weak.map((b) => (
          <li key={b} className="flex gap-2 text-muted-foreground"><Minus className="size-3.5 mt-0.5 shrink-0" />{b}</li>
        ))}
      </Section>
      <div className="grid gap-1.5 text-muted-foreground">
        <Fact icon={ImageIcon}>{m.reference}</Fact>
        <Fact icon={Zap}>{m.speed}</Fact>
        <Fact icon={Cpu}>Needs a {m.min_ram} GB Mac</Fact>
        <Fact icon={HardDrive}>{m.size_gb} GB download · {m.license}</Fact>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">{title}</div>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

function Fact({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return <div className="flex gap-2"><Icon className="size-3.5 mt-0.5 shrink-0" /><span>{children}</span></div>
}
