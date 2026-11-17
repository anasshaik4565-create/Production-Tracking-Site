import { ChevronDown, ChevronUp } from "lucide-react";

import { STAGE_LABEL } from "@/lib/domain";
import { moveStage } from "@/lib/stages";
import { cn } from "@/lib/utils";

/**
 * Shows the chosen stages in their execution order with Move Up / Move Down controls.
 * `stages` is the ordered list of selected stage ids; stable ids (not positions) identify stages.
 */
export function StageSequenceEditor({
  stages,
  onChange,
  disabled,
  className,
  label = "Execution order",
}: {
  stages: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  if (stages.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>No stages selected yet.</p>
    );
  }
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <ol className="flex flex-wrap gap-1.5">
        {stages.map((stage, i) => {
          const name = STAGE_LABEL[stage] ?? stage;
          return (
            <li
              key={stage}
              className="flex items-center gap-1 rounded-lg border bg-card py-0.5 pr-0.5 pl-2 text-xs"
            >
              <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="font-medium">{name}</span>
              <span className="ml-1 flex">
                <button
                  type="button"
                  aria-label={`Move ${name} up`}
                  title="Move up"
                  disabled={disabled || i === 0}
                  onClick={() => onChange(moveStage(stages, i, -1))}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${name} down`}
                  title="Move down"
                  disabled={disabled || i === stages.length - 1}
                  onClick={() => onChange(moveStage(stages, i, 1))}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
