// Agent R&D Lab — cloud sync.
//
// LabAgent and PromptVersion live in localStorage by default: real, but
// per-browser. This adds an explicit, opt-in bridge to the lab_agents /
// lab_agent_prompt_versions tables (see the migration alongside this file) so
// an agent can follow you to another device.
//
// Deliberately NOT automatic background sync: no realtime, no merge logic, no
// silent conflict resolution. Push sends local → cloud (upsert by id). Pull
// replaces local with what's in the cloud. Both are user-triggered so nothing
// moves without you choosing it — the honest tradeoff for keeping this small.
//
// The lab_agents / lab_agent_prompt_versions tables aren't in the generated
// Supabase types.ts yet (it's regenerated from the live schema; this
// migration hasn't run against it here). The casts below are a narrow, called
// out escape hatch for that — remove them once `supabase gen types` picks up
// the new tables.
import { supabase } from "@/integrations/supabase/client";
import type { LabAgent, PromptVersion } from "./agentLab";

interface CloudAgentRow {
  id: string;
  user_id: string;
  name: string;
  role: string;
  system: string;
  provider: string;
  model: string;
  context_budget: number;
  fallback: boolean;
  tags: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

interface CloudVersionRow {
  id: string;
  agent_id: string;
  user_id: string;
  label: string;
  system: string;
  created_at: string;
}

function toRow(a: LabAgent, userId: string): CloudAgentRow {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    role: a.role,
    system: a.system,
    provider: a.provider,
    model: a.model,
    context_budget: a.contextBudget,
    fallback: a.fallback,
    tags: a.tags,
    notes: a.notes,
    created_at: new Date(a.createdAt).toISOString(),
    updated_at: new Date(a.updatedAt).toISOString(),
  };
}

function fromRow(r: CloudAgentRow): LabAgent {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    system: r.system,
    provider: r.provider as LabAgent["provider"],
    model: r.model,
    contextBudget: r.context_budget,
    fallback: r.fallback,
    tags: r.tags ?? [],
    notes: r.notes,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

/** True once a signed-in session exists — sync is only available then. */
export async function cloudAvailable(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session?.user;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sign in to sync agents to the cloud.");
  return data.user.id;
}

/** Upsert every local agent into lab_agents, keyed by id. */
export async function pushAgentsToCloud(agents: LabAgent[]): Promise<{ pushed: number }> {
  const userId = await requireUserId();
  if (!agents.length) return { pushed: 0 };
  const rows = agents.map((a) => toRow(a, userId));
  const { error } = await (supabase as any).from("lab_agents").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return { pushed: rows.length };
}

/** Fetch every cloud agent belonging to the signed-in user. */
export async function pullAgentsFromCloud(): Promise<LabAgent[]> {
  await requireUserId(); // surfaces a clear error before hitting RLS silently
  const { data, error } = await (supabase as any)
    .from("lab_agents")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CloudAgentRow[]).map(fromRow);
}

export async function deleteCloudAgent(id: string): Promise<void> {
  const { error } = await (supabase as any).from("lab_agents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function pushVersion(v: PromptVersion): Promise<void> {
  const userId = await requireUserId();
  const row: CloudVersionRow = {
    id: v.id,
    agent_id: v.agentId,
    user_id: userId,
    label: v.label,
    system: v.system,
    created_at: new Date(v.at).toISOString(),
  };
  const { error } = await (supabase as any).from("lab_agent_prompt_versions").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function pullVersions(agentId: string): Promise<PromptVersion[]> {
  await requireUserId();
  const { data, error } = await (supabase as any)
    .from("lab_agent_prompt_versions")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CloudVersionRow[]).map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    label: r.label,
    system: r.system,
    at: new Date(r.created_at).getTime(),
  }));
}
