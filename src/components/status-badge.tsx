import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  scheduled: "bg-info/10 text-info border-info/20",
  completed: "bg-success/10 text-success border-success/20",
  pending: "bg-warning/15 text-warning-foreground border-warning/30",
  in_progress: "bg-accent text-accent-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  no_show: "bg-muted text-muted-foreground border-border",
  paid: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  sent: "bg-success/10 text-success border-success/20",
  queued: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status ?? "").toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        styles[key] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {(status ?? "unknown").replace("_", " ")}
    </span>
  );
}
