"use client";

import { useRef, useState } from "react";
import { SearchablePicker } from "./SearchablePicker";
import { RecordFields } from "./RecordFields";
import { frequencyLabel, prescriptionCalculation, readPrescribingDefaults, type PrescribingDefaults } from "@/lib/prescribing-defaults";
import { jsonRequest } from "@/lib/client-http";

type Medicine = {
  code: string;
  name: string;
  category: string;
  active?: boolean;
  unitOfMeasure?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  prescribingDefaults?: unknown;
};
type Line = {
  medicineCode: string;
  calculationDefaults?: PrescribingDefaults;
  indication: string;
  dose: string;
  doseQuantity: string;
  route: string;
  frequency: string;
  frequencyPerDay: string;
  durationDays: string;
  startDate: string;
  stopDate: string;
  quantity: string;
  quantityConfirmed: boolean;
  instructions: string;
  doseTiming: string;
  sequenceNote: string;
  existingOrderId?: string;
  expectedPrescriptionKey?: string | null;
  correctionReason?: string;
};
export type PrescriptionOrder = {
  id: string;
  type: string;
  status: string;
  displayName: string;
  clinicalIndication?: string | null;
  requestedAt?: string;
  orderedBy?: { displayName: string };
  prescription?: {
    genericName?: string | null;
    strength?: string | null;
    dosageForm?: string | null;
    medicineCode: string;
    dose: string;
    doseQuantity?: string | number | null;
    route: string;
    frequency: string;
    frequencyPerDay?: number | null;
    duration?: string | null;
    durationDays?: number | null;
    startDate?: string;
    stopDate?: string | null;
    quantity: string;
    instructions: string;
    doseTiming?: string;
    sequenceNote?: string | null;
    idempotencyKey?: string | null;
    dispenseStatus: string;
    dispensedQuantity?: string | null;
  } | null;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const blank = (indication: string): Line => ({
  medicineCode: "",
  indication,
  dose: "",
  doseQuantity: "",
  route: "",
  frequency: "",
  frequencyPerDay: "",
  durationDays: "",
  startDate: today(),
  stopDate: "",
  quantity: "",
  quantityConfirmed: false,
  instructions: "",
  doseTiming: "SCHEDULED",
  sequenceNote: "",
});
const instructionsFor = (line: Line) => line.instructions.trim() || `${line.dose}; ${line.route}; ${line.frequency}; ${line.durationDays} days.`;
function payload(line: Line) {
  return {
    ...line,
    doseQuantity: Number(line.doseQuantity),
    instructions: instructionsFor(line),
    frequencyPerDay: Number(line.frequencyPerDay),
    durationDays: Number(line.durationDays),
    duration: line.durationDays + " days",
    quantity: Number(line.quantity),
    stopDate: line.stopDate || undefined,
    sequenceNote: line.sequenceNote || undefined,
    correctionReason: line.correctionReason || undefined,
  };
}
function fromOrder(order: PrescriptionOrder): Line {
  const p = order.prescription!;
  return {
    medicineCode: p.medicineCode,
    indication: order.clinicalIndication || "",
    dose: p.dose,
    doseQuantity: String(p.doseQuantity ?? ""),
    route: p.route,
    frequency: p.frequency,
    frequencyPerDay: String(p.frequencyPerDay ?? ""),
    durationDays: String(p.durationDays ?? ""),
    startDate: p.startDate?.slice(0, 10) || today(),
    stopDate: p.stopDate?.slice(0, 10) || "",
    quantity: String(p.quantity),
    quantityConfirmed: false,
    instructions: p.instructions,
    doseTiming: p.doseTiming || "SCHEDULED",
    sequenceNote: p.sequenceNote || "",
    existingOrderId: order.id,
    expectedPrescriptionKey: p.idempotencyKey ?? null,
  };
}

export default function PrescriptionComposer({
  visitId,
  catalogue,
  orders,
  indication,
  busy,
  onSave,
  onSaved,
}: {
  visitId: string;
  catalogue: Medicine[];
  orders: PrescriptionOrder[];
  indication: string;
  busy: boolean;
  onSave: (data: object) => Promise<any>;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(
    orders.filter((o) => o.type === "MEDICATION" && o.prescription),
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [editor, setEditor] = useState<Line>(() => blank(indication));
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<object | null>(null);
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<HTMLFieldSetElement>(null);
  const pending = useRef(false);
  const locked = busy || loading || !!uncertain;
  const selected = catalogue.find(item => item.code === editor.medicineCode);
  const name = (line: Line) => {
    const m = catalogue.find((m) => m.code === line.medicineCode);
    return m
      ? [m.genericName || m.name, m.strength, m.dosageForm]
          .filter(Boolean)
          .join(" · ")
      : line.medicineCode;
  };
  function change(patch: Partial<Line>) {
    setEditor((current) => {
      const next = { ...current, ...patch };
      if (["dose", "frequencyPerDay", "durationDays"].some(key => key in patch)) {
        const calculated = prescriptionCalculation(next.dose, next.frequencyPerDay, next.durationDays, next.calculationDefaults || null);
        next.doseQuantity = calculated ? String(calculated.doseQuantity) : "";
        next.quantity = calculated ? String(calculated.quantity) : "";
      }
      if (!("quantityConfirmed" in patch)) next.quantityConfirmed = false;
      return next;
    });
  }
  function validate() {
    if (!editor.medicineCode) {
      setError("Choose a medicine first.");
      return false;
    }
    for (const element of editorRef.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input,select,textarea") || [])
      if (!element.checkValidity()) {
        const details = element.closest("details");
        if (details) details.open = true;
        element.reportValidity();
        return false;
      }
    const calculated = prescriptionCalculation(editor.dose, editor.frequencyPerDay, editor.durationDays, editor.calculationDefaults || null);
    if (!calculated || !editor.quantity) {
      setError("A valid dose and facility-configured dose conversion are required to calculate quantity. Review the medicine catalogue defaults.");
      return false;
    }
    return true;
  }
  function stage() {
    if (!validate()) return false;
    if (
      lines.some(
        (line, index) =>
          index !== editing && line.medicineCode === editor.medicineCode,
      )
    ) {
      setError("This medicine is already on the list. Edit its existing line.");
      return false;
    }
    if (editing === null && lines.length >= 20) {
      setError("Review and save this list before adding more medicines.");
      return false;
    }
    const calculated = prescriptionCalculation(editor.dose, editor.frequencyPerDay, editor.durationDays, editor.calculationDefaults || null)!;
    const reviewed = { ...editor, dose: calculated.dose, doseQuantity: String(calculated.doseQuantity), quantity: String(calculated.quantity) };
    const next = editing === null ? [...lines, reviewed] : lines.map((line, index) => index === editing ? reviewed : line);
    setLines(next);
    setEditor(blank(indication));
    setEditing(null);
    setError("");
    requestAnimationFrame(() => editorRef.current?.querySelector<HTMLInputElement>(".searchablePicker input:not([type=hidden])")?.focus());
    return next;
  }
  async function save(submit: boolean, retry?: object) {
    if (pending.current || busy) return;
    let next = lines;
    if (!retry && editor.medicineCode) {
      const staged = stage();
      if (!staged) return;
      next = staged;
    }
    if (!retry && !next.length) {
      setError("Add at least one medicine to the prescription list.");
      return;
    }
    const body = retry || {
      submit,
      idempotencyKey: crypto.randomUUID(),
      prescriptions: next.map(payload),
    };
    pending.current = true;
    setError("");
    try {
      const result = await onSave(body);
      if (!result || result.failed || !Array.isArray(result.orders)) {
        if (
          !result ||
          !result.failed ||
          result.status === 0 ||
          result.status >= 500
        )
          setUncertain(body);
        return;
      }
      setSaved(result.orders || saved);
      setLines([]);
      setEditor(blank(indication));
      setEditing(null);
      setUncertain(null);
      onSaved();
    } finally {
      pending.current = false;
    }
  }
  async function reload() {
    if (locked || pending.current) return;
    setLoading(true);
    setError("");
    try {
      const data = await jsonRequest<{
        visit: { orders: PrescriptionOrder[] };
      }>("/api/visits/" + visitId + "/consultation");
      setSaved(data.visit.orders || []);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function editSaved(order: PrescriptionOrder) {
    if (
      editor.medicineCode &&
      !window.confirm(
        "Replace the medicine currently being entered? Your staged list stays intact.",
      )
    )
      return;
    if (lines.some((l) => l.existingOrderId === order.id)) {
      setError(
        "This saved medicine is already on your review list. Edit that line.",
      );
      return;
    }
    const line = fromOrder(order);
    const defaults = readPrescribingDefaults(catalogue.find(item => item.code === line.medicineCode)?.prescribingDefaults);
    const calculated = prescriptionCalculation(line.dose, line.frequencyPerDay, line.durationDays, defaults);
    setEditor({ ...line, calculationDefaults: defaults || undefined, quantity: calculated ? String(calculated.quantity) : "", doseQuantity: calculated ? String(calculated.doseQuantity) : "" });
    setEditing(null);
    setError(calculated && calculated.quantity !== Number(line.quantity) ? "Supply quantity recalculated from current facility settings. Review it before resubmitting." : "");
    editorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const sentEdit =
    !!editor.existingOrderId &&
    saved.find((o) => o.id === editor.existingOrderId)?.status !== "DRAFT";
  return (
    <div className="prescriptionComposer span2">
      <input
        type="hidden"
        name="prescriptionList"
        value={JSON.stringify(lines)}
      />
      <header className="rxHeading noPrint">
        <div>
          <h3>Prescription list</h3>
          <p>
            Choose a medicine and enter its directions. Add another if needed,
            then review the list below and save or send it.
          </p>
        </div>
        <strong>
          {lines.length} added to list{editor.medicineCode ? " · Entry in progress" : ""}
        </strong>
      </header>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {uncertain && (
        <div className="alert" role="alert">
          <strong>Save confirmation is missing.</strong>
          <p>
            The list is locked so retry uses exactly the same medicines and
            quantities.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void save(false, uncertain)}
          >
            Retry unchanged prescription
          </button>
        </div>
      )}
      <fieldset ref={editorRef} disabled={locked} className="rxEditor rxCompactEditor noPrint">
        <legend>
          {editing === null
            ? editor.existingOrderId
              ? "Review saved medicine"
              : "Add a medicine"
            : "Edit medicine " + (editing + 1)}
        </legend>
        <label className="rxMedicine">
          Medicine
          <SearchablePicker
            name="medicineCode"
            value={editor.medicineCode}
            onChange={(value) => {
              if (editor.existingOrderId) return;
              const defaults = readPrescribingDefaults(catalogue.find(item => item.code === value)?.prescribingDefaults);
              setEditor({ ...blank(""), medicineCode: value, calculationDefaults: defaults || undefined,
                route: defaults?.route || "", frequencyPerDay: defaults ? String(defaults.frequencyPerDay) : "",
                frequency: defaults ? frequencyLabel(defaults.frequencyPerDay) : "", durationDays: defaults ? String(defaults.durationDays) : "" });
              requestAnimationFrame(() => editorRef.current?.querySelector<HTMLInputElement>('input[name="dose"]')?.focus());
            }}
            placeholder="Search medicine by generic, brand or strength…"
            options={catalogue
              .filter(
                (m) =>
                  m.category === "PHARMACEUTICAL" &&
                  m.active !== false &&
                  (!editor.existingOrderId || m.code === editor.medicineCode),
              )
              .map((m) => ({
                value: m.code,
                label: [m.genericName || m.name, m.strength, m.dosageForm]
                  .filter(Boolean)
                  .join(" · "),
                detail: m.name + " · " + m.code,
              }))}
          />
          {selected && <small className="rxSelected">{name(editor)}</small>}
        </label>
        {editor.medicineCode && (
          <>
            <label>
              Dose ({editor.calculationDefaults?.doseUnit || "unit not configured"}) *
              <input
                name="dose"
                value={editor.dose}
                onChange={(e) => change({ dose: e.target.value })}
                required
                maxLength={100}
                placeholder={editor.calculationDefaults ? `Amount in ${editor.calculationDefaults.doseUnit}` : "Configure dose unit first"}
              />
            </label>
            <label>
              Route *
              <select
                name="route"
                value={editor.route}
                onChange={(e) => change({ route: e.target.value })}
                required
              >
                <option value="">Choose route</option>
                {["Oral", "Topical", "Inhaled", "IM", "IV"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
                {editor.route &&
                  !["Oral", "Topical", "Inhaled", "IM", "IV"].includes(
                    editor.route,
                  ) && <option>{editor.route}</option>}
              </select>
            </label>
            <label>
              Frequency *
              <select
                aria-label="Frequency *"
                name="frequencyPerDay"
                value={editor.frequencyPerDay}
                required
                onChange={(e) =>
                  change({
                    frequencyPerDay: e.target.value,
                    frequency: e.target.selectedOptions[0].text,
                  })
                }
              >
                <option value="">Choose frequency</option>
                {[
                  [1, "Once daily"],
                  [2, "Twice daily"],
                  [3, "Three times daily"],
                  [4, "Four times daily"],
                ].map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
                {editor.frequencyPerDay &&
                  !["1", "2", "3", "4"].includes(editor.frequencyPerDay) && (
                    <option value={editor.frequencyPerDay}>
                      {editor.frequency}
                    </option>
                  )}
              </select>
            </label>
            <label>
              Duration in days *
              <input
                name="durationDays"
                type="number"
                min="1"
                max="3650"
                required
                value={editor.durationDays}
                onChange={(e) => change({ durationDays: e.target.value })}
              />
            </label>
            <label>Quantity ({selected?.unitOfMeasure || "unit not configured"})
              <input name="quantity" type="number" required readOnly value={editor.quantity} aria-label="Calculated dispensing quantity" />
            </label>
            {!editor.calculationDefaults && <p className="wide error" role="status">Facility prescribing defaults are not configured for this medicine. Configure its route, frequency, duration and dose conversion in the catalogue.</p>}
            <details className="rxCourseDetails wide">
              <summary>Additional patient instructions</summary>
              <label>Instructions (optional)<textarea name="medicineInstructions" maxLength={500} value={editor.instructions} onChange={e => change({ instructions: e.target.value })} /></label>
            </details>
            <details className="rxCourseDetails wide">
              <summary>Course dates and dose timing <span>Starts {editor.startDate || "Not set"} · {editor.doseTiming.replaceAll("_", " ")}{editor.stopDate ? ` · Stops ${editor.stopDate}` : ""}</span></summary>
              <div className="rxEntryGroup">
            <label>
              Start date *
              <input
                name="startDate"
                type="date"
                required
                value={editor.startDate}
                onChange={(e) => change({ startDate: e.target.value })}
              />
            </label>
            <label>
              Stop date
              <input
                name="stopDate"
                type="date"
                min={editor.startDate}
                value={editor.stopDate}
                onChange={(e) => change({ stopDate: e.target.value })}
              />
            </label>
            <label>
              Dose timing
              <select
                name="doseTiming"
                value={editor.doseTiming}
                onChange={(e) => change({ doseTiming: e.target.value })}
              >
                <option value="SCHEDULED">Scheduled course</option>
                <option value="STAT">STAT dose</option>
                <option value="STAT_THEN_SCHEDULED">
                  STAT then scheduled course
                </option>
              </select>
            </label>
            <label>
              Sequence note
              <input
                name="sequenceNote"
                required={editor.doseTiming === "STAT_THEN_SCHEDULED"}
                maxLength={240}
                value={editor.sequenceNote}
                onChange={(e) => change({ sequenceNote: e.target.value })}
              />
            </label>
              </div>
            </details>
            {sentEdit && (
              <label className="wide">
                Reason for correction *
                <textarea
                  name="correctionReason"
                  required
                  minLength={10}
                  maxLength={500}
                  value={editor.correctionReason || ""}
                  onChange={(e) => change({ correctionReason: e.target.value })}
                />
              </label>
            )}
            <label className="wide rxCheck">
              <input
                name="quantityConfirmed"
                type="checkbox"
                required
                checked={editor.quantityConfirmed}
                onChange={(e) =>
                  change({ quantityConfirmed: e.target.checked })
                }
              />
              I reviewed the medicine instructions and confirmed the dispensing
              quantity.
            </label>
          </>
        )}
        <div className="wide rxEditorActions">
          <button
            type="button"
            className="primary"
            disabled={!editor.medicineCode}
            onClick={() => stage()}
          >
            {editing === null
              ? "Add to prescription list"
              : "Update medicine line"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEditor(blank(indication));
              setEditing(null);
            }}
          >
            Clear medicine entry
          </button>
        </div>
      </fieldset>
      {!!lines.length && (
        <div className="rxList noPrint" aria-label="Medicines to save">
          {lines.map((line, index) => (
            <article className="rxLine" key={index}>
              <h4>
                {index + 1}. {name(line)}
              </h4>
              <RecordFields
                fields={[
                  { label: "Dose", value: line.dose },
                  { label: "Route", value: line.route },
                  { label: "Frequency", value: line.frequency },
                  { label: "Duration", value: line.durationDays + " days" },
                  { label: "Quantity", value: line.quantity },
                  { label: "Starts", value: line.startDate },
                  {
                    label: "Patient instructions",
                    value: instructionsFor(line),
                    wide: true,
                  },
                ]}
              />
              <div className="rxLineActions noPrint">
                <button
                  type="button"
                  className="secondary"
                  disabled={locked}
                  onClick={() => {
                    if (
                      editor.medicineCode &&
                      !window.confirm(
                        "Replace the medicine currently being entered?",
                      )
                    )
                      return;
                    setEditor({ ...line, quantityConfirmed: false });
                    setEditing(index);
                  }}
                >
                  Edit medicine {index + 1}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={locked || editing !== null}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                >
                  Remove medicine {index + 1}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="rxActions noPrint">
        <span>
          {lines.length
            ? "Review every line before sending."
            : editor.medicineCode ? "Review the entered medicine before saving." : "Choose a medicine above."}
        </span>
        <div>
          <button
            type="button"
            className="secondary"
            disabled={
              locked ||
              (!lines.length && !editor.medicineCode) ||
              lines.some(
                (l) =>
                  l.existingOrderId &&
                  saved.find((o) => o.id === l.existingOrderId)?.status !==
                    "DRAFT",
              ) ||
              sentEdit
            }
            onClick={() => void save(false)}
          >
            Save for later
          </button>
          <button
            type="button"
            className="primary"
            disabled={locked || (!lines.length && !editor.medicineCode)}
            onClick={() => void save(true)}
          >
            {busy ? "Saving…" : "Send to pharmacy"}
          </button>
        </div>
      </div>
      <section className="rxSaved">
        <header className="rxHeading">
          <div>
            <h3>Saved prescriptions</h3>
            <p>
              Drafts stay with the clinician. Sent medicines are available to
              pharmacy; supply and billing remain separate steps.
            </p>
          </div>
          <button
            type="button"
            className="secondary noPrint"
            disabled={locked}
            onClick={() => void reload()}
          >
            Refresh saved prescriptions
          </button>
        </header>
        {!saved.length && <p>No medicines saved for this visit yet.</p>}
        {saved.map((order) => (
          <article className="rxLine" key={order.id}>
            <h4>
              {[order.prescription!.genericName || order.displayName, order.prescription!.strength, order.prescription!.dosageForm].filter(Boolean).join(" · ")}{" "}
              <span className="statusPill">
                {order.status === "DRAFT"
                  ? "Draft — not sent"
                  : order.status.replaceAll("_", " ")}
              </span>
            </h4>
            <RecordFields
              fields={[
                { label: "Dose", value: order.prescription!.dose },
                { label: "Route", value: order.prescription!.route },
                { label: "Frequency", value: order.prescription!.frequency },
                { label: "Duration", value: order.prescription!.duration },
                {
                  label: "Quantity",
                  value: Number(order.prescription!.quantity),
                },
                {
                  label: "Supply status",
                  value: order.prescription!.dispenseStatus.replaceAll(
                    "_",
                    " ",
                  ),
                },
                { label: "Current prescriber", value: order.orderedBy?.displayName },
                { label: "Order created", value: order.requestedAt ? new Date(order.requestedAt).toLocaleString("en-KE", {timeZone:"Africa/Nairobi"})+" Nairobi" : undefined },
                { label: "Indication", value: order.clinicalIndication },
                {
                  label: "Patient instructions",
                  value: order.prescription!.instructions,
                  wide: true,
                },
              ]}
            />
            {["DRAFT", "REQUESTED"].includes(order.status) &&
              order.prescription!.dispenseStatus === "PENDING" &&
              !Number(order.prescription!.dispensedQuantity || 0) && (
                <button
                  type="button"
                  className="secondary noPrint"
                  disabled={locked}
                  onClick={() => editSaved(order)}
                >
                  {order.status === "DRAFT"
                    ? "Review draft"
                    : "Correct prescription"}
                </button>
              )}
          </article>
        ))}
      </section>
    </div>
  );
}
