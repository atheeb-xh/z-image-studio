import { AlertTriangle, CheckCircle2, Cpu, HardDrive, Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { api, type Model, type Status } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ModelInfo } from "./ModelInfo"

export function ModelsDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (o: boolean) => void; status: Status | null }) {
  if (!status) return null
  const retry = status.models.some((m) => ["failed", "no_space"].includes(m.download.state))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[86vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-lg">Models</DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><Cpu className="size-3.5" />{status.ram_gb} GB memory</span>
            <span className="inline-flex items-center gap-1.5"><HardDrive className="size-3.5" />{status.free_disk_gb} GB free disk</span>
            <span>Every model this Mac can run downloads by itself, one at a time.</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 overflow-y-auto px-6 pb-2 scrollbar-thin">
          {status.models.map((m) => <Card key={m.id} m={m} />)}
        </div>
        <div className="flex items-center justify-between gap-4 border-t px-6 py-4 text-xs text-muted-foreground">
          <span>Models are kept in ~/.cache/huggingface. Images are never saved unless you save them.</span>
          {retry && (
            <Button size="sm" variant="secondary" onClick={async () => { await api("/downloads/retry", { method: "POST" }); toast("Retrying downloads…") }}>
              Retry downloads
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Card({ m }: { m: Model }) {
  const d = m.download
  const pct = Math.round((d.progress || 0) * 100)
  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card/70 p-4", !m.runnable && "opacity-55")}>
      <div className="flex gap-1.5">
        <Badge variant="outline" className={cn("text-[10px]", m.hq_of && "text-primary border-primary/40")}>{m.min_ram} GB+</Badge>
        {m.hq_of && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">HQ</Badge>}
        {m.kind === "tool" && <Badge variant="outline" className="text-[10px]">Tool</Badge>}
      </div>
      <ModelInfo m={m} />
      <div className="mt-auto text-xs">
        {d.state === "installed" && <span className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="size-4" />Ready</span>}
        {d.state === "downloading" && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-muted-foreground"><span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />Downloading</span><span>{pct}%</span></div>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}
        {d.state === "unsupported" && <span className="flex items-center gap-1.5 text-amber-400"><Lock className="size-4" />Turned off: needs a {m.min_ram} GB Mac</span>}
        {(d.state === "no_space" || d.state === "failed") && <span className="flex items-start gap-1.5 text-amber-400"><AlertTriangle className="size-4 shrink-0" />{d.state === "failed" ? "Download failed. " : ""}{d.error}</span>}
        {["queued", "retry", "unknown"].includes(d.state) && <span className="text-muted-foreground">Waiting to download</span>}
      </div>
    </div>
  )
}
