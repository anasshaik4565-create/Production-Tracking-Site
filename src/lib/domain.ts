export const STAGES = [
  { value: "lamination", label: "Lamination", short: "Lam" },
  { value: "demould", label: "Demould", short: "Dem" },
  { value: "trimming", label: "Trimming", short: "Trim" },
  { value: "detailing", label: "Detailing", short: "Detail" },
  { value: "assembly", label: "Assembly", short: "Asm" },
  { value: "bracket_bonding", label: "Bracket Bonding", short: "Brkt" },
  { value: "panel_to_panel_bonding", label: "Panel-to-Panel Bonding", short: "P2P" },
  { value: "gelcoat_sanding", label: "Gelcoat Sanding", short: "Gel" },
  { value: "primer_spray", label: "Primer Spray", short: "Pr.Sp" },
  { value: "primer_sanding", label: "Primer Sanding", short: "Pr.Sd" },
  { value: "painting", label: "Painting", short: "Paint" },
  { value: "clear_coat", label: "Clear Coat", short: "Clear" },
  { value: "post_operations", label: "Post Operations", short: "Post" },
  { value: "post_operations_qc", label: "Post Operations QC", short: "P.QC" },
  { value: "packing", label: "Packing", short: "Pack" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  STAGES.map((s) => [s.value, s.label]),
);
export const STAGE_SHORT: Record<string, string> = Object.fromEntries(
  STAGES.map((s) => [s.value, s.short]),
);
export const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.value, i]),
);

export const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "wip", label: "WIP" },
  { value: "completed", label: "Completed" },
  { value: "hold", label: "Hold" },
  { value: "rework", label: "Rework" },
  { value: "not_applicable", label: "Not Applicable" },
] as const;

export type ProdStatus = (typeof STATUSES)[number]["value"];

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
);

export const STATUS_CLASS: Record<string, string> = {
  pending: "bg-pending text-pending-foreground",
  wip: "bg-wip text-wip-foreground",
  completed: "bg-done text-done-foreground",
  hold: "bg-hold text-hold-foreground",
  rework: "bg-rework text-rework-foreground",
  not_applicable: "bg-muted text-muted-foreground",
};

export const PROJECT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
] as const;

export const PROJECT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STATUSES.map((s) => [s.value, s.label]),
);

export const PROJECT_STATUS_CLASS: Record<string, string> = {
  active: "bg-done text-done-foreground",
  on_hold: "bg-hold text-hold-foreground",
  completed: "bg-wip text-wip-foreground",
  archived: "bg-muted text-muted-foreground",
};

export const COUNTRIES = ["India", "Europe", "UAE", "Other"] as const;

export function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return `${formatDate(value)} · ${formatTime(value)}`;
}

export function countryLabel(country: string, other?: string | null) {
  return country === "Other" && other ? other : country;
}
