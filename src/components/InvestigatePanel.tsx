"use client";
import { useState } from "react";
import type { RagResult } from "@/lib/rag";
import type { Proposal } from "@/lib/proposal";
import { postJson } from "@/lib/client";

export interface RawHit { operationId: string; path: string; summary: string; distance: number; similarity: number; embedText: string; executable: boolean }


export function ProposalBox({ proposal, onUse }: { proposal: Proposal; onUse: (operationId: string, params: Record<string, string>) => void }) {
  if (proposal.status === "no_match" || proposal.status === "invalid_suggestion") {
    return (
      <div className="box warn">
        <div className="label">Kod doğrulaması: uygun işlem yok</div>
        {proposal.note} Pathfinder endpoint uydurmaz; istek önerilmedi.
      </div>
    );
  }
  const label = { ready: "hazır — gönderilmedi", needs_input: "eksik girdi", not_executable: "çalıştırılamaz" }[proposal.status];
  return (
    <div className={`box ${proposal.status === "ready" ? "doc" : "warn"}`}>
      <div className="label">Kod doğrulaması (dokümana göre): {label}</div>
      <div>İşlem: <code>{proposal.operationId}</code> · Parametreler: <code>{JSON.stringify(proposal.parameters)}</code></div>
      {proposal.previewUrl && <div>Gönderilecek URL: <code>{proposal.previewUrl}</code></div>}
      {proposal.missing.length > 0 && <div>Eksik zorunlu parametre: <code>{proposal.missing.join(", ")}</code> — aşağıdaki formda gir.</div>}
      {proposal.errors.map((e) => <div key={e} className="small">{e}</div>)}
      {proposal.status !== "not_executable" && (
        <button style={{ marginTop: 6 }} onClick={() => onUse(proposal.operationId, proposal.parameters)}>Bu işlemi incele ve dene →</button>
      )}
    </div>
  );
}

export function InvestigatePanel({ documentId, onUse, children }: {
  documentId: number;
  onUse: (operationId: string, params: Record<string, string>) => void;
  children?: React.ReactNode;
}) {
  const [goal, setGoal] = useState("");
  const [hits, setHits] = useState<RawHit[] | null>(null);
  const [rag, setRag] = useState<RagResult | null>(null);
  const [busy, setBusy] = useState<"" | "search" | "rag">("");
  const [error, setError] = useState("");

  async function run(kind: "search" | "rag") {
    setBusy(kind); setError("");
    try {
      if (kind === "search") { setHits(await postJson<RawHit[]>("/api/search", { documentId, query: goal })); setRag(null); }
      else { setRag(await postJson<RagResult>("/api/investigate", { documentId, goal })); setHits(null); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel">
      <h2>Hedefini yaz</h2>
      <div className="row">
        <input className="grow" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="örn. Satışta olan ürünleri listele"
          onKeyDown={(e) => { if (e.key === "Enter" && goal.trim()) run("rag"); }} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="secondary" disabled={!goal.trim() || !!busy} onClick={() => run("search")}>{busy === "search" ? "Aranıyor…" : "Ham arama (yalnızca pgvector)"}</button>
        <button disabled={!goal.trim() || !!busy} onClick={() => run("rag")}>{busy === "rag" ? "İnceleniyor…" : "İncele (RAG)"}</button>
        {children}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>Arama ve inceleme hedef API&apos;ye istek göndermez.</div>
      {error && <p className="error">{error}</p>}

      {hits && (
        <>
          <h3>Ham pgvector sonuçları (kosinüs mesafesine göre)</h3>
          {hits.length === 0 && <div className="muted">Embedding&apos;i olan işlem yok.</div>}
          <table>
            <thead><tr><th>#</th><th>İşlem</th><th>Benzerlik</th><th>Mesafe</th></tr></thead>
            <tbody>
              {hits.map((h, i) => (
                <tr key={h.operationId}>
                  <td>{i + 1}</td>
                  <td><code>{h.operationId}</code> <span className="muted">GET {h.path}</span>{!h.executable && <span className="badge warn">çalıştırılamaz</span>}
                    <details><summary className="small muted">embedding metni</summary><pre>{h.embedText}</pre></details></td>
                  <td><span className="bar"><span style={{ width: `${Math.max(0, h.similarity) * 100}%` }} /></span> {h.similarity.toFixed(3)}</td>
                  <td>{h.distance.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted">En yakın sonuç otomatik olarak doğru sonuç değildir; bu tablo yalnızca anlamsal yakınlığı gösterir.</div>
        </>
      )}

      {rag && (
        <>
          <details>
            <summary className="small"><b>Getirilen bağlam</b> — modele verilen {rag.retrieved.length} işlem (RAG&apos;in &quot;R&quot;si)</summary>
            <table>
              <thead><tr><th>İşlem</th><th>Benzerlik</th><th>Kaynak</th></tr></thead>
              <tbody>{rag.retrieved.map((r) => <tr key={r.operation_id}><td><code>{r.operation_id}</code> {r.request}</td><td>{r.similarity}</td><td><code>{r.source}</code></td></tr>)}</tbody>
            </table>
            <pre>{JSON.stringify(rag.retrieved, null, 2)}</pre>
          </details>
          <div className="box model">
            <div className="label">Model yorumu ({rag.model.name}) — doğrulanmamış çıkarım</div>
            {rag.model.answer ? (
              <>
                <div>Seçim: <code>{rag.model.answer.operation_id ?? "yok"}</code> · güven: {rag.model.answer.confidence}</div>
                <div>{rag.model.answer.reasoning}</div>
                {rag.model.answer.missing_information.length > 0 && <div className="small">Eksik bilgi: {rag.model.answer.missing_information.join("; ")}</div>}
              </>
            ) : <pre>{rag.model.rawText || "(boş yanıt)"}</pre>}
          </div>
          <ProposalBox proposal={rag.proposal} onUse={onUse} />
        </>
      )}
    </section>
  );
}
