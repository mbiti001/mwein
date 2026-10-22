"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { KEML_SOURCE, kenyaMedicineReferences, kenyaReferenceDraft } from "@/lib/kenya-medicines";
import { SearchablePicker } from "./SearchablePicker";
import { jsonRequest } from "@/lib/client-http";
import { nairobiDateInputValue } from "@/lib/catalog-pricing";

import type { PrescribingDefaults } from "@/lib/prescribing-defaults";

type Category =
  | "LABORATORY_TEST"
  | "PROCEDURE"
  | "PHARMACEUTICAL"
  | "NON_PHARMACEUTICAL";
type Item = {
  id: string;
  category: Category;
  code: string;
  name: string;
  description?: string | null;
  unitPrice: string;
  costPrice?: string | null;
  packSize?: string | null;
  currency: string;
  active: boolean;
  specimenType?: string | null;
  modality?: string | null;
  genericName?: string | null;
  medicationConceptId?: string | null;
  therapeuticClass?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  unitOfMeasure?: string | null;
  reorderLevel?: string | null;
  prescribingDefaults?: PrescribingDefaults | null;
  updatedAt?: string;
  currentPriceEffectiveFrom?: string | null;
  upcomingPrice?: {
    id: string;
    unitPrice: string;
    costPrice?: string | null;
    effectiveFrom: string;
  } | null;
};
const labels: Record<Category, string> = {
  LABORATORY_TEST: "Laboratory tests",
  PROCEDURE: "Consultations, procedures & imaging",
  PHARMACEUTICAL: "Pharmaceuticals",
  NON_PHARMACEUTICAL: "Non-pharmaceuticals",
};

async function request(url: string, options?: RequestInit) {
  return jsonRequest<{ items: Item[] }>(url, options, "The catalogue could not be updated");
}

