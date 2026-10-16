import { cn } from "@/lib/utils";
import { PROJECT_STATUS_CLASS, PROJECT_STATUS_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/domain";

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
        className="h-full rounded-full prism transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
