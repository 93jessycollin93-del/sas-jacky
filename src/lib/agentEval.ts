// Agent evals — the part of R&D that turns opinion into evidence.
//
// The bench answers "what did it say once?". Compare answers "who said it
// better, this time?". Neither answers the actual research question: did
// changing the system prompt make the agent *better*, across the cases I care
// about, repeatably?
//
// A suite is a fixed set of cases. Each case is a prompt plus deterministic
// checks — substring, regex, length. Nothing here judges quality: a check
// passes iff the assertion you wrote holds against the real output. Every run
// snapshots the system prompt it ran against, so two runs of the same suite
// tell you which prompt actually scored better rather than which one felt
// better.

import { download, slug } from "./agentLab";

export type EvalCheckKind = "contains" | "not_contains" | "regex" | "min_chars" | "max_chars";

export const CHECK_LABELS: Record<EvalCheckKind, string> = {
  contains: "must contain",
  not_contains: "must not contain",
  regex: "must match regex",
  min_chars: "min length (chars)",
  max_chars: "max length (chars)",
};

export interface EvalCheck {
  id: string;
  kind: EvalCheckKind;
  /** Substring/pattern for text checks; a number for the length checks. */
  value: string;
  ignoreCase?: boolean;
}

export interface EvalCase {
  id: string;
  prompt: string;
  note?: string;
  checks: EvalCheck[];
}

export interface EvalSuite {
  id: string;
  name: string;
  cases: EvalCase[];
  createdAt: number;
  updatedAt: number;
}

export interface CheckOutcome {
  checkId: string;
  kind: EvalCheckKind;
  value: string;
  passed: boolean;
  /** Set when the check could not be evaluated (bad regex, non-numeric bound). */
  invalid?: string;
}

export interface CaseOutcome {
  caseId: string;
  prompt: string;
  output: string;
  error?: string;
  ms: number;
  servedBy?: string;
  model?: string;
  checks: CheckOutcome[];
  /** A case passes only if it ran without error and every check passed. */
  passed: boolean;
}

export interface EvalRun {
  id: string;
  suiteId: string;
  suiteName: string;
  agentId: string;
  agentName: string;
  /** How the agent was routed for this run, e.g. "Auto-route · Jacky decides". */
  routing: string;
  /** The exact system prompt this run scored — the whole point of the record. */
  system: string;
  contextBudget: number;
  results: CaseOutcome[];
  passed: number;
  total: number;
  totalMs: number;
  at: number;
}

const SUITES_KEY = "jackie.agentlab.evalsuites.v1";
const EVAL_RUNS_KEY = "jackie.agentlab.evalruns.v1";
const MAX_EVAL_RUNS = 50;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — state just won't persist */
  }
}

/* ── Suites ─────────────────────────────────────────────────────────── */

