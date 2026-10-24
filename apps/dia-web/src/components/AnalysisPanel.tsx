/** Analysis on demand (FR-25): a button for a deep analysis and a question box. Works without a model (rules-based). */
import { useState } from "react";
import { api, type Analysis, type AnalyseRequest } from "../api";
import { ErrorText, useLoad } from "./ui";

export function AnalysisPanel({ request, title = "Analysis" }: { request: AnalyseRequest | null; title?: string }) {
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
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>{title}</h3>
        <span className={`badge ${aiOn ? "info" : ""}`} title={status.data?.reason ?? ""}>
          {aiOn ? `AI model: ${status.data?.model}` : "Rules-based · no AI model"}
        </span>
      </div>
      <div className="row">
        <button className="primary" disabled={busy || !request} onClick={() => run()}>{busy ? "Analysing…" : "Analyse"}</button>
        <label style={{ flex: 1, minWidth: 220 }}>Ask a question{aiOn ? "" : " (needs the AI model)"}
          <input value={question} disabled={!aiOn} placeholder="e.g. Why is Pune short on atta?" onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim()) run(question.trim()); }} />
        </label>
        <button className="secondary" disabled={busy || !aiOn || !question.trim() || !request} onClick={() => run(question.trim())}>Ask</button>
      </div>
      <ErrorText error={error} />
      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span className={`badge ${result.source === "ai" ? "info" : ""}`}>{result.source === "ai" ? `AI · ${result.model}` : "Rules-based"}</span>
            {result.source === "ai" && result.verified && <span className="badge ok">Every figure matches the data</span>}
            {result.source === "ai" && !result.verified && <span className="badge warn">Unverified figures: {result.unverified_numbers.join(", ")}</span>}
          </div>
          <div className="analysis-text">{result.text}</div>
          {result.note && <p className="note" style={{ marginTop: 8 }}>{result.note}</p>}
          <p className="note" style={{ marginTop: 8 }}>This explains numbers the optimiser already produced. It never sets a quantity.</p>
        </div>
      )}
    </div>
  );
}
