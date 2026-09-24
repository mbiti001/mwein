import { auditedOperationalJson } from "@/lib/audited-json";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
const code = (prefix: string, name: string, row: number) => `${prefix}-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28)}-${String(row).padStart(3, "0")}`;
const strength = (name: string) => name.match(/\b\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*(?:MCG|MG|G|ML|IU|%)\b/i)?.[0] || "Not specified";

function legacyRows(sheet: ExcelJS.Worksheet) {
  const rows: string[][] = [];
  const title = sheet.name.toLowerCase();
  if (title === "drugs") {
    rows.push(["code","name","generic_name","strength","dosage_form","unit_of_measure","cost_price","unit_price","pack_size","active"]);
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && row.getCell(1).text.trim()) { const name = row.getCell(1).text.trim(), form = row.getCell(2).text.trim(); rows.push([code("DRG", name, rowNumber), name, name.replace(strength(name), "").trim(), strength(name), form, form.toLowerCase() || "unit", row.getCell(4).text.trim(), row.getCell(3).text.trim(), row.getCell(5).text.trim(), "true"]); } });
    return { rows, dataset: "PHARMACEUTICALS" };
  }
  if (title === "procedure") {
    rows.push(["code","name","unit_price","department","active"]);
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && row.getCell(1).text.trim()) { const name = row.getCell(1).text.trim(); rows.push([code("PROC", name, rowNumber), name, row.getCell(2).text.trim(), "Clinical services", "true"]); } });
    return { rows, dataset: "PROCEDURES" };
  }
  if (title === "non-pharm") {
    rows.push(["code","name","unit_price","unit_of_measure","pack_size","active"]);
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && row.getCell(1).text.trim()) { const name = row.getCell(1).text.trim(); rows.push([code("SUP", name, rowNumber), name, row.getCell(2).text.trim(), "unit", row.getCell(3).text.trim(), "true"]); } });
    return { rows, dataset: "NON_PHARMACEUTICALS" };
  }
  if (title === "lab") {
    rows.push(["code","name","unit_price","department","specimen_type","panel_or_single","active"]);
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && row.getCell(1).text.trim()) { const name = row.getCell(1).text.trim(); rows.push([code("LAB", name, rowNumber), name, row.getCell(2).text.trim(), "Laboratory", "Not specified", "SINGLE", "true"]); } });
    return { rows, dataset: "LAB_TESTS" };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.catalog");
    const form = await request.formData();
    const file = form.get("file");
    const requestedTitle = String(form.get("sheetTitle") || "");
    if (!(file instanceof File))
      return await auditedOperationalJson(user, "admin/import/workbook",
        { error: "Select an Excel workbook" },
        { status: 422 },
      );
    if (file.size > 10_000_000)
      return await auditedOperationalJson(user, "admin/import/workbook",
        { error: "Workbook size is limited to 10 MB" },
        { status: 422 },
      );
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      return await auditedOperationalJson(user, "admin/import/workbook",
        {
          error:
            "Only .xlsx workbooks are supported here; use the CSV uploader for .csv files",
        },
        { status: 422 },
      );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await file.arrayBuffer()) as never);
    const sheetTitles = workbook.worksheets.map((sheet) => sheet.name);
    if (!requestedTitle)
      return await auditedOperationalJson(user, "admin/import/workbook", { workbookTitle: file.name, sheetTitles });
    const sheet = workbook.getWorksheet(requestedTitle);
    if (!sheet)
      return await auditedOperationalJson(user, "admin/import/workbook",
        { error: `Worksheet “${requestedTitle}” was not found` },
        { status: 422 },
      );
    const legacy = legacyRows(sheet);
    if (legacy) return await auditedOperationalJson(user, "admin/import/workbook", { workbookTitle: file.name, sheetTitle: sheet.name, sheetTitles, suggestedDataset: legacy.dataset, csv: legacy.rows.map(row => row.map(csvCell).join(",")).join("\n"), rowCount: legacy.rows.length - 1 });
    const headerMarkers = new Set(["full_name", "code", "test_code"]);
    let headerRow = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (!headerRow && headerMarkers.has(row.getCell(1).text.trim().toLowerCase())) headerRow = rowNumber;
    });
    if (!headerRow)
      return await auditedOperationalJson(user, "admin/import/workbook", { error: `Worksheet “${requestedTitle}” does not contain a supported header row` }, { status: 422 });
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < headerRow) return;
      const values: string[] = [];
      for (let column = 1; column <= sheet.actualColumnCount; column++)
        values.push(csvCell(row.getCell(column).text.trim()));
      lines.push(values.join(","));
    });
    return await auditedOperationalJson(user, "admin/import/workbook", {
      workbookTitle: file.name,
      sheetTitle: sheet.name,
      sheetTitles,
      csv: lines.join("\n"),
      rowCount: Math.max(0, lines.length - 1),
    });
  } catch (error) {
    return apiError(error);
  }
}