export function listSuites(): EvalSuite[] {
  return readJson<EvalSuite[]>(SUITES_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveSuite(suite: EvalSuite): EvalSuite {
  const all = readJson<EvalSuite[]>(SUITES_KEY, []);
  const next = { ...suite, updatedAt: Date.now() };
  const i = all.findIndex((s) => s.id === next.id);
  if (i >= 0) all[i] = next;
  else all.push(next);
  writeJson(SUITES_KEY, all);
  return next;
}

export function deleteSuite(id: string): void {
  writeJson(SUITES_KEY, readJson<EvalSuite[]>(SUITES_KEY, []).filter((s) => s.id !== id));
  writeJson(EVAL_RUNS_KEY, readJson<EvalRun[]>(EVAL_RUNS_KEY, []).filter((r) => r.suiteId !== id));
}

export function newSuite(): EvalSuite {
  const now = Date.now();
  return { id: uid(), name: "Untitled suite", cases: [newCase()], createdAt: now, updatedAt: now };
}

export function newCase(): EvalCase {
  return { id: uid(), prompt: "", note: "", checks: [] };
}

export function newCheck(kind: EvalCheckKind = "contains"): EvalCheck {
  return { id: uid(), kind, value: "", ignoreCase: true };
}

/* ── Checks ─────────────────────────────────────────────────────────── */

const TEXT_KINDS: EvalCheckKind[] = ["contains", "not_contains", "regex"];

/**
 * Evaluate one check against real output. Deterministic and local — no model
 * decides whether this passed. A check that cannot be evaluated (invalid
 * regex, non-numeric bound) fails and says why rather than silently passing.
 */
export function runCheck(check: EvalCheck, output: string): CheckOutcome {
  const base = { checkId: check.id, kind: check.kind, value: check.value };

  if (TEXT_KINDS.includes(check.kind) && !check.value.trim()) {
    return { ...base, passed: false, invalid: "no value set" };
  }

  switch (check.kind) {
    case "contains":
    case "not_contains": {
      const hay = check.ignoreCase ? output.toLowerCase() : output;
      const needle = check.ignoreCase ? check.value.toLowerCase() : check.value;
      const found = hay.includes(needle);
      return { ...base, passed: check.kind === "contains" ? found : !found };
    }
    case "regex": {
      try {
        return { ...base, passed: new RegExp(check.value, check.ignoreCase ? "i" : "").test(output) };
      } catch (e) {
        return { ...base, passed: false, invalid: e instanceof Error ? e.message : "invalid regex" };
      }
    }
    case "min_chars":
    case "max_chars": {
      const n = Number(check.value);
      if (!Number.isFinite(n)) return { ...base, passed: false, invalid: "not a number" };
      return { ...base, passed: check.kind === "min_chars" ? output.length >= n : output.length <= n };
    }
  }
}

/**
 * Score one case's real output. A case with no checks is reported as passing
 * only if the run itself succeeded — it asserts nothing, and the UI says so.
 */
export function scoreCase(c: EvalCase, output: string, error?: string): CheckOutcome[] {
  if (error) return [];
  return c.checks.map((check) => runCheck(check, output));
}

export function casePassed(outcomes: CheckOutcome[], error?: string): boolean {
  if (error) return false;
  return outcomes.every((o) => o.passed);
}

/* ── Eval run history ───────────────────────────────────────────────── */

export function listEvalRuns(suiteId?: string): EvalRun[] {
  const all = readJson<EvalRun[]>(EVAL_RUNS_KEY, []);
  return (suiteId ? all.filter((r) => r.suiteId === suiteId) : all).sort((a, b) => b.at - a.at);
}

export function recordEvalRun(run: Omit<EvalRun, "id" | "at">): EvalRun {
  const rec: EvalRun = { ...run, id: uid(), at: Date.now() };
  writeJson(EVAL_RUNS_KEY, [rec, ...readJson<EvalRun[]>(EVAL_RUNS_KEY, [])].slice(0, MAX_EVAL_RUNS));
  return rec;
}

export function clearEvalRuns(suiteId: string): void {
  writeJson(EVAL_RUNS_KEY, readJson<EvalRun[]>(EVAL_RUNS_KEY, []).filter((r) => r.suiteId !== suiteId));
}

/* ── Portable assets ────────────────────────────────────────────────── */

export const EVAL_FORMAT = "jackie.agentlab.evalsuite/v1";

export function exportSuite(suite: EvalSuite): void {
  download(`${slug(suite.name)}.evalsuite.json`, JSON.stringify({ format: EVAL_FORMAT, suites: [suite] }, null, 2));
}

function isSuiteish(v: unknown): v is EvalSuite {
  const s = v as EvalSuite;
  return !!s && typeof s.name === "string" && Array.isArray(s.cases);
}

/** Read suites out of an exported file, re-iding so import never overwrites. */
export async function importSuitesFromFile(file: File): Promise<EvalSuite[]> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const raw = Array.isArray(parsed) ? parsed : (parsed as { suites?: unknown[] })?.suites;
  if (!Array.isArray(raw)) throw new Error("No eval suites found in that file.");
  const valid = raw.filter(isSuiteish);
  if (!valid.length) throw new Error("No suites in that file matched the expected shape.");
  const now = Date.now();
  return valid.map((s) => ({
    ...s,
    id: uid(),
    cases: s.cases.map((c) => ({
      ...c,
      id: uid(),
      checks: Array.isArray(c.checks) ? c.checks.map((ck) => ({ ...ck, id: uid() })) : [],
    })),
    createdAt: now,
    updatedAt: now,
  }));
}

/** Download an eval run as a Markdown report — the artifact you keep. */
export function exportEvalRun(run: EvalRun): void {
  const pct = run.total ? Math.round((run.passed / run.total) * 100) : 0;
  const rows = run.results.map((r) => {
    const failed = r.checks.filter((c) => !c.passed).length;
    const detail = r.error ? "run failed" : failed ? `${failed} check(s) failed` : "all checks passed";
    return `| ${r.prompt.slice(0, 60).replace(/\n/g, " ")}${r.prompt.length > 60 ? "…" : ""} | ${r.passed ? "✅" : "❌"} | ${detail} | ${(r.ms / 1000).toFixed(2)}s |`;
  });
  const md = [
    `# Eval — ${run.suiteName}`,
    "",
    `- **Agent:** ${run.agentName} (${run.routing})`,
    `- **When:** ${new Date(run.at).toLocaleString()}`,
    `- **Score:** ${run.passed}/${run.total} cases passed (${pct}%)`,
    `- **Total time:** ${(run.totalMs / 1000).toFixed(2)}s`,
    `- **Context budget:** ${run.contextBudget.toLocaleString()} tokens`,
    "",
    "## System prompt scored",
    "",
    "```",
    run.system,
    "```",
    "",
    "## Cases",
    "",
    "| Prompt | Result | Detail | Latency |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Outputs",
    "",
    ...run.results.flatMap((r) => [
      `### ${r.passed ? "✅" : "❌"} ${r.prompt.slice(0, 80).replace(/\n/g, " ")}`,
      "",
      ...(r.error ? [`> **Error:** ${r.error}`] : [r.output || "_(empty)_"]),
      "",
      ...(r.checks.length
        ? [
            "Checks:",
            "",
            ...r.checks.map(
              (c) =>
                `- ${c.passed ? "✅" : "❌"} \`${CHECK_LABELS[c.kind]}\` ${c.value}${c.invalid ? ` — _${c.invalid}_` : ""}`,
            ),
            "",
          ]
        : ["_No checks on this case — it asserts nothing._", ""]),
    ]),
    "_Checks are deterministic string/regex assertions evaluated locally. They measure whether the output satisfies the assertions written for it, not output quality._",
    "",
  ].join("\n");
  download(`${slug(run.suiteName)}-eval-${run.at}.md`, md, "text/markdown");
}
