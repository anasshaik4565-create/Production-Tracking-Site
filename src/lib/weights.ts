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
      return "Unavailable";
    default:
      return "Not recorded";
  }
}

/** Which production stage each weight belongs to (follows the existing workflow order). */
export const WEIGHT_STAGE = { untrimmed: "lamination", final: "demould" } as const;

/** Actual − Expected in kg (null when either side is not usable). Rounded to remove float noise. */
export function weightDifference(expectedRaw: unknown, actualRaw: unknown): number | null {
  const expected = toNumber(expectedRaw);
  const actual = toNumber(actualRaw);
  if (expected === null || expected <= 0 || actual === null || actual < 0) return null;
  return Math.round((actual - expected) * 1e6) / 1e6;
}

/** "10.20 kg" (or an em dash when there is no number). */
export function formatKg(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)} kg`;
}

/** "+0.20 kg" / "−1.20 kg" / "0.00 kg". */
export function formatSignedKg(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const rounded = Number(n.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(digits)} kg`;
}

export type SetWeightInput = { expected: unknown; finalWeight: unknown };

export type SetWeightSummary = {
  panels: number;
  withFinal: number;
  missingFinal: number;
  /** Panels whose expected Part Weight is missing, zero or invalid. */
  invalidExpected: number;
  totalExpected: number | null;
  /** Sum of the Final Weights that WERE recorded (may be partial). */
  recordedFinalTotal: number;
  /** Every panel has a Final Weight and a valid expected weight: the set result is confirmed. */
  complete: boolean;
  /** Only filled in for a complete set. */
  difference: number | null;
  deviationPct: number | null;
  verdict: WeightVerdict | "incomplete";
  /** Like-for-like comparison of just the panels that have a Final Weight (shown as partial). */
  partial: {
    panels: number;
    expected: number;
    actual: number;
    difference: number;
    deviationPct: number | null;
  } | null;
};

/**
 * Set-wise totals. Deviation comes from the SUMMED weights (never an average of panel percentages),
 * uses Final Weight only, counts each panel once, and never treats a missing Final Weight as zero.
 */
export function summarizeSetWeights(
  items: SetWeightInput[],
  toleranceRaw: unknown = DEFAULT_TOLERANCE_PCT,
): SetWeightSummary {
  const t = toNumber(toleranceRaw);
  const tolerance = t !== null && t >= 0 ? t : DEFAULT_TOLERANCE_PCT;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  let totalExpected = 0;
  let invalidExpected = 0;
  let recordedFinalTotal = 0;
  let withFinal = 0;
  let partialExpected = 0;
  let partialActual = 0;
  let partialValid = true;

  for (const it of items) {
    const expected = toNumber(it.expected);
    const actual = toNumber(it.finalWeight);
    const expectedOk = expected !== null && expected > 0;
    if (expectedOk) totalExpected += expected as number;
    else invalidExpected += 1;
    if (actual !== null && actual >= 0) {
      withFinal += 1;
      recordedFinalTotal += actual;
      if (expectedOk) {
        partialExpected += expected as number;
        partialActual += actual;
      } else partialValid = false;
    }
  }

  const panels = items.length;
  const missingFinal = panels - withFinal;
  const complete = panels > 0 && missingFinal === 0 && invalidExpected === 0;
  totalExpected = round(totalExpected);
  recordedFinalTotal = round(recordedFinalTotal);

  let difference: number | null = null;
  let deviationPct: number | null = null;
  let verdict: SetWeightSummary["verdict"] = "incomplete";
  if (complete) {
    if (totalExpected > 0) {
      difference = round(recordedFinalTotal - totalExpected);
      const cmp = compareWeight(totalExpected, recordedFinalTotal, tolerance);
      deviationPct = cmp.deviationPct;
      verdict = cmp.verdict;
    } else {
      verdict = "invalid_reference";
    }
  } else if (panels > 0 && invalidExpected > 0 && missingFinal === 0) {
    verdict = "invalid_reference";
  }

  const partial =
    !complete && withFinal > 0 && partialValid && partialExpected > 0
      ? {
          panels: withFinal,
          expected: round(partialExpected),
          actual: round(partialActual),
          difference: round(partialActual - partialExpected),
          deviationPct: compareWeight(partialExpected, partialActual, tolerance).deviationPct,
        }
      : null;

  return {
    panels,
    withFinal,
    missingFinal,
    invalidExpected,
    totalExpected: panels > 0 && invalidExpected < panels ? totalExpected : null,
    recordedFinalTotal,
    complete,
    difference,
    deviationPct,
    verdict,
    partial,
  };
}
