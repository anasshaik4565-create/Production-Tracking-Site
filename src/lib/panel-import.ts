import * as XLSX from "xlsx";

/** One row read from the spreadsheet, after cleaning. */
export type ImportedPanel = {
  row: number; // spreadsheet row number (header = row 1)
  name: string;
  set_number: number;
  part_number: string;
  part_area: number;
  part_weight: number;
};

export type ImportIssue = { row: number; message: string };

export type ImportResult = {
  valid: ImportedPanel[];
  issues: ImportIssue[];
  totalRows: number;
  missingColumns: string[];
};

export const REQUIRED_COLUMNS = [
  "Panel Name",
  "Set Number",
  "Part Number",
  "Part Area",
  "Part Weight",
] as const;

const MAX_ROWS = 2000;

function norm(h: unknown) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const COLUMN_KEYS: Record<string, (typeof REQUIRED_COLUMNS)[number]> = Object.fromEntries(
  REQUIRED_COLUMNS.map((c) => [norm(c), c]),
);

/** "Set 05", "05", 5, "5" -> 5. Returns null when it is not a positive whole number. */
export function parseSetNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  const text = String(value ?? "")
    .trim()
    .replace(/^set\s*[-_:]?\s*/i, "");
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").trim();
  if (text === "") return null;
  if (text.includes(",") && !text.includes(".")) {
    if (/^\d{1,3}(,\d{3})+$/.test(text))
      text = text.replace(/,/g, ""); // 1,500 -> 1500
    else if (/^\d+,\d+$/.test(text))
      text = text.replace(",", "."); // 41,5 -> 41.5
    else return null;
  } else if (text.includes(",")) {
    text = text.replace(/,/g, ""); // 1,234.5 -> 1234.5
  }
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function isBlank(value: unknown) {
  return String(value ?? "").trim() === "";
}

/**
 * Validate parsed spreadsheet rows (header row already used to build the objects).
 * `existingParts` are part numbers already in the project (case-insensitive).
 */
export function validateRows(
  rows: Record<string, unknown>[],
  existingParts: string[] = [],
): ImportResult {
  const existing = new Set(existingParts.map((p) => p.trim().toLowerCase()).filter(Boolean));
  const seen = new Map<string, number>();
  const valid: ImportedPanel[] = [];
  const issues: ImportIssue[] = [];

  rows.forEach((raw, i) => {
    const row = i + 2;
    const get = (col: (typeof REQUIRED_COLUMNS)[number]) => raw[col];

    const allBlank = REQUIRED_COLUMNS.every((c) => isBlank(get(c)));
    if (allBlank) return; // completely empty line: ignore silently

    const problems: string[] = [];
    const name = String(get("Panel Name") ?? "").trim();
    const part = String(get("Part Number") ?? "").trim();
    if (!name) problems.push("Panel Name is empty");
    if (!part) problems.push("Part Number is empty");

    const setNumber = isBlank(get("Set Number")) ? null : parseSetNumber(get("Set Number"));
    if (isBlank(get("Set Number"))) problems.push("Set Number is empty");
    else if (setNumber === null)
      problems.push(
        `Set Number "${String(get("Set Number")).trim()}" is not a whole number of 1 or more`,
      );

    let area = 0;
    if (isBlank(get("Part Area"))) problems.push("Part Area is empty");
    else {
      const n = parseNumber(get("Part Area"));
      if (n === null || n < 0)
        problems.push(`Part Area "${String(get("Part Area")).trim()}" is not a valid number`);
      else area = n;
    }
    let weight = 0;
    if (isBlank(get("Part Weight"))) problems.push("Part Weight is empty");
    else {
      const n = parseNumber(get("Part Weight"));
      if (n === null || n < 0)
        problems.push(`Part Weight "${String(get("Part Weight")).trim()}" is not a valid number`);
      else weight = n;
    }

    if (part) {
      const key = part.toLowerCase();
      if (existing.has(key)) problems.push(`Part Number "${part}" already exists in this project`);
      else if (seen.has(key))
        problems.push(`Part Number "${part}" is repeated (first used in row ${seen.get(key)})`);
      else seen.set(key, row);
    }

    if (problems.length > 0) {
      for (const message of problems) issues.push({ row, message });
      return;
    }
    valid.push({
      row,
      name,
      set_number: setNumber as number,
      part_number: part,
      part_area: area,
      part_weight: weight,
    });
  });

  return {
    valid,
    issues,
    totalRows: valid.length + new Set(issues.map((x) => x.row)).size,
    missingColumns: [],
  };
}

/** Read the first sheet of an .xlsx file and validate it. */
export async function parsePanelWorkbook(
  file: File | ArrayBuffer,
  existingParts: string[] = [],
): Promise<ImportResult> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("This file could not be read. Please upload a valid .xlsx workbook.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) throw new Error("The workbook has no sheets.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
  });
  const headerRow = (matrix[0] ?? []) as unknown[];
  const colIndex = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const canonical = COLUMN_KEYS[norm(h)];
    if (canonical && !colIndex.has(canonical)) colIndex.set(canonical, i);
  });
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c));
  if (missingColumns.length > 0) {
    return { valid: [], issues: [], totalRows: 0, missingColumns };
  }
  const body = matrix.slice(1);
  if (body.length > MAX_ROWS) {
    throw new Error(`The file has more than ${MAX_ROWS} rows. Please split it into smaller files.`);
  }
  const objects = body.map((cells) => {
    const o: Record<string, unknown> = {};
    for (const c of REQUIRED_COLUMNS) o[c] = (cells as unknown[])[colIndex.get(c) as number];
    return o;
  });
  return validateRows(objects, existingParts);
}

/** Download-ready template workbook (as an ArrayBuffer). */
export function buildTemplateWorkbook(): ArrayBuffer {
  const data = [
    [...REQUIRED_COLUMNS],
    ["Panel A", 5, "1001", 12.5, 48],
    ["Panel B", 5, "1002", 10.2, 41.5],
    ["Panel A", 6, "1003", 12.5, 48],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 13 }];
  const notes = XLSX.utils.aoa_to_sheet([
    ["Column", "What to enter"],
    ["Panel Name", "Panel name or description (required)"],
    ["Set Number", "Whole number of the set, e.g. 5 or Set 05 (required)"],
    ["Part Number", "Unique part identification inside the project (required)"],
    ["Part Area", "Panel area in m² (number, required)"],
    ["Part Weight", "Panel weight in kg (number, required)"],
    [],
    ["Tip", "Keep the first row as the header. Delete the example rows before uploading."],
  ]);
  notes["!cols"] = [{ wch: 16 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Panels");
  XLSX.utils.book_append_sheet(wb, notes, "Instructions");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
