import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "/Users/useruser/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbook = Workbook.create();
const navy = "#075A78", teal = "#087F72", pale = "#E7F6F3", line = "#D7E3E8";
const sheets = [
  { name: "Medicines", note: "Selling price feeds billing. Cost price supports margin and opening stock valuation.", headers: ["code","name","generic_name","strength","dosage_form","unit_of_measure","pack_size","cost_price","unit_price","opening_quantity","batch_number","expiry_date","store_code","reorder_level","description","active"], example: [] },
  { name: "Procedures", note: "Cost price is internal. Unit price is the amount billed to the patient or payer.", headers: ["code","name","cost_price","unit_price","department","modality","description","active"], example: ["CONSULT","General consultation",300,800,"Consultation","","Outpatient clinician consultation",true] },
  { name: "Laboratory tests", note: "Use a unique code for every billable test or panel.", headers: ["code","name","synonyms","loinc_code","department","panel_or_single","specimen_type","container","method","turnaround_minutes","khis_mapping","unit_price","description","active"], example: ["FBC","Full blood count","CBC|Haemogram","58410-2","Laboratory","PANEL","Blood","EDTA","Automated",60,"",600,"Full haemogram",true] },
  { name: "Non-pharmaceuticals", note: "Consumables and general-store items that require stock control.", headers: ["code","name","unit_price","unit_of_measure","pack_size","reorder_level","description","active"], example: [] },
];

const guide = workbook.worksheets.add("Read me"); guide.showGridLines = false;
guide.getRange("A1").values = [["Mwein data migration workbook"]];
guide.getRange("A1:F1").format = { font: { bold: true, size: 18, color: navy }, rowHeight: 30 };
guide.getRange("A3:B9").values = [["Step","Action"],[1,"Keep the column headings unchanged."],[2,"Enter records from row 5 on each relevant sheet."],[3,"Use one row per medicine, procedure, test or supply item."],[4,"Use unique catalogue codes and medicine batch numbers."],[5,"Upload in Administration → Data imports."],[6,"Preview and correct every error before publishing."]];
guide.getRange("A3:B9").format.borders = { preset: "inside", style: "thin", color: line }; guide.getRange("A3:B3").format = { fill: navy, font: { bold: true, color: "#FFFFFF" } }; guide.getRange("A:B").format.columnWidth = 26; guide.getRange("B:B").format.columnWidth = 72; guide.getRange("A3:B9").format.wrapText = true;

for (const definition of sheets) {
  const sheet = workbook.worksheets.add(definition.name); sheet.showGridLines = false; sheet.freezePanes.freezeRows(4);
  const last = String.fromCharCode(64 + definition.headers.length);
  sheet.getRange("A1").values = [[definition.name]]; sheet.getRange(`A1:${last}1`).format = { font: { bold: true, size: 16, color: navy }, rowHeight: 28 };
  sheet.getRange("A2").values = [[definition.note]]; sheet.getRange(`A2:${last}2`).format = { font: { italic: true, color: "#5D7180" }, wrapText: true };
  sheet.getRange(`A4:${last}5`).values = [definition.headers, definition.headers.map(() => null)];
  sheet.getRange(`A4:${last}4`).format = { fill: navy, font: { bold: true, color: "#FFFFFF" }, wrapText: true, verticalAlignment: "center", borders: { preset: "inside", style: "thin", color: "#FFFFFF" } };
  sheet.getRange(`A5:${last}5`).format = { fill: pale, borders: { preset: "inside", style: "thin", color: line }, verticalAlignment: "center" };
  sheet.getRange(`A4:${last}1004`).format.wrapText = true; sheet.getRange(`A:${last}`).format.columnWidth = 18;
  sheet.getRange("A:A").format.columnWidth = 16; sheet.getRange("B:B").format.columnWidth = 30;
  if (definition.name === "Medicines") { sheet.getRange("G5:K1004").setNumberFormat("#,##0.00"); sheet.getRange("L5:L1004").setNumberFormat("yyyy-mm-dd"); }
  if (definition.name === "Procedures") sheet.getRange("C5:D1004").setNumberFormat("#,##0.00");
  const table = sheet.tables.add(`A4:${last}5`, true, `${definition.name.replaceAll(/[^A-Za-z]/g, "")}Table`); table.style = "TableStyleMedium2";
}

const outputPath = new URL("../public/templates/mwein-data-migration-template.xlsx", import.meta.url);
await fs.mkdir(new URL("../public/templates/", import.meta.url), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook); await output.save(outputPath.pathname);
for (const definition of ["Read me", ...sheets.map(item => item.name)]) {
  const columns = definition === "Read me" ? "F" : String.fromCharCode(64 + sheets.find(item => item.name === definition).headers.length);
  const range = `A1:${columns}${definition === "Read me" ? 9 : 8}`;
  console.log((await workbook.inspect({ kind: "table", sheetId: definition, range, include: "values,formulas", tableMaxRows: 9, tableMaxCols: 16 })).ndjson);
  const preview = await workbook.render({ sheetName: definition, range, scale: 1 }); await fs.writeFile(`/tmp/mwein-${definition.replaceAll(" ", "-")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" })).ndjson);
