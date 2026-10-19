import { cn } from "@/lib/utils";
import { formatDeviation, verdictLabel, type WeightComparison } from "@/lib/weights";
import {
  PROJECT_STATUS_CLASS,
  PROJECT_STATUS_LABEL,
  QC_STATUS_CLASS,
  QC_STATUS_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
} from "@/lib/domain";

export function StatusBadge({
  status,
  className,
  compact,
}: {
  status: string;
  className?: string;
  compact?: boolean;
}) {
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        STATUS_CLASS[status],
        className,
      )}
    >
      {compact ? (label === "Not Applicable" ? "N/A" : label) : label}
    </span>
  );
}

export function QcBadge({
  status,
  className,
  compact,
}: {
  status: string;
  className?: string;
  compact?: boolean;
}) {
  const label = QC_STATUS_LABEL[status] ?? status;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase",
        QC_STATUS_CLASS[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {compact ? label.replace("QC ", "QC·") : label}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        PROJECT_STATUS_CLASS[status],
      )}
    >
      {PROJECT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

const WEIGHT_CLASS: Record<string, string> = {
  ok: "bg-done text-done-foreground",
  over: "bg-destructive/10 text-destructive",
  under: "bg-destructive/10 text-destructive",
  not_recorded: "bg-muted text-muted-foreground",
  invalid_reference: "bg-muted text-muted-foreground",
};

/** Green within tolerance, red when over/under, grey when it cannot be judged. */
export function WeightBadge({
  comparison,
  className,
}: {
  comparison: WeightComparison;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        WEIGHT_CLASS[comparison.verdict],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {comparison.deviationPct !== null ? `${formatDeviation(comparison.deviationPct)} · ` : ""}
      {verdictLabel(comparison)}
    </span>
  );
}