export default function CatalogManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [category, setCategory] = useState<Category>("LABORATORY_TEST");
  const [editing, setEditing] = useState<Item | null>(null);
  const [referenceId, setReferenceId] = useState("");
  const reference = kenyaMedicineReferences.find(item => item.id === referenceId);
  const referenceDraft = !editing && reference ? kenyaReferenceDraft(reference) : null;
  const defaults = editing || referenceDraft;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    setItems((await request("/api/catalog")).items);
  }
  useEffect(() => {
    load().catch((error) => setError(error.message));
  }, []);
  const categoryItems = useMemo(() => items.filter((item) => item.category === category), [items, category]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return categoryItems.filter(item => !term || `${item.code} ${item.name} ${item.genericName || ""} ${item.strength || ""} ${item.description || ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [categoryItems, query]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries()) as Record<string, unknown>;
    body.category = category;
    if (editing) body.expectedUpdatedAt = editing.updatedAt;
    if (category === "PHARMACEUTICAL") {
      const fields = ["defaultRoute", "defaultFrequency", "defaultDuration", "doseUnit", "doseUnitsPerIssueUnit"];
      const any = fields.some(key => String(form.get(key) || "").trim());
      body.prescribingDefaults = any ? {
        route: String(form.get("defaultRoute") || ""),
        frequencyPerDay: Number(form.get("defaultFrequency")),
        durationDays: Number(form.get("defaultDuration")),
        doseUnit: String(form.get("doseUnit") || ""),
        doseUnitsPerIssueUnit: Number(form.get("doseUnitsPerIssueUnit")),
        wholeIssueUnits: form.get("wholeIssueUnits") === "on",
      } : null;
      for (const key of [...fields, "wholeIssueUnits"]) delete body[key];
    }
    body.active = form.get("active") === "on";
    if (!body.reorderLevel) delete body.reorderLevel;
    if (!body.costPrice) delete body.costPrice;
    if (!body.packSize) delete body.packSize;
    if (!body.priceChangeReason) delete body.priceChangeReason;
    try {
      await request("/api/catalog", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ ...body, id: editing?.id }),
      });
      const scheduled = editing && String(body.priceEffectiveFrom) > nairobiDateInputValue();
      setNotice(scheduled ? "Future price scheduled. Today's billing price is unchanged." : editing ? "Catalogue item updated." : "Catalogue item added.");
      setEditing(null);
      setReferenceId("");
      formElement.reset();
      await load();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function toggle(item: Item) {
    setError("");
    try {
      await request("/api/catalog", {
        method: "PATCH",
        body: JSON.stringify({
          ...item,
          expectedUpdatedAt: item.updatedAt,
          unitPrice: Number(item.unitPrice),
          costPrice: item.costPrice ? Number(item.costPrice) : undefined,
          packSize: item.packSize ? Number(item.packSize) : undefined,
          reorderLevel: item.reorderLevel
            ? Number(item.reorderLevel)
            : undefined,
          active: !item.active,
        }),
      });
      await load();
      setNotice(`${item.name} ${item.active ? "deactivated" : "reactivated"}.`);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Services & commodities catalogue</h1>
          <p>
            Maintain orderable tests and procedures, medicines, supplies, and
            their current billing prices.
          </p>
        </div>
      </header>
      <div className="catalogTabs">
        {(Object.keys(labels) as Category[]).map((value) => (
          <button
            key={value}
            className={category === value ? "active" : ""}
            onClick={() => {
              setCategory(value);
              setReferenceId("");
              setEditing(null);
            }}
          >
            {labels[value]}{" "}
            <b>{items.filter((item) => item.category === value).length}</b>
          </button>
        ))}
      </div>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      <section className="catalogLayout">
        <details className="card managementPanel" open={Boolean(editing || referenceId)}><summary><span><strong>{editing ? "Edit catalogue item" : "Add catalogue item"}</strong><small>Open only when you need to maintain services or pricing</small></span><b>Open</b></summary><form
          className="dataForm catalogForm managementBody"
          key={editing?.id || referenceId || category}
          onSubmit={submit}
        >
          <div className="wide">
            <h2>
              {editing
                ? "Edit item"
                : `Add ${labels[category].toLowerCase().replace(/s$/, "")}`}
            </h2>
            <p>
              Codes are permanent operational identifiers. Deactivate an old
              item instead of reusing its code.
            </p>
          </div>
          {category === "PHARMACEUTICAL" && !editing && <div className="wide kenyaMedicineReference">
            <h3>Kenya medicine naming reference</h3>
            <p>14 selected KEML 2023 formulations. Start an inactive catalogue entry, then verify the product and local formulary before activation.</p>
            <SearchablePicker value={referenceId} onChange={setReferenceId} placeholder="Search Kenya medicine references…" options={kenyaMedicineReferences.map(item=>({value:item.id,label:[item.genericName,item.strength,item.dosageForm].join(" · "),detail:"KEML "+item.section+" · Level of use "+item.level}))}/>
            {reference && <p>Printed page {reference.page}, section {reference.section}, level of use {reference.level}. {reference.note}</p>}
            <p><a href={KEML_SOURCE} target="_blank" rel="noreferrer">Kenya Essential Medicines List</a> · <a href="https://products.pharmacyboardkenya.org/" target="_blank" rel="noreferrer">PPB product verification</a> · <a href="https://web.pharmacyboardkenya.org/rapid-alerts/" target="_blank" rel="noreferrer">Current PPB alerts</a></p>
            <small>This reference does not authorize a brand, dose or therapeutic substitution. Confirm release type, product registration, dispensing unit, price and facility scope.</small>
          </div>}
          <label>
            Code *
            <input
              name="code"
              required
              defaultValue={defaults?.code}
              placeholder="Unique code"
            />
          </label>
          <label>
            Name *<input name="name" required defaultValue={defaults?.name} />
          </label>
          <label>
            Price (KES) *
            <input
              name="unitPrice"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={editing?.unitPrice || "0.00"}
            />
          </label>
          <label>
            Price effective from *
            <input name="priceEffectiveFrom" type="date" required defaultValue={nairobiDateInputValue()} />
            <small>{editing ? "Choose a future date to schedule without changing today's charges." : "The initial price starts on this date."}</small>
          </label>
          {editing && <label className="wide">
            Reason for price change
            <input name="priceChangeReason" minLength={5} maxLength={300} placeholder="Required only when the selling or cost price changes" />
          </label>}
          {["PROCEDURE", "PHARMACEUTICAL"].includes(category) && <label>Cost price (KES)<input name="costPrice" type="number" min="0" step="0.01" defaultValue={editing?.costPrice || ""}/></label>}
          {["PHARMACEUTICAL", "NON_PHARMACEUTICAL"].includes(category) && <label>Pack size<input name="packSize" type="number" min="0.001" step="0.001" defaultValue={editing?.packSize || ""}/></label>}
          {category === "LABORATORY_TEST" && (
            <label>
              Specimen type *
              <input
                name="specimenType"
                required
                defaultValue={editing?.specimenType || ""}
                placeholder="Blood, urine, stool…"
              />
            </label>
          )}
          {category === "PROCEDURE" && (
            <label>
              Modality / department
              <input
                name="modality"
                defaultValue={editing?.modality || ""}
                placeholder="X-ray, ultrasound, theatre…"
              />
            </label>
          )}
          {category === "PHARMACEUTICAL" && (
            <>
              <label>
                Generic name *
                <input
                  name="genericName"
                  required
                  defaultValue={defaults?.genericName || ""}
                />
              </label>
              <label>
                Strength *
                <input
                  name="strength"
                  required
                  defaultValue={defaults?.strength || ""}
                  placeholder="500 mg"
                />
              </label>
              <label>
                Dosage form *
                <input
                  name="dosageForm"
                  required
                  defaultValue={defaults?.dosageForm || ""}
                  placeholder="Tablet, suspension…"
                />
              </label>
              <label>
                Medication concept ID
                <input name="medicationConceptId" defaultValue={editing?.medicationConceptId || ""} placeholder="Generated from generic name if blank" />
              </label>
              <label>
                Therapeutic class
                <input name="therapeuticClass" defaultValue={editing?.therapeuticClass || ""} placeholder="e.g. NSAID, PPI, antihistamine" />
              </label>
            </>
          )}
          {["PHARMACEUTICAL", "NON_PHARMACEUTICAL"].includes(category) && (
            <>
              <label>
                Issue unit *
                <input
                  name="unitOfMeasure"
                  required
                  defaultValue={editing?.unitOfMeasure || ""}
                  placeholder="tablet, bottle, pair…"
                />
              </label>
              <label>
                Reorder level
                <input
                  name="reorderLevel"
                  type="number"
                  min="0"
                  step="0.001"
                  defaultValue={editing?.reorderLevel || ""}
                />
              </label>
            </>
          )}
          {category === "PHARMACEUTICAL" && <fieldset className="wide rxEntryGroup">
            <legend>Facility prescribing defaults</legend>
            <p className="wide">Optional configuration. Complete all fields to enable automatic entry and supply calculation. Leave all blank to remove defaults.</p>
            <label>Default route<input name="defaultRoute" maxLength={50} defaultValue={editing?.prescribingDefaults?.route || ""} /></label>
            <label>Times daily<input name="defaultFrequency" type="number" min="1" max="24" defaultValue={editing?.prescribingDefaults?.frequencyPerDay || ""} /></label>
            <label>Duration in days<input name="defaultDuration" type="number" min="1" max="3650" defaultValue={editing?.prescribingDefaults?.durationDays || ""} /></label>
            <label>Dose unit<input name="doseUnit" maxLength={40} placeholder="tablet, mL…" defaultValue={editing?.prescribingDefaults?.doseUnit || ""} /></label>
            <label>Dose units per issue unit<input name="doseUnitsPerIssueUnit" type="number" min="0.001" step="0.001" max="1000000" defaultValue={editing?.prescribingDefaults?.doseUnitsPerIssueUnit || ""} /><small>For example, the number of mL in one bottle. Use 1 when dose and issue units match.</small></label>
            <label><input name="wholeIssueUnits" type="checkbox" defaultChecked={editing?.prescribingDefaults?.wholeIssueUnits || false} />Round supply up to whole issue units (bottles/packs)</label>
          </fieldset>}
          <label className="wide">
            Description
            <textarea
              name="description"
              rows={3}
              defaultValue={defaults?.description || ""}
            />
          </label>
          <label className="checkItem wide">
            <input
              type="checkbox"
              name="active"
              defaultChecked={defaults?.active ?? true}
            />
            <span>Active and available for ordering</span>
          </label>
          <div className="wide submitBar">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Clear
            </button>
            <button className="primary">
              {editing ? "Save changes" : "Add to catalogue"}
            </button>
          </div>
        </form></details>
        <section className="card catalogList">
          <div className="cardHead">
            <div>
              <h2>{labels[category]}</h2>
              <p>
                {categoryItems.filter((item) => item.active).length} active ·{" "}
                {categoryItems.length} total
              </p>
            </div>
          </div>
          <label className="listSearch">Search this catalogue<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Code, name, generic, strength or description" /></label>
          <p className="listCount">Showing {visible.length} of {categoryItems.length} items</p>
          {visible.length === 0 ? (
            <div className="empty">
              <strong>No items in this category</strong>
              <p>Add the first item using the form.</p>
            </div>
          ) : (
            visible.map((item) => (
              <article className={!item.active ? "inactive" : ""} key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.code} · KES{" "}
                    {Number(item.unitPrice).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                    {item.unitOfMeasure ? ` / ${item.unitOfMeasure}` : ""}
                    {item.costPrice ? ` · cost KES ${Number(item.costPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}
                    {item.packSize ? ` · pack ${Number(item.packSize)}` : ""}
                  </span>
                  <small>{item.currentPriceEffectiveFrom ? `Current since ${new Date(item.currentPriceEffectiveFrom).toLocaleDateString()}` : "Legacy current price"}{item.upcomingPrice ? ` · Next KES ${Number(item.upcomingPrice.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })} from ${new Date(item.upcomingPrice.effectiveFrom).toLocaleDateString()}` : ""}</small>
                </div>
                <b>{item.active ? "ACTIVE" : "INACTIVE"}</b>
                <button onClick={() => setEditing(item)}>Edit</button>
                <button onClick={() => toggle(item)}>
                  {item.active ? "Deactivate" : "Reactivate"}
                </button>
              </article>
            ))
          )}
        </section>
      </section>
    </>
  );
}
