/** Analysis on demand (FR-25): a button for a deep analysis and a question box. Works without a model (rules-based). */
import { useState } from "react";
import { api, type Analysis, type AnalyseRequest } from "../api";
import { ErrorText, useLoad } from "./ui";

export function AnalysisPanel({ request, title = "Deep analysis" }: { request: AnalyseRequest | null; title?: string }) {
  const status = useLoad(api.aiStatus, []);
  const [result, setResult] = useState<Analysis | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const aiOn = status.data?.enabled ?? false;

  async function run(q?: string) {
    if (!request) return;
    setBusy(true); setError(undefined);
    try { setResult(await api.analyse({ ...request, question: q || undefined })); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ margin: "12px 0" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{title}</b>
        <span className="badge" title={status.data?.reason ?? ""}>
          {aiOn ? `AI: ${status.data?.model}` : "AI model off · rules-based analysis"}
        </span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy || !request} onClick={() => run()}>{busy ? "Analysing…" : "Analyse"}</button>
        <label style={{ flex: 1, minWidth: 220 }}>Ask a question{aiOn ? "" : " (needs the AI model)"}
          <input value={question} disabled={!aiOn} placeholder="e.g. Why is Pune short on atta?" onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim()) run(question.trim()); }} />
        </label>
        <button className="secondary" disabled={busy || !aiOn || !question.trim() || !request} onClick={() => run(question.trim())}>Ask</button>
      </div>
      <ErrorText error={error} />
      {result && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="badge" style={result.source === "ai" ? { background: "var(--primary)", color: "#fff" } : undefined}>
              {result.source === "ai" ? `AI · ${result.model}` : "Rules-based"}
            </span>
            {result.source === "ai" && result.verified && <span className="badge" style={{ background: "var(--success)", color: "#fff" }}>every figure matches the data</span>}
            {result.source === "ai" && !result.verified && <span className="badge" style={{ background: "var(--warning)", color: "#000" }}>unverified figures: {result.unverified_numbers.join(", ")}</span>}
          </div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{result.text}</div>
          {result.note && <p style={{ color: "var(--neutral)", fontSize: 13 }}>{result.note}</p>}
          <p style={{ color: "var(--neutral)", fontSize: 12, marginBottom: 0 }}>The analysis explains numbers the optimiser already produced; it never sets a quantity.</p>
        </div>
      )}
    </div>
  );
}
