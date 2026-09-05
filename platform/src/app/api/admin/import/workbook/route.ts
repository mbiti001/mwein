import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function POST(request: Request) {
  try {
    await requirePermission("admin.catalog");
    const form = await request.formData();
    const file = form.get("file");
    const requestedTitle = String(form.get("sheetTitle") || "");
    if (!(file instanceof File))
      return NextResponse.json(
        { error: "Select an Excel workbook" },
        { status: 422 },
      );
    if (file.size > 10_000_000)
      return NextResponse.json(
        { error: "Workbook size is limited to 10 MB" },
        { status: 422 },
      );
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      return NextResponse.json(
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
      return NextResponse.json({ workbookTitle: file.name, sheetTitles });
    const sheet = workbook.getWorksheet(requestedTitle);
    if (!sheet)
      return NextResponse.json(
        { error: `Worksheet “${requestedTitle}” was not found` },
        { status: 422 },
      );
    const headerMarkers = new Set(["full_name", "code", "test_code"]);
    let headerRow = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (!headerRow && headerMarkers.has(row.getCell(1).text.trim().toLowerCase())) headerRow = rowNumber;
    });
    if (!headerRow)
      return NextResponse.json({ error: `Worksheet “${requestedTitle}” does not contain a supported header row` }, { status: 422 });
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < headerRow) return;
      const values: string[] = [];
      for (let column = 1; column <= sheet.actualColumnCount; column++)
        values.push(csvCell(row.getCell(column).text.trim()));
      lines.push(values.join(","));
    });
    return NextResponse.json({
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
