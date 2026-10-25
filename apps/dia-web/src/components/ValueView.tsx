/** Readable view of an assumption value: a short summary in the table, the full value as tables in a modal. */
import type { AssumptionRow } from "@dia/types";
import { useEffect, useRef, useState } from "react";

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: Json) => v === null || typeof v !== "object";
const label = (k: string) => k.replace(/_/g, " ");

/** One value on one line: numbers in Indian grouping, short arrays joined, small objects as "key: value". */
function inline(v: Json): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.every(isScalar) ? v.map(inline).join(", ") : v.map((x) => (Array.isArray(x) ? `[${inline(x)}]` : inline(x))).join("; ");
  return Object.entries(v as Record<string, Json>).map(([k, x]) => `${label(k)}: ${inline(x)}`).join(" · ");
}

/** What the table cell shows. Complex values get a count and open the modal. */
export function summary(v: Json): { text: string; complex: boolean } {
  if (isScalar(v)) return { text: inline(v), complex: false };
  if (Array.isArray(v)) {
    if (v.every(isScalar) && v.length <= 8) return { text: inline(v), complex: false };
    return { text: `${v.length} ${v.every(isObj) ? "rows" : "values"}`, complex: true };
  }
  const entries = Object.entries(v as Record<string, Json>);
  if (entries.length <= 3 && entries.every(([, x]) => isScalar(x))) return { text: inline(v), complex: false };
  return { text: `${entries.length} fields`, complex: true };
}

function Table({ cols, rows }: { cols: string[]; rows: Json[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{label(c)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((x, j) => <td key={j} className={typeof x === "number" ? "num" : ""}>{inline(x)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The full value laid out as a table that fits its shape. */
function Readable({ value }: { value: Json }) {
  if (isScalar(value)) return <p className="modal-big">{inline(value)}</p>;
  if (Array.isArray(value)) {
    if (value.every(isObj)) {
      const cols = [...new Set(value.flatMap((o) => Object.keys(o as Record<string, Json>)))];
      return <Table cols={cols} rows={value.map((o) => cols.map((c) => (o as Record<string, Json>)[c]))} />;
    }
    if (value.every(Array.isArray)) return <Table cols={value[0] && (value[0] as Json[]).map((_, i) => `#${i + 1}`) || []} rows={value as Json[][]} />;
    return <div className="value-list">{value.map((x, i) => <span key={i} className="badge">{inline(x)}</span>)}</div>;
  }
  const entries = Object.entries(value as Record<string, Json>);
  // A map of objects with the same kind of fields (e.g. categories): one row per key.
  if (entries.length > 1 && entries.every(([, x]) => isObj(x))) {
    const cols = [...new Set(entries.flatMap(([, x]) => Object.keys(x as Record<string, Json>)))];
    return <Table cols={["name", ...cols]} rows={entries.map(([k, x]) => [k, ...cols.map((c) => (x as Record<string, Json>)[c])])} />;
  }
  return <Table cols={["field", "value"]} rows={entries.map(([k, x]) => [label(k), x])} />;
}

export function ValueCell({ row }: { row: AssumptionRow }) {
  const s = summary(row.value);
  const [open, setOpen] = useState(false);
  if (!s.complex) return <span className="mono">{s.text}</span>;
  return (
    <>
      <button className="link-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">{s.text} · View</button>
      {open && <ValueModal row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

function ValueModal({ row, onClose }: { row: AssumptionRow; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="modal-head">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Assumption{row.unit ? ` · ${row.unit}` : ""}</div>
          <h3 className="mono" style={{ fontSize: 15 }}>{row.parameter}</h3>
        </div>
        <span className="spacer" />
        <button onClick={() => ref.current?.close()} aria-label="Close">Close</button>
      </div>
      <div className="modal-body">
        {(row.source || row.rationale) && (
          <p className="muted" style={{ marginBottom: 12 }}>
            {row.source && <><b style={{ color: "var(--text)" }}>Source:</b> {row.source}. </>}
            {row.rationale}
          </p>
        )}
        <Readable value={row.value} />
      </div>
    </dialog>
  );
}
