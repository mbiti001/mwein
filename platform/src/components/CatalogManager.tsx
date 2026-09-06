"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

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
};
const labels: Record<Category, string> = {
  LABORATORY_TEST: "Laboratory tests",
  PROCEDURE: "Procedures & imaging",
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
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries()) as Record<string, unknown>;
    body.category = category;
    body.active = form.get("active") === "on";
    if (!body.reorderLevel) delete body.reorderLevel;
    if (!body.costPrice) delete body.costPrice;
    if (!body.packSize) delete body.packSize;
    try {
      await request("/api/catalog", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ ...body, id: editing?.id }),
      });
      setNotice(editing ? "Catalogue item updated." : "Catalogue item added.");
      setEditing(null);
      event.currentTarget.reset();
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
              setEditing(null);
            }}
          >
            {labels[value]}{" "}
            <b>{items.filter((item) => item.category === value).length}</b>
          </button>
        ))}
      </div>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      <section className="catalogLayout">
        <details className="card managementPanel" open={Boolean(editing)}><summary><span><strong>{editing ? "Edit catalogue item" : "Add catalogue item"}</strong><small>Open only when you need to maintain services or pricing</small></span><b>Open</b></summary><form
          className="dataForm catalogForm managementBody"
          key={editing?.id || category}
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
          <label>
            Code *
            <input
              name="code"
              required
              defaultValue={editing?.code}
              placeholder="Unique code"
            />
          </label>
          <label>
            Name *<input name="name" required defaultValue={editing?.name} />
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
                  defaultValue={editing?.genericName || ""}
                />
              </label>
              <label>
                Strength *
                <input
                  name="strength"
                  required
                  defaultValue={editing?.strength || ""}
                  placeholder="500 mg"
                />
              </label>
              <label>
                Dosage form *
                <input
                  name="dosageForm"
                  required
                  defaultValue={editing?.dosageForm || ""}
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
          <label className="wide">
            Description
            <textarea
              name="description"
              rows={3}
              defaultValue={editing?.description || ""}
            />
          </label>
          <label className="checkItem wide">
            <input
              type="checkbox"
              name="active"
              defaultChecked={editing?.active ?? true}
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
