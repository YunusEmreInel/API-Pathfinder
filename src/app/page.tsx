"use client";
import { useCallback, useEffect, useState } from "react";
import type { StoredOperation } from "@/lib/db";
import type { TryOutcome } from "@/lib/try-request";
import { OperationDoc, TryPanel } from "@/components/TryPanel";

interface DocRow { id: number; title: string; version: string; server_url: string; operation_count: number; embedded_count: number }
interface ImportResult { documentId: number; title: string; operationCount: number; skipped: { method: string; path: string; reason: string }[]; warnings: string[] }

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export default function Home() {
  const [docText, setDocText] = useState("");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [importInfo, setImportInfo] = useState<ImportResult | null>(null);
  const [ops, setOps] = useState<StoredOperation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setDocs(data);
  }, []);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  useEffect(() => {
    if (!documentId) return;
    setSelected(null);
    fetch(`/api/operations?documentId=${documentId}`).then((r) => r.json()).then((d) => (Array.isArray(d) ? setOps(d) : setError(d.error)));
  }, [documentId]);

  async function loadDemo() {
    const res = await fetch("/api/demo-spec");
    setDocText(JSON.stringify(await res.json(), null, 2));
  }

  async function doImport() {
    setError(""); setBusy(true); setImportInfo(null);
    try {
      const r = await postJson<ImportResult>("/api/import", { document: docText });
      setImportInfo(r);
      await refreshDocs();
      setDocumentId(r.documentId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = ops.find((o) => o.op.operationId === selected);

  return (
    <main>
      <h1>API Pathfinder</h1>
      <p className="sub">OpenAPI dokümanındaki GET işlemlerini bul, incele ve güvenli biçimde dene.</p>
      <div className="grid">
        <div>
          <section className="panel">
            <h2>1. OpenAPI JSON içe aktar</h2>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} placeholder="OpenAPI 3.x JSON yapıştır" />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="secondary" onClick={loadDemo}>Demo dokümanı yükle</button>
              <button onClick={doImport} disabled={!docText.trim() || busy}>{busy ? "İçe aktarılıyor…" : "İçe aktar"}</button>
            </div>
            {importInfo && (
              <div className="small" style={{ marginTop: 8 }}>
                #{importInfo.documentId} “{importInfo.title}”: {importInfo.operationCount} GET işlemi kaydedildi.
                {importInfo.skipped.map((s) => <div key={s.method + s.path} className="muted">Atlandı: {s.method} {s.path} — {s.reason}</div>)}
                {importInfo.warnings.map((w) => <div key={w} className="error">{w}</div>)}
              </div>
            )}
            {error && <p className="error">{error}</p>}
            {docs.length > 0 && (
              <div className="row" style={{ marginTop: 10 }}>
                <label className="small muted">Doküman:</label>
                <select className="grow" value={documentId ?? ""} onChange={(e) => setDocumentId(Number(e.target.value) || null)}>
                  <option value="">(seç)</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.title} {d.version} — {d.operation_count} işlem, {d.embedded_count} embedding</option>)}
                </select>
              </div>
            )}
          </section>
          {documentId && (
            <section className="panel">
              <h2>2. Kayıtlı GET işlemleri</h2>
              <ul className="ops">
                {ops.map((s) => (
                  <li key={s.pk} className={s.op.operationId === selected ? "sel" : ""} onClick={() => setSelected(s.op.operationId)}>
                    <span className="method">GET</span><code>{s.op.path}</code>
                    {s.op.blockers.length > 0 && <span className="badge warn">çalıştırılamaz</span>}
                    <span className="badge">{s.embedded ? "embedding var" : "embedding yok"}</span>
                    <div className="small muted">{s.op.summary}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div>
          {current && documentId && (
            <section className="panel">
              <h2>3. İncele ve dene</h2>
              <OperationDoc op={current.op} />
              <details className="small"><summary>Embedding için saklanan metin</summary><pre>{current.embedText}</pre></details>
              <TryPanel key={current.pk} op={current.op} send={(parameters) =>
                postJson<TryOutcome>("/api/try", { documentId, operationId: current.op.operationId, parameters }).catch((e: Error) => ({ error: e.message }))} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
