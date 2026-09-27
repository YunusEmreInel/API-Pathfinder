// Bounded agent loop with Gemini function calling (Interactions API).
//   model proposes a tool call -> server validates + runs it -> result goes back to the model -> repeat.
// We keep the full step history ourselves (store: false) so every request is visible in code and in the trace.
import type { Interactions } from "@google/genai";
import { config, gemini } from "./gemini";
import { getOperations } from "./db";
import { TOOLS, modelToolDeclarations } from "./tools";
import { paramsFromPairs, validateProposal, type Proposal } from "./proposal";
import { UNTRUSTED_DATA_RULES, type ModelAnswer } from "./rag";

export const MAX_TOOL_STEPS = 4;

const AGENT_SYSTEM = `
You help a developer find which GET operation of an imported OpenAPI document serves their goal.
You have tools: search_endpoints to find candidates, inspect_endpoint to read one operation's documented details.
Work in few steps: usually search once, then inspect the most promising candidate before answering.
You have at most ${MAX_TOOL_STEPS} tool calls in total. You cannot send HTTP requests; the user does that after reviewing your answer.
Pick an operation only if its documented purpose and parameters serve the goal; similarity alone is not enough.
Fill parameters only with values stated or clearly implied by the goal and allowed by the documented type/enum.
Never guess required values the goal does not give; list them in missing_information.
When you are done, reply with ONLY a JSON object (no markdown fences) of this shape:
{"operation_id": string|null, "parameters": [{"name": string, "value": string}], "reasoning": string, "confidence": "high"|"medium"|"low", "missing_information": string[]}
Write reasoning in Turkish, citing the operation_id and the documented fields you relied on.
${UNTRUSTED_DATA_RULES}`.trim();

export interface TraceEntry {
  step: number;
  tool: string;
  arguments: Record<string, unknown>;
  callId: string;
  /** Who executed it. The model never executes anything. */
  executedBy: "server" | "refused";
  resultSummary: string;
  result: unknown;
  durationMs: number;
}

export interface AgentResult {
  mode: "agent";
  model: { name: string; answer: ModelAnswer | null; rawText: string };
  trace: TraceEntry[];
  modelTurns: number;
  stoppedBecause: "final_answer" | "step_limit" | "no_output";
  /** Operation ids that appeared in tool results — i.e. that the model actually saw. */
  seenOperations: string[];
  proposal: Proposal;
}

function summarize(tool: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r && typeof r.error === "string") return `error: ${r.error}`;
  if (tool === "search_endpoints" && Array.isArray(r.candidates)) {
    return r.candidates.map((c: { operation_id: string; similarity: number }) => `${c.operation_id} (${c.similarity})`).join(", ");
  }
  if (tool === "inspect_endpoint") {
    const params = (r.parameters as { name: string; required: boolean }[]).map((p) => `${p.name}${p.required ? "*" : ""}`).join(", ");
    return `${r.request} · params: ${params || "none"} · executable: ${r.executable}`;
  }
  return JSON.stringify(result).slice(0, 160);
}

function parseAnswer(text: string): ModelAnswer | null {
  const match = text.match(/\{[\s\S]*\}/); // tolerate stray prose or ``` fences around the JSON
  if (!match) return null;
  try {
    const a = JSON.parse(match[0]);
    return a && typeof a === "object" && "operation_id" in a ? (a as ModelAnswer) : null;
  } catch {
    return null;
  }
}

export async function runAgent(documentId: number, goal: string): Promise<AgentResult> {
  const model = config.model();
  const tools = modelToolDeclarations();
  const history: Interactions.Step[] = [
    { type: "user_input", content: [{ type: "text", text: `<untrusted_data>\n${JSON.stringify({ goal })}\n</untrusted_data>` }] },
  ];
  const trace: TraceEntry[] = [];
  const seen = new Set<string>();
  let modelTurns = 0;
  let finalText = "";
  let stoppedBecause: AgentResult["stoppedBecause"] = "no_output";

  // Each iteration = one model turn. Tool executions are capped at MAX_TOOL_STEPS; one extra turn lets it answer.
  while (modelTurns <= MAX_TOOL_STEPS) {
    modelTurns++;
    const interaction = await gemini().interactions.create({
      model,
      system_instruction: AGENT_SYSTEM,
      tools,
      input: history,
      store: false,
    });
    const steps = interaction.steps ?? [];
    history.push(...steps); // keep thought/function_call steps so the model sees its own reasoning chain
    const calls = steps.filter((s): s is Extract<Interactions.Step, { type: "function_call" }> => s.type === "function_call");

    if (calls.length === 0) {
      finalText = interaction.output_text ?? "";
      stoppedBecause = finalText ? "final_answer" : "no_output";
      break;
    }

    for (const call of calls) {
      const started = Date.now();
      const def = TOOLS[call.name];
      const budgetLeft = trace.filter((t) => t.executedBy === "server").length < MAX_TOOL_STEPS;
      let result: unknown;
      let executedBy: TraceEntry["executedBy"] = "server";
      if (!def || !def.modelCallable) {
        executedBy = "refused";
        result = { error: `Tool '${call.name}' is not available to you.` };
      } else if (!budgetLeft) {
        executedBy = "refused";
        result = { error: `Tool budget of ${MAX_TOOL_STEPS} calls is used up. Answer now with the JSON object.` };
      } else {
        result = await def.run({ documentId }, call.arguments ?? {});
        for (const id of JSON.stringify(result).match(/"operation_id":"([^"]+)"/g) ?? []) seen.add(id.slice(16, -1));
      }
      trace.push({
        step: trace.length + 1,
        tool: call.name,
        arguments: call.arguments ?? {},
        callId: call.id,
        executedBy,
        resultSummary: summarize(call.name, result),
        result,
        durationMs: Date.now() - started,
      });
      // Send the tool result back to the model, matched to its call by call_id.
      history.push({
        type: "function_result",
        call_id: call.id,
        name: call.name,
        is_error: executedBy === "refused" || (typeof result === "object" && result !== null && "error" in result),
        result: JSON.stringify(result),
      });
    }
    if (modelTurns > MAX_TOOL_STEPS) stoppedBecause = "step_limit";
  }

  const answer = parseAnswer(finalText);
  const ops = await getOperations(documentId);
  let proposal: Proposal = answer
    ? validateProposal(ops, answer.operation_id, paramsFromPairs(answer.parameters))
    : { status: "no_match", note: stoppedBecause === "step_limit" ? "Step limit reached without a final answer." : "Model did not return a parseable answer." };
  // An operation the model never saw via a tool result is not grounded, even if it happens to exist.
  if (proposal.status !== "no_match" && proposal.status !== "invalid_suggestion" && !seen.has(proposal.operationId)) {
    proposal = { status: "invalid_suggestion", operationId: proposal.operationId, note: "The model chose an operation it never retrieved through a tool; discarded." };
  }

  return { mode: "agent", model: { name: model, answer, rawText: finalText }, trace, modelTurns, stoppedBecause, seenOperations: [...seen], proposal };
}
