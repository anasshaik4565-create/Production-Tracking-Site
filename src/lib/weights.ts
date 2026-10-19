/**
 * Weight comparison used everywhere (production page, exports).
 *
 * Deviation % = ((Actual − Expected) / Expected) × 100
 * Green when |deviation| <= tolerance, red when beyond it, grey when it cannot be judged.
 */
export const DEFAULT_TOLERANCE_PCT = 5;

export type WeightVerdict = "ok" | "over" | "under" | "not_recorded" | "invalid_reference";

export type WeightComparison = {
  verdict: WeightVerdict;
  /** Percentage deviation rounded to 2 decimals, or null when it cannot be calculated. */
  deviationPct: number | null;
  expected: number | null;
  actual: number | null;
  tolerance: number;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** Panel-level tolerance wins, then the project's, then 5%. */
export function effectiveTolerance(
  panelTolerance: number | string | null | undefined,
  projectTolerance: number | string | null | undefined,
): number {
  const p = toNumber(panelTolerance);
  if (p !== null && p >= 0) return p;
  const j = toNumber(projectTolerance);
  if (j !== null && j >= 0) return j;
  return DEFAULT_TOLERANCE_PCT;
}

export function compareWeight(
  expectedRaw: unknown,
  actualRaw: unknown,
  toleranceRaw: unknown = DEFAULT_TOLERANCE_PCT,
): WeightComparison {
  const expected = toNumber(expectedRaw);
  const actual = toNumber(actualRaw);
  const t = toNumber(toleranceRaw);
  const tolerance = t !== null && t >= 0 ? t : DEFAULT_TOLERANCE_PCT;

  if (actual === null || actual < 0) {
    return { verdict: "not_recorded", deviationPct: null, expected, actual: null, tolerance };
  }
  if (expected === null || expected <= 0) {
    // Never divide by zero or compare against a missing / invalid reference.
    return { verdict: "invalid_reference", deviationPct: null, expected: null, actual, tolerance };
  }
  const raw = ((actual - expected) / expected) * 100;
  const stable = Math.round(raw * 1e6) / 1e6; // removes floating-point noise at the boundary
  const verdict: WeightVerdict =
    Math.abs(stable) <= tolerance ? "ok" : stable > 0 ? "over" : "under";
  return {
    verdict,
    deviationPct: Math.round(stable * 100) / 100,
    expected,
    actual,
    tolerance,
  };
}

export function formatDeviation(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function verdictLabel(c: WeightComparison): string {
  switch (c.verdict) {
    case "ok":
      return "Within tolerance";
    case "over":
      return "Overweight";
    case "under":
      return "Underweight";
    case "invalid_reference":
      return "No valid expected weight";
    default:
      return "Not recorded";
  }
}

/** Which production stage each weight belongs to (follows the existing workflow order). */
export const WEIGHT_STAGE = { untrimmed: "lamination", final: "demould" } as const;
