"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PickerOption = { value: string; label: string; detail?: string };

export function SearchablePicker({
  name,
  options,
  value,
  onChange,
  placeholder = "Search and select…",
  required = false,
}: {
  name?: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 8);
    return options
      .filter((option) =>
        `${option.label} ${option.detail || ""}`.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [options, query]);
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Select an item from the search results" : "");
  }, [required, value]);
  return (
    <div className="searchablePicker">
      {name && (
        <input type="hidden" name={name} value={value} required={required} />
      )}
      <input
        ref={inputRef}
        required={required}
        value={open ? query : selected?.label || ""}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-expanded={open}
      />
      {open && (
        <div className="pickerResults" role="listbox">
          {matches.length ? (
            matches.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <strong>{option.label}</strong>
                {option.detail && <small>{option.detail}</small>}
              </button>
            ))
          ) : (
            <span>No matching item</span>
          )}
        </div>
      )}
    </div>
  );
}

export function SearchableMultiPicker({
  name,
  options,
  label,
}: {
  name: string;
  options: PickerOption[];
  label: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return options
      .filter(
        (option) =>
          !selected.includes(option.value) &&
          `${option.label} ${option.detail || ""}`.toLowerCase().includes(term),
      )
      .slice(0, 10);
  }, [options, query, selected]);
  return (
    <div className="orderGroup searchableMulti">
      <strong>{label}</strong>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${label.toLowerCase()}…`}
        autoComplete="off"
      />
      {query && (
        <div className="pickerResults" role="listbox">
          {matches.length ? (
            matches.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  setSelected((current) => [...current, option.value]);
                  setQuery("");
                }}
              >
                <strong>{option.label}</strong>
                {option.detail && <small>{option.detail}</small>}
              </button>
            ))
          ) : (
            <span>No matching item</span>
          )}
        </div>
      )}
      <div className="pickerChips">
        {selected.map((value) => {
          const option = options.find((item) => item.value === value)!;
          return (
            <span key={value}>
              {option.label}
              <button
                type="button"
                aria-label={`Remove ${option.label}`}
                onClick={() =>
                  setSelected((current) =>
                    current.filter((item) => item !== value),
                  )
                }
              >
                ×
              </button>
              <input type="hidden" name={name} value={value} />
            </span>
          );
        })}
      </div>
      {!selected.length && <small>No items selected</small>}
    </div>
  );
}

export function FormSearchablePicker({
  name,
  options,
  placeholder,
  required = false,
}: {
  name: string;
  options: PickerOption[];
  placeholder?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = host.current?.closest("form");
    const reset = () => setValue("");
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  return (
    <div ref={host}>
      <SearchablePicker name={name} options={options} value={value} onChange={setValue} placeholder={placeholder} required={required}/>
    </div>
  );
}
