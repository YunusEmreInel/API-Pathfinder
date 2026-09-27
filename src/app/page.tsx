"use client";
import { useState } from "react";
import type { ParsedDocument } from "@/lib/openapi";
import { OperationDoc, TryPanel } from "@/components/TryPanel";

export default function Home() {
  const [docText, setDocText] = useState("");
  const [parsed, setParsed] = useState<ParsedDocument | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadDemo() {
    const res = await fetch("/api/demo-spec");
    setDocText(JSON.stringify(await res.json(), null, 2));
  }

  async function parse() {
    setError(""); setParsed(null); setSelected(null);
    const res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: docText }) });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else setParsed(data);
  }

  const op = parsed?.operations.find((o) => o.operationId === selected);

  return (
    <main>
      <h1>API Pathfinder</h1>
      <p className="sub">OpenAPI dokümanındaki GET işlemlerini bul, incele ve güvenli biçimde dene.</p>
      <div className="grid">
        <div>
          <section className="panel">
            <h2>1. OpenAPI JSON</h2>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} placeholder="OpenAPI 3.x JSON yapıştır" />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="secondary" onClick={loadDemo}>Demo dokümanı yükle</button>
              <button onClick={parse} disabled={!docText.trim()}>Ayrıştır</button>
            </div>
            {error && <p className="error">{error}</p>}
          </section>
          {parsed && (
            <section className="panel">
              <h2>2. GET işlemleri — {parsed.title} {parsed.version}</h2>
              <div className="small muted">Sunucu: <code>{parsed.serverUrl || "(yok)"}</code></div>
              <ul className="ops" style={{ marginTop: 8 }}>
                {parsed.operations.map((o) => (
                  <li key={o.operationId} className={o.operationId === selected ? "sel" : ""} onClick={() => setSelected(o.operationId)}>
                    <span className="method">GET</span><code>{o.path}</code>
                    {o.blockers.length > 0 && <span className="badge warn">çalıştırılamaz</span>}
                    <div className="small muted">{o.summary}</div>
                  </li>
                ))}
              </ul>
              {parsed.skipped.map((s) => <div key={s.method + s.path} className="small muted">Atlandı: {s.method} {s.path} — {s.reason}</div>)}
              {parsed.warnings.map((w) => <div key={w} className="small error">{w}</div>)}
            </section>
          )}
        </div>
        <div>
          {op && (
            <section className="panel">
              <h2>3. İncele ve dene</h2>
              <OperationDoc op={op} />
              <TryPanel key={op.operationId} op={op} send={async (parameters) => {
                const res = await fetch("/api/try", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: docText, operationId: op.operationId, parameters }) });
                return res.json();
              }} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
