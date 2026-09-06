// One run path for every surface that runs a lab agent.
//
// The bench, Compare, and anything added later call runAgent, so an agent's
// configuration means the same thing everywhere: an auto-route agent goes
// through Jacky's orchestrator no matter which page started the run, and a
// provider agent streams through the same edge functions with the same budget
// trimming, the same measured latency, and the same run history.

import type { LabAgent } from "./agentLab";
import { fitToBudget, recordRun } from "./agentLab";
import { findProvider } from "./jackie-providers";
import { streamProviderChat, type ChatMessage } from "./jackie-provider-stream";
import { orchestrate } from "./jackie-orchestrator";

export interface AgentRunResult {
  output: string;
  /** Who actually answered — may differ from the configured provider. */
  servedBy?: string;
  model?: string;
  /** Measured wall-clock duration. */
  ms: number;
  /** Estimated prompt tokens after budget trimming. */
  promptTokens: number;
  dropped: number;
  error?: string;
}

export interface RunAgentOptions {
  /** Called with the full text so far, as it arrives. */
  onDelta?: (accumulated: string) => void;
  onFallback?: (from: string, to: string, reason: string) => void;
  /** Checked before each chunk — return true once the user has pressed Stop. */
  shouldStop?: () => boolean;
  /** Append to the lab's shared run history. Default true. */
  record?: boolean;
}

/**
 * Run one agent on one prompt. Never throws — a failure comes back as `error`
 * on the result, so callers running many agents at once always settle.
 *
 * Auto-route agents go through Jacky's orchestrator, which is single-shot: it
 * returns the whole answer at once, so onDelta fires once rather than faking a
 * stream. Everything else streams token by token.
 */
export async function runAgent(
  agent: LabAgent,
  prompt: string,
  opts: RunAgentOptions = {},
): Promise<AgentRunResult> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const fit = fitToBudget(messages, agent.system, agent.contextBudget);
  const started = performance.now();

  let acc = "";
  let servedBy: string | undefined;
  let model: string | undefined;

  const settle = (error?: string): AgentRunResult => {
    const ms = performance.now() - started;
    if (opts.record !== false) {
      recordRun({
        agentId: agent.id,
        agentName: agent.name,
        prompt,
        output: acc,
        servedBy,
        model,
        ms,
        promptTokens: fit.tokens,
        droppedMessages: fit.dropped,
        error,
      });
    }
    return { output: acc, servedBy, model, ms, promptTokens: fit.tokens, dropped: fit.dropped, error };
  };

  if (agent.autoRoute) {
    try {
      const routed = await orchestrate({
        prompt: fit.messages[0]?.content ?? prompt,
        system: agent.system,
      });
      acc = routed.output;
      servedBy = `jacky-auto · ${routed.kind}${routed.attemptedFallback ? " (fell back)" : ""}`;
      model = routed.modelUsed;
      if (routed.attemptedFallback) {
        opts.onFallback?.("jacky-auto", routed.modelUsed, "Jacky's primary pick failed");
      }
      opts.onDelta?.(acc);
      return settle();
    } catch (e) {
      return settle(e instanceof Error ? e.message : "auto-route failed");
    }
  }

  let failure: string | undefined;
  await streamProviderChat({
    provider: agent.provider,
    model: agent.model,
    messages: fit.messages,
    system: agent.system,
    fallback: agent.fallback,
    onDelta: (t) => {
      if (opts.shouldStop?.()) return;
      acc += t;
      opts.onDelta?.(acc);
    },
    onFallback: (from, to, reason) => opts.onFallback?.(from, to, reason),
    onDone: (m) => {
      servedBy = m?.servedBy;
      model = m?.model;
    },
    onError: (e) => { failure = e; },
  });
  return settle(failure);
}

/**
 * How an agent's routing should be labelled in UI and exported reports. An
 * auto-route agent's configured provider/model are ignored at run time, so
 * labelling it with them would be a lie — every surface goes through here
 * rather than reading `provider`/`model` directly.
 */
export function describeRouting(agent: LabAgent): { provider: string; model: string } {
  if (agent.autoRoute) return { provider: "Auto-route", model: "Jacky decides" };
  return { provider: findProvider(agent.provider)?.label ?? agent.provider, model: agent.model };
}
