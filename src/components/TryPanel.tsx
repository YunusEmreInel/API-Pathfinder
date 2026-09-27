"use client";
import { useState } from "react";
import type { ExtractedOperation } from "@/lib/openapi";
import type { TryOutcome } from "@/lib/try-request";

interface Props {
  op: ExtractedOperation;
  /** Called with the parameters; must POST to /api/try and return the outcome. */
  send: (params: Record<string, string>) => Promise<TryOutcome | { error: string }>;
  initialParams?: Record<string, string>;
}

export function OperationDoc({ op }: { op: ExtractedOperation }) {
  return (
    <div className="box doc">
      <div className="label">Dokümandan (OpenAPI)</div>
      <div><span className="method">GET</span><code>{op.path}</code> · <code>{op.operationId}</code></div>
      {op.summary && <div><b>{op.summary}</b></div>}
      {op.description && <div className="small">{op.description}</div>}
      <div className="small muted">Kaynak: <code>{op.sourcePointer}</code></div>
      <div className="small muted">200 yanıtı: {op.responseSummary}</div>
      {op.params.length > 0 && (
        <table style={{ marginTop: 6 }}>
          <thead><tr><th>Parametre</th><th>Yer</th><th>Tip</th><th>Zorunlu</th><th>Açıklama</th></tr></thead>
          <tbody>
            {op.params.map((p) => (
              <tr key={p.in + p.name}>
                <td><code>{p.name}</code></td><td>{p.in}</td>
                <td>{p.type}{p.enum ? ` (${p.enum.join(" | ")})` : ""}</td>
                <td>{p.required ? "evet" : "hayır"}</td><td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {op.unsupportedParams.map((u) => (
        <div key={u.name} className="small error">Desteklenmeyen parametre <code>{u.name}</code> ({u.in}): {u.reason}</div>
      ))}
      {op.blockers.map((b) => <div key={b} className="small error">Çalıştırılamaz: {b}</div>)}
    </div>
  );
}

export function TryResult({ outcome }: { outcome: TryOutcome }) {
  if (outcome.state === "not_executable") {
    return <div className="box warn"><div className="label">İstek gönderilmedi</div>{outcome.reasons.join(" ")}</div>;
  }
  if (outcome.state === "needs_input") {
    return (
      <div className="box warn">
        <div className="label">İstek gönderilmedi — girdi gerekli</div>
        {outcome.missing.map((m) => <div key={m.name}>Eksik zorunlu parametre: <code>{m.name}</code> ({m.in}, {m.type})</div>)}
        {outcome.errors.map((e) => <div key={e}>{e}</div>)}
      </div>
    );
  }
  const r = outcome.result;
  const ok = r.kind === "response" && r.ok;
  return (
    <div className={`box ${ok ? "live-ok" : "live-err"}`}>
      <div className="label">Canlı istekte gözlenen {ok ? "" : "— HATA"}</div>
      <div><span className="method">GET</span><code>{outcome.url}</code></div>
      {r.kind === "response" ? (
        <>
          <div>
            Durum: <span className={`status ${ok ? "ok" : "err"}`}>{r.status} {r.statusText}</span>
            <span className="small muted"> · {r.durationMs} ms · {r.contentType || "içerik tipi yok"}{r.truncated ? " · YANIT KIRPILDI" : ""}</span>
          </div>
          <pre>{r.json !== undefined ? JSON.stringify(r.json, null, 2) : r.body || "(boş gövde)"}</pre>
        </>
      ) : (
        <div className="error"><b>{r.kind}</b>: {r.message}</div>
      )}
      <div className="small"><b>Uygulamanın yorumu:</b> {outcome.verdict}</div>
      <h3>TypeScript fetch örneği</h3>
      <pre>{outcome.snippet}</pre>
    </div>
  );
}

export function TryPanel({ op, send, initialParams }: Props) {
  const [params, setParams] = useState<Record<string, string>>(initialParams ?? {});
  const [outcome, setOutcome] = useState<TryOutcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onTry() {
    setBusy(true); setError(""); setOutcome(null);
    try {
      const res = await send(params);
      if ("error" in res) setError(res.error);
      else setOutcome(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {op.params.map((p) => (
        <div key={p.in + p.name} className="row" style={{ marginBottom: 6 }}>
          <label style={{ width: 150 }}><code>{p.name}</code>{p.required && <span className="error"> *</span>} <span className="small muted">{p.in}</span></label>
          {p.enum ? (
            <select className="grow" value={params[p.name] ?? ""} onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}>
              <option value="">(boş)</option>
              {p.enum.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
            </select>
          ) : (
            <input className="grow" value={params[p.name] ?? ""} placeholder={p.type}
              onChange={(e) => setParams({ ...params, [p.name]: e.target.value })} />
          )}
        </div>
      ))}
      <div className="row">
        <button onClick={onTry} disabled={busy}>{busy ? "Gönderiliyor…" : "İsteği dene"}</button>
        <span className="small muted">Gerçek GET isteği yalnızca bu düğmeyle gönderilir.</span>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {outcome && <TryResult outcome={outcome} />}
    </div>
  );
}
