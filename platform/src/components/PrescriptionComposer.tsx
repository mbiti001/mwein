"use client";

import { useRef, useState } from "react";
import { SearchablePicker } from "./SearchablePicker";
import { chargeMoney, orderCharge, type OrderCharge } from "@/lib/order-charges";
import { directIssueConversion, frequencyLabel, prescriptionCalculation, readPrescribingDefaults, type PrescribingDefaults } from "@/lib/prescribing-defaults";
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
  needsRefill: boolean;
  isPrn: boolean;
  prnIndication: string;
  calculationDefaults?: PrescribingDefaults;
  issueUnit?: string;
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
  charge?: OrderCharge;
  quotedUnitPrice?: string | number | null;
  invoiceItems?: { quantity: string; unitPrice: string }[];
  type: string;
  status: string;
  displayName: string;
  clinicalIndication?: string | null;
  requestedAt?: string;
  orderedBy?: { displayName: string };
  prescription?: {
    needsRefill?: boolean; isPrn?: boolean; prnIndication?: string | null;
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
  medicineCode: "", needsRefill: false, isPrn: false, prnIndication: "",
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
const conversionFor = (line: Line) => line.calculationDefaults || directIssueConversion(line.issueUnit);
const instructionsFor = (line: Line) => [`${line.dose}; ${line.route}; ${line.frequency}; ${line.durationDays} days.`, line.isPrn ? `As needed for ${line.prnIndication}.` : "", line.instructions.trim()].filter(Boolean).join(" ");
function payload(line: Line) {
  return {
    ...line,
    doseQuantity: Number(line.doseQuantity),
    instructions: instructionsFor(line),
    frequencyPerDay: Number(line.frequencyPerDay),
    durationDays: Number(line.durationDays),
    duration: line.durationDays + " days",
    quantity: Number(line.quantity), quantityConfirmed: true,
    stopDate: line.stopDate || undefined,
    sequenceNote: line.sequenceNote || undefined,
    correctionReason: line.correctionReason || undefined,
  };
}
function fromOrder(order: PrescriptionOrder): Line {
  const p = order.prescription!;
  const line: Line = {
    medicineCode: p.medicineCode, needsRefill: !!p.needsRefill, isPrn: !!p.isPrn, prnIndication: p.prnIndication || "",
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
  const directions = instructionsFor({ ...line, instructions: "" });
  if (line.instructions.startsWith(directions)) {
    line.instructions = line.instructions.slice(directions.length).trimStart();
  }
  return line;
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
  const [editor, setEditor] = useState<Line>(() => blank(indication));
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<object | null>(null);
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<HTMLFieldSetElement>(null);
  const pending = useRef(false);
  const locked = busy || loading || !!uncertain;
  const selected = catalogue.find(item => item.code === editor.medicineCode);
  function change(patch: Partial<Line>) {
    setEditor((current) => {
      const next = { ...current, ...patch };
      if (["dose", "frequencyPerDay", "durationDays"].some(key => key in patch)) {
        const calculated = prescriptionCalculation(next.dose, next.frequencyPerDay, next.durationDays, conversionFor(next));
        next.doseQuantity = calculated ? String(calculated.doseQuantity) : "";
        next.quantity = calculated ? String(calculated.quantity) : "";
      }
      next.quantityConfirmed = !!prescriptionCalculation(next.dose, next.frequencyPerDay, next.durationDays, conversionFor(next));
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
    const calculated = prescriptionCalculation(editor.dose, editor.frequencyPerDay, editor.durationDays, conversionFor(editor));
    if (!calculated || !editor.quantity) {
      setError("A valid dose and facility-configured dose conversion are required to calculate quantity. Review the medicine catalogue defaults.");
      return false;
    }
    return true;
  }
  async function save(retry?: object) {
    if (pending.current || busy) return;
    if (!retry && !validate()) return;
    const calculated = prescriptionCalculation(editor.dose, editor.frequencyPerDay, editor.durationDays, conversionFor(editor));
    if (!retry && !calculated) return;
    const body = retry || {
      submit: true,
      idempotencyKey: crypto.randomUUID(),
      prescriptions: [payload({ ...editor, indication: editor.indication || indication,
        dose: calculated!.dose, doseQuantity: String(calculated!.doseQuantity), quantity: String(calculated!.quantity) })],
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
      setEditor(blank(indication));
      setUncertain(null);
      onSaved();
      requestAnimationFrame(() => editorRef.current?.querySelector<HTMLInputElement>(".searchablePicker input:not([type=hidden])")?.focus());
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
        "Replace the medicine currently being entered?",
      )
    )
      return;
    const line = fromOrder(order);
    const item = catalogue.find(item => item.code === line.medicineCode);
    const defaults = readPrescribingDefaults(item?.prescribingDefaults);
    const issueUnit = defaults ? undefined : directIssueConversion(item?.unitOfMeasure)?.doseUnit;
    const calculated = prescriptionCalculation(line.dose, line.frequencyPerDay, line.durationDays, defaults || directIssueConversion(issueUnit));
    setEditor({ ...line, issueUnit, calculationDefaults: defaults || undefined, quantity: calculated ? String(calculated.quantity) : "", doseQuantity: calculated ? String(calculated.doseQuantity) : "" });
    setError(calculated && calculated.quantity !== Number(line.quantity) ? "Supply quantity recalculated from current facility settings. Review it before resubmitting." : "");
    editorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const sentEdit =
    !!editor.existingOrderId &&
    saved.find((o) => o.id === editor.existingOrderId)?.status !== "DRAFT";
  return (
    <div className="prescriptionComposer span2">
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
            onClick={() => void save(uncertain)}
          >
            Retry unchanged prescription
          </button>
        </div>
      )}
      <fieldset ref={editorRef} disabled={locked} className="rxEditor rxCompactEditor noPrint">
        <legend>
          {editor.existingOrderId ? "Review saved medicine" : "Add a medicine"}
        </legend>

        <label className="rxMedicine">
          Generic item names *
          <SearchablePicker
            name="medicineCode"
            value={editor.medicineCode}
            onChange={(value) => {
              if (editor.existingOrderId) return;
              const item = catalogue.find(item => item.code === value);
              const defaults = readPrescribingDefaults(item?.prescribingDefaults);
              setEditor({ ...blank(indication), medicineCode: value, issueUnit: defaults ? undefined : directIssueConversion(item?.unitOfMeasure)?.doseUnit, calculationDefaults: defaults || undefined,
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

        </label>
        {editor.medicineCode && (
          <>
            <div className="rxItemMeta"><small>Medicine identifier</small><strong>{editor.medicineCode}</strong></div>
            <label>Dose ({conversionFor(editor)?.doseUnit || selected?.dosageForm || "amount"}) *<input name="dose" value={editor.dose} onChange={event => change({ dose: event.target.value })} required maxLength={100} placeholder="Amount" /></label>
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
            {!conversionFor(editor) && <p className="wide error" role="status">Facility prescribing defaults are not configured for this medicine. Configure its route, frequency, duration and dose conversion in the catalogue.</p>}
            <label className="rxCheck"><input type="checkbox" name="needsRefill" checked={editor.needsRefill} onChange={e => change({ needsRefill: e.target.checked })} />Needs refill review</label>
            <label className="rxCheck"><input type="checkbox" name="isPrn" checked={editor.isPrn} onChange={e => change({ isPrn: e.target.checked })} />Take as needed (PRN)</label>
            {editor.isPrn && <label>Take as needed for<input required maxLength={240} name="prnIndication" value={editor.prnIndication} onChange={e => change({ prnIndication: e.target.value })} /></label>}
            <details className="rxCourseDetails wide">
              <summary>Additional patient instructions</summary>
              <label>Instructions (optional)<textarea name="medicineInstructions" maxLength={500} value={editor.instructions} onChange={e => change({ instructions: e.target.value })} /></label>
            </details>
            <details className="rxCourseDetails wide">
              <summary>Course dates <span>Starts {editor.startDate || "Not set"}{editor.stopDate ? ` · Stops ${editor.stopDate}` : ""}</span></summary>
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
          </>
        )}
        <div className="wide rxSaveArea">
          {editor.quantity && <p className="wide">Written prescription: {editor.dose} {/^([0-9.]+)$/.test(editor.dose.trim()) ? conversionFor(editor)?.doseUnit : ""} · {editor.route} · {editor.frequency} for {editor.durationDays} days.</p>}
          <div className="rxEditorActions">
            {editor.medicineCode && (<label>Quantity ({selected?.unitOfMeasure || "unit not configured"})
              <input name="quantity" type="number" required readOnly value={editor.quantity} aria-label="Calculated dispensing quantity" />
            </label>)}
            <button type="button" className="primary" disabled={locked || !editor.medicineCode || !conversionFor(editor)}
              onClick={() => void save()}>
              {busy ? "Saving…" : editor.existingOrderId ? "Save correction" : "Save prescription"}
            </button>
          </div>
        </div>
      </fieldset>
      <section className="rxSaved">
        <header className="rxHeading">
          <div>
            <h3>Saved prescriptions</h3>

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
        <div className="workflowTableScroll"><table className="workflowOrderTable" aria-label="Saved prescriptions"><thead><tr><th>Duration</th><th>Medication</th><th>Instructions</th><th>Quantity</th><th>Unit price</th><th>Total</th><th>Status / action</th></tr></thead><tbody>{saved.filter(order => order.prescription && order.status !== "CANCELLED").map(order => {
          const charge = order.charge || orderCharge(order); const prescription = order.prescription!;
          return <tr key={order.id}><td>{prescription.startDate?.slice(0,10)}{prescription.stopDate ? ` – ${prescription.stopDate.slice(0,10)}` : ""}</td><td><strong>{order.displayName}</strong></td><td>{prescription.instructions}</td><td>{Number(prescription.quantity)}</td><td>{chargeMoney(charge.unitPrice)}</td><td>{chargeMoney(charge.total)}</td><td>{prescription.dispenseStatus === "DISPENSED" ? "Dispensed" : order.status === "DRAFT" ? "Draft" : "Sent to pharmacy"}{["DRAFT", "REQUESTED"].includes(order.status) && prescription.dispenseStatus === "PENDING" && !Number(prescription.dispensedQuantity || 0) && <button type="button" className="secondary" disabled={locked} onClick={() => editSaved(order)}>Correct</button>}</td></tr>;
        })}</tbody></table></div>
      </section>
    </div>
  );
}
