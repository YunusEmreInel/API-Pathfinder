"use client";
import { useState } from "react";
import type { ModelAnswer, RagResult } from "@/lib/rag";
import type { AgentResult } from "@/lib/agent";
import type { Proposal } from "@/lib/proposal";
import { postJson } from "@/lib/client";

export interface RawHit { operationId: string; path: string; summary: string; distance: number; similarity: number; embedText: string; executable: boolean }

export function ModelAnswerBox({ name, answer, rawText, subtitle }: { name: string; answer: ModelAnswer | null; rawText: string; subtitle?: string }) {
  return (
    <div className="box model">
      <div className="label">Model yorumu ({name}) — doğrulanmamış çıkarım{subtitle ? ` · ${subtitle}` : ""}</div>
      {answer ? (
        <>
          <div>Seçim: <code>{answer.operation_id ?? "yok"}</code> · güven: {answer.confidence}</div>
          <div>{answer.reasoning}</div>
          {answer.missing_information.length > 0 && <div className="small">Eksik bilgi: {answer.missing_information.join("; ")}</div>}
        </>
      ) : <pre>{rawText || "(boş yanıt)"}</pre>}
    </div>
  );
}

export function AgentTrace({ result }: { result: AgentResult }) {
  return (
    <>
      <h3>Araç izi — model önerdi, sunucu çalıştırdı ({result.trace.length} araç adımı, {result.modelTurns} model turu)</h3>
      {result.trace.length === 0 && <div className="box warn">Model hiç araç çağırmadı.</div>}
      <table className="trace">
        <colgroup><col className="n" /><col /><col className="who" /><col /></colgroup>
        <thead><tr><th>#</th><th>Modelin istediği çağrı</th><th>Kim çalıştırdı</th><th>Modele geri giden sonuç (özet)</th></tr></thead>
        <tbody>
          {result.trace.map((t) => (
            <tr key={t.callId + t.step}>
              <td>{t.step}</td>
              <td><code>{t.tool}({JSON.stringify(t.arguments)})</code></td>
              <td>{t.executedBy === "server" ? `sunucu · ${t.durationMs} ms` : <span className="error">reddedildi</span>}</td>
              <td className="small">{t.resultSummary}
                <details><summary className="muted">tam sonuç</summary><pre>{JSON.stringify(t.result, null, 2)}</pre></details></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small muted">Durma nedeni: {result.stoppedBecause} · En fazla 4 araç adımı. <code>try_get_request</code> modele verilmez.</div>
    </>
  );
}

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
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState<"" | "search" | "rag" | "agent">("");
  const [error, setError] = useState("");

  async function run(kind: "search" | "rag" | "agent") {
    setBusy(kind); setError(""); setHits(null); setRag(null); setAgent(null);
    try {
      if (kind === "search") setHits(await postJson<RawHit[]>("/api/search", { documentId, query: goal }));
      else if (kind === "rag") setRag(await postJson<RagResult>("/api/investigate", { documentId, goal, mode: "rag" }));
      else setAgent(await postJson<AgentResult>("/api/investigate", { documentId, goal, mode: "agent" }));
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
          onKeyDown={(e) => { if (e.key === "Enter" && goal.trim() && !busy) run("agent"); }} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="secondary" disabled={!goal.trim() || !!busy} onClick={() => run("search")}>{busy === "search" ? "Aranıyor…" : "Ham arama (yalnızca pgvector)"}</button>
        <button disabled={!goal.trim() || !!busy} onClick={() => run("rag")}>{busy === "rag" ? "İnceleniyor…" : "İncele (RAG)"}</button>
        <button disabled={!goal.trim() || !!busy} onClick={() => run("agent")}>{busy === "agent" ? "Agent çalışıyor…" : "İncele (Agent + araçlar)"}</button>
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
          <ModelAnswerBox name={rag.model.name} answer={rag.model.answer} rawText={rag.model.rawText} subtitle="sabit zincir: ara → cevapla" />
          <ProposalBox proposal={rag.proposal} onUse={onUse} />
        </>
      )}
      {agent && (
        <>
          <AgentTrace result={agent} />
          <ModelAnswerBox name={agent.model.name} answer={agent.model.answer} rawText={agent.model.rawText} subtitle="araç sonuçlarına göre" />
          <ProposalBox proposal={agent.proposal} onUse={onUse} />
        </>
      )}
    </section>
  );
}
