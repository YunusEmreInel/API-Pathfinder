"use client";
import { useCallback, useEffect, useState } from "react";
import type { StoredOperation } from "@/lib/db";
import type { TryOutcome } from "@/lib/try-request";
import { postJson } from "@/lib/client";
import { OperationDoc, TryPanel } from "@/components/TryPanel";
import { InvestigatePanel } from "@/components/InvestigatePanel";

interface DocRow { id: number; title: string; version: string; server_url: string; operation_count: number; embedded_count: number }
interface ImportResult { documentId: number; title: string; operationCount: number; embedded: number; skipped: { method: string; path: string; reason: string }[]; warnings: string[] }

export default function Home() {
  const [docText, setDocText] = useState("");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [importInfo, setImportInfo] = useState<ImportResult | null>(null);
  const [ops, setOps] = useState<StoredOperation[]>([]);
  const [selected, setSelected] = useState<{ operationId: string; params: Record<string, string>; nonce: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setDocs(data);
  }, []);

  const refreshOps = useCallback(async (id: number) => {
    const d = await fetch(`/api/operations?documentId=${id}`).then((r) => r.json());
    if (Array.isArray(d)) setOps(d);
    else setError(d.error);
  }, []);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);
  useEffect(() => {
    setSelected(null);
    if (documentId) refreshOps(documentId);
  }, [documentId, refreshOps]);

  async function loadDemo() {
    const res = await fetch("/api/demo-spec");
    setDocText(JSON.stringify(await res.json(), null, 2));
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 1_000_000) { setError("Dosya 1 MB'tan büyük."); return; }
    setDocText(await file.text()); // parsed and validated on the server by /api/import
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

  async function doEmbed() {
    if (!documentId) return;
    setError(""); setBusy(true);
    try {
      const r = await postJson<{ embedded: number; warning?: string }>("/api/embed", { documentId });
      if (r.warning) setError(r.warning);
      await Promise.all([refreshDocs(), refreshOps(documentId)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const choose = (operationId: string, params: Record<string, string> = {}) => setSelected({ operationId, params, nonce: Date.now() });
  const current = ops.find((o) => o.op.operationId === selected?.operationId);
  const missingEmbeddings = ops.filter((o) => !o.embedded).length;

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
              <label className="secondary-btn">
                JSON dosyası seç
                <input type="file" accept=".json,application/json" hidden
                  onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <button onClick={doImport} disabled={!docText.trim() || busy}>{busy ? "Çalışıyor…" : "İçe aktar"}</button>
            </div>
            {importInfo && (
              <div className="small" style={{ marginTop: 8 }}>
                #{importInfo.documentId} “{importInfo.title}”: {importInfo.operationCount} GET işlemi kaydedildi, {importInfo.embedded} embedding üretildi.
                {importInfo.skipped.map((s) => <div key={s.method + s.path} className="muted">Atlandı: {s.method} {s.path} — {s.reason}</div>)}
                {importInfo.warnings.map((w) => <div key={w} className="error">{w}</div>)}
              </div>
            )}
            {docs.length > 0 && (
              <div className="row" style={{ marginTop: 10 }}>
                <label className="small muted">Doküman:</label>
                <select className="grow" value={documentId ?? ""} onChange={(e) => setDocumentId(Number(e.target.value) || null)}>
                  <option value="">(seç)</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.title} {d.version} — {d.operation_count} işlem, {d.embedded_count} embedding</option>)}
                </select>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </section>

          {documentId && (
            <InvestigatePanel documentId={documentId} onUse={choose}>
              {missingEmbeddings > 0 && <button className="secondary" disabled={busy} onClick={doEmbed}>Eksik {missingEmbeddings} embedding&apos;i üret</button>}
            </InvestigatePanel>
          )}
        </div>

        <div>
          {documentId && (
            <section className="panel">
              <h2>Dokümandaki GET işlemleri</h2>
              <ul className="ops">
                {ops.map((s) => (
                  <li key={s.pk} className={s.op.operationId === selected?.operationId ? "sel" : ""} onClick={() => choose(s.op.operationId)}>
                    <span className="method">GET</span><code>{s.op.path}</code> <span className="small muted">{s.op.summary}</span>
                    {s.op.blockers.length > 0 && <span className="badge warn">çalıştırılamaz</span>}
                    {!s.embedded && <span className="badge">embedding yok</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {current && documentId && selected && (
            <section className="panel">
              <h2>İncele ve dene</h2>
              <OperationDoc op={current.op} />
              <details className="small"><summary>Embedding için saklanan metin</summary><pre>{current.embedText}</pre></details>
              <TryPanel key={`${current.pk}-${selected.nonce}`} op={current.op} initialParams={selected.params} send={(parameters) =>
                postJson<TryOutcome>("/api/try", { documentId, operationId: current.op.operationId, parameters }).catch((e: Error) => ({ error: e.message }))} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
