export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((value) =>
    value
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[ -]+/g, "_"),
  );
  return rows
    .slice(1)
    .map((values, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(
        headers.map((header, column) => [header, values[column] || ""]),
      ),
    }));
}
