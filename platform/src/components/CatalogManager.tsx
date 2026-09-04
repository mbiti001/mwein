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
  async function load() {
    setItems((await request("/api/catalog")).items);
  }
  useEffect(() => {
    load().catch((error) => setError(error.message));
  }, []);
  const visible = useMemo(
    () => items.filter((item) => item.category === category),
    [items, category],
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries()) as Record<string, unknown>;
    body.category = category;
    body.active = form.get("active") === "on";
    if (!body.reorderLevel) delete body.reorderLevel;
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
        <form
          className="card dataForm catalogForm"
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
        </form>
        <section className="card catalogList">
          <div className="cardHead">
            <div>
              <h2>{labels[category]}</h2>
              <p>
                {visible.filter((item) => item.active).length} active ·{" "}
                {visible.length} total
              </p>
            </div>
          </div>
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
