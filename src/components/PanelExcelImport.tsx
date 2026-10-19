import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSet } from "@/lib/domain";
import {
  buildTemplateWorkbook,
  parsePanelWorkbook,
  type ImportResult,
  type ImportedPanel,
} from "@/lib/panel-import";

function downloadTemplate() {
  const blob = new Blob([buildTemplateWorkbook()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "panel-import-template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * "Upload Excel" option for panel creation. Reads an .xlsx file, shows a preview with row-level
 * validation, and hands the valid rows to `onImport`. Manual entry stays available elsewhere.
 */
export function PanelExcelImport({
  existingIds,
  knownSets,
  onImport,
  triggerLabel = "Upload Excel",
}: {
  /** ID Numbers already used in the project (case-insensitive duplicates are rejected). */
  existingIds: string[];
  /** Set numbers that already exist; others in the file are reported as "will be added". */
  knownSets: number[];
  /** Must throw on failure. Called with the valid rows only. */
  onImport: (panels: ImportedPanel[]) => Promise<void> | void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ ok: number; rejected: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFileName("");
    setResult(null);
    setSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setSummary(null);
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Please choose an Excel file in .xlsx format.");
      reset();
      return;
    }
    setReading(true);
    setFileName(file.name);
    try {
      const parsed = await parsePanelWorkbook(file, existingIds);
      setResult(parsed);
    } catch (error) {
      setResult(null);
      toast.error((error as Error).message || "We couldn't read that file.");
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    if (!result || result.valid.length === 0 || importing) return;
    setImporting(true);
    try {
      await onImport(result.valid);
      const rejected = new Set(result.issues.map((i) => i.row)).size;
      setSummary({ ok: result.valid.length, rejected });
      setResult(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      toast.error(
        (error as Error).message ||
          "The import failed, so nothing was added. Please check the file and try again.",
      );
    } finally {
      setImporting(false);
    }
  }

  const rejectedRows = result ? new Set(result.issues.map((i) => i.row)).size : 0;
  const newSets = result
    ? Array.from(new Set(result.valid.map((p) => p.set_number)))
        .filter((n) => !knownSets.includes(n))
        .sort((a, b) => a - b)
    : [];

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="rounded-lg"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Upload className="mr-1.5 size-4" /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import panels from Excel</DialogTitle>
            <DialogDescription>
              Upload an .xlsx file with the columns Panel Name, Set Number, Part Number, ID Number,
              Part Area and Part Weight (ID Number is optional). You will see a preview before
              anything is saved.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1.5 size-4" /> Download sample template
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={reading || importing}
            >
              {reading ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 size-4" />
              )}
              {fileName ? "Choose another file" : "Choose .xlsx file"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {fileName && <span className="truncate text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {summary && (
            <div className="flex items-start gap-2 rounded-lg bg-done px-3 py-2.5 text-sm text-done-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Import complete</p>
                <p>
                  {summary.ok} panel{summary.ok === 1 ? "" : "s"} imported
                  {summary.rejected > 0
                    ? `, ${summary.rejected} row${summary.rejected === 1 ? "" : "s"} rejected (not imported).`
                    : "."}
                </p>
              </div>
            </div>
          )}

          {result && result.missingColumns.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-rework px-3 py-2.5 text-sm text-rework-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Missing columns</p>
                <p>
                  The first row must contain: {result.missingColumns.join(", ")}. Download the
                  sample template to see the expected layout.
                </p>
              </div>
            </div>
          )}

          {result && result.missingColumns.length === 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted px-2 py-2">
                  <p className="text-xl font-bold">{result.totalRows}</p>
                  <p className="text-[11px] text-muted-foreground">Rows read</p>
                </div>
                <div className="rounded-lg bg-done px-2 py-2 text-done-foreground">
                  <p className="text-xl font-bold">{result.valid.length}</p>
                  <p className="text-[11px]">Ready to import</p>
                </div>
                <div
                  className={`rounded-lg px-2 py-2 ${
                    rejectedRows > 0 ? "bg-rework text-rework-foreground" : "bg-muted"
                  }`}
                >
                  <p className="text-xl font-bold">{rejectedRows}</p>
                  <p className="text-[11px]">Rejected</p>
                </div>
              </div>

              {newSets.length > 0 && (
                <p className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground">
                  New sets will be added: {newSets.map((n) => formatSet(n)).join(", ")}.
                </p>
              )}

              {result.issues.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Rows to fix in your spreadsheet
                  </p>
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border text-sm">
                    {result.issues.map((issue, i) => (
                      <li key={i} className="flex gap-3 px-3 py-1.5">
                        <span className="w-14 shrink-0 font-semibold text-rework-foreground">
                          Row {issue.row}
                        </span>
                        <span>{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.valid.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Preview{result.valid.length > 50 ? " (first 50 rows)" : ""}
                  </p>
                  <div className="max-h-56 overflow-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-xs">
                        <tr>
                          {[
                            "Row",
                            "Panel Name",
                            "Set",
                            "Part Number",
                            "ID Number",
                            "Area",
                            "Weight",
                          ].map((h) => (
                            <th key={h} className="px-3 py-1.5 text-left font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {result.valid.slice(0, 50).map((p) => (
                          <tr key={p.row}>
                            <td className="px-3 py-1.5 text-muted-foreground">{p.row}</td>
                            <td className="px-3 py-1.5">{p.name}</td>
                            <td className="px-3 py-1.5">{formatSet(p.set_number)}</td>
                            <td className="px-3 py-1.5">{p.part_number}</td>
                            <td className="px-3 py-1.5">{p.id_number || "—"}</td>
                            <td className="px-3 py-1.5">{p.part_area}</td>
                            <td className="px-3 py-1.5">{p.part_weight}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {rejectedRows > 0 && result.valid.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Rejected rows are skipped and nothing is changed for them. Fix them in Excel and
                  upload the file again to add them later.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={importing}>
              {summary ? "Close" : "Cancel"}
            </Button>
            <Button
              onClick={runImport}
              disabled={!result || result.valid.length === 0 || importing}
            >
              {importing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {result && result.valid.length > 0
                ? `Import ${result.valid.length} panel${result.valid.length === 1 ? "" : "s"}`
                : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
