"use client";

import { useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Dataset =
  | "PATIENTS"
  | "LAB_TESTS"
  | "PROCEDURES"
  | "PHARMACEUTICALS"
  | "NON_PHARMACEUTICALS"
  | "LAB_REFERENCE_RANGES";
const datasets: Record<Dataset, { label: string; headers: string }> = {
  PATIENTS: {
    label: "Patient register",
    headers:
      "full_name,date_of_birth,estimated_age_years,sex_at_birth,phone,national_id,sha_number,county,subcounty,ward,village,preferred_language",
  },
  LAB_TESTS: {
    label: "Laboratory tests",
    headers: "code,name,synonyms,loinc_code,department,panel_or_single,specimen_type,container,method,turnaround_minutes,khis_mapping,unit_price,description,active",
  },
  PROCEDURES: {
    label: "Procedures & imaging",
    headers: "code,name,unit_price,modality,description,active",
  },
  PHARMACEUTICALS: {
    label: "Pharmaceuticals",
    headers:
      "code,name,unit_price,generic_name,strength,dosage_form,unit_of_measure,reorder_level,description,active",
  },
  NON_PHARMACEUTICALS: {
    label: "Non-pharmaceuticals",
    headers:
      "code,name,unit_price,unit_of_measure,reorder_level,description,active",
  },
  LAB_REFERENCE_RANGES: {
    label: "Laboratory reference intervals",
    headers:
      "test_code,component_code,analyte,loinc_code,unit,unit_ucum,display_order,sex_at_birth,min_age_days,max_age_days,pregnancy_stage,lower_limit,upper_limit,critical_low,critical_high,qualitative_values,analyser,method,approved_by,source",
  },
};
type Preview = {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
};

export default function ImportCenter() {
  const [dataset, setDataset] = useState<Dataset>("PATIENTS");
  const [csv, setCsv] = useState("");
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [workbookTitle, setWorkbookTitle] = useState("");
  const [sheetTitles, setSheetTitles] = useState<string[]>([]);
  const [sheetTitle, setSheetTitle] = useState("");
  const [preview, setPreview] = useState<Preview[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    valid: number;
    invalid: number;
    publishable: boolean;
    page: number;
    pageCount: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function send(publish: boolean, page = 1) {
    setError("");
    setNotice("");
    try {
      const data = await jsonRequest<any>("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ dataset, csv, publish, page, pageSize: 25, sourceTitle: workbookTitle || undefined, sheetTitle: sheetTitle || undefined }),
      }, "Import failed");
      if (!publish) {
        setPreview(data.preview);
        setSummary(data);
      } else {
        setNotice(`${data.imported} ${datasets[dataset].label.toLowerCase()} row(s) published successfully.`);
        setCsv("");
        setPreview([]);
        setSummary(null);
      }
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function readWorkbook(file: File, selectedSheet?: string) {
    setError("");
    const form = new FormData();
    form.set("file", file);
    if (selectedSheet) form.set("sheetTitle", selectedSheet);
    try {
      const data = await jsonRequest<any>("/api/admin/import/workbook", { method: "POST", body: form }, "Workbook could not be read");
      setWorkbookTitle(data.workbookTitle);
      setSheetTitles(data.sheetTitles || []);
      if (data.csv) {
        setSheetTitle(data.sheetTitle);
        setCsv(data.csv);
        setPreview([]);
        setSummary(null);
      }
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function template() {
    const blob = new Blob([`${datasets[dataset].headers}\n`], {
      type: "text/csv",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${dataset.toLowerCase()}-template.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>CSV & Excel import centre</h1>
          <p>
            Validate facility data before publishing it into the selected
            operational register.
          </p>
        </div>
        <button className="secondary" onClick={template}>
          Download selected template
        </button>
      </header>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      <section className="card dataForm">
        <label>
          Dataset destination
          <select
            value={dataset}
            onChange={(event) => {
              setDataset(event.target.value as Dataset);
              setPreview([]);
              setSummary(null);
            }}
          >
            {(Object.keys(datasets) as Dataset[]).map((value) => (
              <option value={value} key={value}>
                {datasets[value].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSV or Excel workbook
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) {
                setWorkbook(
                  file.name.toLowerCase().endsWith(".xlsx") ? file : null,
                );
                setWorkbookTitle(file.name);
                setSheetTitles([]);
                setSheetTitle("");
                if (file.name.toLowerCase().endsWith(".xlsx")) {
                  setCsv("");
                  await readWorkbook(file);
                } else setCsv(await file.text());
                setPreview([]);
                setSummary(null);
              }
            }}
          />
        </label>
        {sheetTitles.length > 0 && (
          <label>
            Worksheet title *
            <select
              value={sheetTitle}
              onChange={async (event) => {
                const title = event.target.value;
                setSheetTitle(title);
                if (workbook && title) await readWorkbook(workbook, title);
              }}
            >
              <option value="">Select the worksheet to publish</option>
              {sheetTitles.map((title) => (
                <option key={title}>{title}</option>
              ))}
            </select>
            <small>
              Workbook: {workbookTitle}. The selected sheet title is recorded in
              the preview.
            </small>
          </label>
        )}
        <div className="wide privacyNotice">
          <strong>Required CSV headers</strong>
          <span>{datasets[dataset].headers}</span>
        </div>
        <div className="wide submitBar">
          <span>
            The preview does not alter facility data. Publishing is enabled only
            when every row validates.
          </span>
          <button
            className="primary"
            disabled={!csv}
            onClick={() => send(false)}
          >
            Validate and preview
          </button>
        </div>
      </section>
      {summary && (
        <section className="card importPreview">
          <div className="cardHead">
            <div>
              <h2>Import preview</h2>
              <p>
                {workbookTitle}
                {sheetTitle ? ` · Sheet: ${sheetTitle}` : ""} · {summary.total}{" "}
                rows · {summary.valid} valid · {summary.invalid} invalid
              </p>
            </div>
            <button disabled={!summary.publishable} onClick={() => send(true)}>
              Publish valid dataset
            </button>
          </div>
          <div className="tableScroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Data</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr
                    className={row.errors.length ? "invalid" : ""}
                    key={row.rowNumber}
                  >
                    <td>{row.rowNumber}</td>
                    <td>
                      {Object.entries(row.values).map(
                        ([key, value]) =>
                          value && (
                            <span key={key}>
                              <b>{key}:</b> {value}
                            </span>
                          ),
                      )}
                    </td>
                    <td>
                      {row.errors.length ? row.errors.join("; ") : "Ready"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button
              disabled={summary.page <= 1}
              onClick={() => send(false, summary.page - 1)}
            >
              ← Previous
            </button>
            <span>
              Page {summary.page} of {summary.pageCount}
            </span>
            <button
              disabled={summary.page >= summary.pageCount}
              onClick={() => send(false, summary.page + 1)}
            >
              Next →
            </button>
          </div>
        </section>
      )}
    </>
  );
}
