// Agent Evals — run a fixed set of cases against an agent and score it.
//
// Every case is a real run through the shared agent runner (so auto-route
// agents route through Jacky's orchestrator here too), and every check is a
// deterministic local assertion. Nothing is judged by a model, no score is
// invented: a case passes iff it ran and every assertion you wrote held.
//
// Cases run sequentially rather than in parallel — a suite hitting a rate
// limit all at once would measure the limiter, not the agent.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ClipboardCheck, Plus, Play, Square, Trash2, Save, FileDown,
  Upload, Download, Beaker, History, CheckCircle2, XCircle, GitCompare,
  ArrowRight, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { type LabAgent, listAgents } from "@/lib/agentLab";
import { runAgent, describeRouting } from "@/lib/agentRunner";
import {
  type EvalSuite, type EvalCase, type EvalCheck, type EvalCheckKind,
  type CaseOutcome, type EvalRun,
  CHECK_LABELS, listSuites, saveSuite, deleteSuite, newSuite, newCase, newCheck,
  scoreCase, casePassed, listEvalRuns, recordEvalRun, clearEvalRuns,
  exportSuite, importSuitesFromFile, exportEvalRun,
  compareEvalRuns, exportEvalComparison,
} from "@/lib/agentEval";

const CHECK_KINDS: EvalCheckKind[] = ["contains", "not_contains", "regex", "min_chars", "max_chars"];

export default function AgentEval() {
  const [agents, setAgents] = useState<LabAgent[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [draft, setDraft] = useState<EvalSuite | null>(null);
  const [results, setResults] = useState<CaseOutcome[]>([]);
  const [running, setRunning] = useState(false);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [history, setHistory] = useState<EvalRun[]>([]);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const stopRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const list = listAgents();
    setAgents(list);
    setAgentId(list[0]?.id ?? "");
    const s = listSuites();
    setSuites(s);
    if (s.length) {
      setDraft(s[0]);
      setHistory(listEvalRuns(s[0].id));
    }
  }, []);

  // Keep the user's pairing while it stays valid; otherwise fall back to
  // "previous vs latest". Guarded so it only writes when the current pair is
  // unusable — writing the same values again is a no-op, so this converges.
  useEffect(() => {
    const ids = new Set(history.map((h) => h.id));
    if (ids.has(beforeId) && ids.has(afterId) && beforeId !== afterId) return;
    setAfterId(history[0]?.id ?? "");
    setBeforeId(history[1]?.id ?? "");
  }, [history, beforeId, afterId]);

  const agent = useMemo(() => agents.find((a) => a.id === agentId), [agents, agentId]);

  // History is newest-first, so the default pairing compares the previous run
  // (before) against the latest (after).
  const comparison = useMemo(() => {
    const b = history.find((h) => h.id === beforeId);
    const a = history.find((h) => h.id === afterId);
    if (!b || !a || b.id === a.id) return null;
    return compareEvalRuns(b, a);
  }, [history, beforeId, afterId]);

  const score = useMemo(() => {
    if (!results.length) return null;
    const passed = results.filter((r) => r.passed).length;
    return { passed, total: results.length, pct: Math.round((passed / results.length) * 100) };
  }, [results]);

  function selectSuite(s: EvalSuite) {
    setDraft(s);
    setResults([]);
    setHistory(listEvalRuns(s.id));
  }

  function persist(next: EvalSuite, note?: string) {
    const saved = saveSuite(next);
    setSuites(listSuites());
    setDraft(saved);
    if (note) toast({ title: note });
    return saved;
  }

  function createSuite() {
    persist(newSuite(), "Suite created");
    setResults([]);
    setHistory([]);
  }

  function patchDraft(p: Partial<EvalSuite>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchCase(caseId: string, p: Partial<EvalCase>) {
    setDraft((d) =>
      d ? { ...d, cases: d.cases.map((c) => (c.id === caseId ? { ...c, ...p } : c)) } : d,
    );
  }

  function patchCheck(caseId: string, checkId: string, p: Partial<EvalCheck>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            cases: d.cases.map((c) =>
              c.id === caseId
                ? { ...c, checks: c.checks.map((ck) => (ck.id === checkId ? { ...ck, ...p } : ck)) }
                : c,
            ),
          }
        : d,
    );
  }

  function removeSuite(s: EvalSuite) {
    deleteSuite(s.id);
    const list = listSuites();
    setSuites(list);
    setDraft(list[0] ?? null);
    setResults([]);
    setHistory(list[0] ? listEvalRuns(list[0].id) : []);
    toast({ title: `Deleted “${s.name}”` });
  }

  async function onImport(file: File) {
    try {
      const incoming = await importSuitesFromFile(file);
      incoming.forEach((s) => saveSuite(s));
      setSuites(listSuites());
      if (incoming[0]) selectSuite(incoming[0]);
      toast({ title: `Imported ${incoming.length} suite${incoming.length === 1 ? "" : "s"}` });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function runSuite() {
    if (!draft || !agent || running) return;
    const cases = draft.cases.filter((c) => c.prompt.trim());
    if (!cases.length) {
      toast({ title: "Nothing to run", description: "Add at least one case with a prompt.", variant: "destructive" });
      return;
    }

    // Run against the saved suite, so a scored run always matches a real suite.
    const suite = persist(draft);
    stopRef.current = false;
    setRunning(true);
    setResults([]);

    const collected: CaseOutcome[] = [];
    const started = performance.now();

    for (const c of cases) {
      if (stopRef.current) break;
      setRunningCaseId(c.id);
      // Eval runs keep their own history; they'd otherwise flood the bench log.
      const r = await runAgent(agent, c.prompt, { record: false });
      const checks = scoreCase(c, r.output, r.error);
      const outcome: CaseOutcome = {
        caseId: c.id,
        prompt: c.prompt,
        output: r.output,
        error: r.error,
        ms: r.ms,
        servedBy: r.servedBy,
        model: r.model,
        checks,
        passed: casePassed(checks, r.error),
      };
      collected.push(outcome);
      setResults([...collected]);
    }

    setRunningCaseId(null);
    setRunning(false);

    if (collected.length) {
      const rec = recordEvalRun({
        suiteId: suite.id,
        suiteName: suite.name,
        agentId: agent.id,
        agentName: agent.name,
        routing: `${describeRouting(agent).provider} · ${describeRouting(agent).model}`,
        system: agent.system,
        contextBudget: agent.contextBudget,
        results: collected,
        passed: collected.filter((r) => r.passed).length,
        total: collected.length,
        totalMs: performance.now() - started,
      });
      setHistory(listEvalRuns(suite.id));
      toast({
        title: stopRef.current ? "Eval stopped" : "Eval complete",
        description: `${rec.passed}/${rec.total} cases passed`,
      });
    }
  }

  const outcomeFor = (caseId: string) => results.find((r) => r.caseId === caseId);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-sidebar">
        <Link to="/" className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft size={14} /> Jackie
        </Link>
        <ClipboardCheck size={14} className="text-primary" />
        <span className="font-mono text-xs uppercase tracking-widest">Agent Evals</span>
        <div className="flex-1" />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
        <Link to="/agent-lab">
          <Button variant="outline" size="sm">
            <Beaker size={13} className="mr-1" /> Lab
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload size={13} className="mr-1" /> Import
        </Button>
        <Button variant="outline" size="sm" disabled={!draft} onClick={() => draft && exportSuite(draft)}>
          <Download size={13} className="mr-1" /> Export suite
        </Button>
        <Button size="sm" onClick={createSuite}>
          <Plus size={13} className="mr-1" /> New suite
        </Button>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground px-1">
            Suites · {suites.length}
          </div>
          {!suites.length && (
            <Card className="p-4 text-xs text-muted-foreground">
              No suites yet.{" "}
              <button className="text-primary underline" onClick={createSuite}>Create one</button>.
            </Card>
          )}
          {suites.map((s) => (
            <Card
              key={s.id}
              onClick={() => selectSuite(s)}
              className={cn(
                "p-3 cursor-pointer transition-colors hover:bg-secondary/50",
                draft?.id === s.id && "border-primary",
              )}
            >
              <div className="font-mono text-xs font-semibold truncate">{s.name}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {s.cases.length} case{s.cases.length === 1 ? "" : "s"}
              </div>
            </Card>
          ))}
        </aside>

        <main className="space-y-4 min-w-0">
          {!agents.length ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No agents yet — build one in the{" "}
              <Link to="/agent-lab" className="text-primary underline">Agent R&amp;D Lab</Link> first.
            </Card>
          ) : !draft ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Select a suite, or create one to start.
            </Card>
          ) : (
            <>
              <Card className="p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Suite name</Label>
                    <Input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Agent under test</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {agent && (
                  <p className="text-[10px] text-muted-foreground">
                    Routing: {describeRouting(agent).provider} · {describeRouting(agent).model} ·
                    budget {agent.contextBudget.toLocaleString()} tok. The system prompt in use is
                    snapshotted with each scored run, so you can compare prompt versions later.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {running ? (
                    <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>
                      <Square size={13} className="mr-1" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" disabled={!agent} onClick={runSuite}>
                      <Play size={13} className="mr-1" /> Run suite
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => persist(draft, "Saved")}>
                    <Save size={13} className="mr-1" /> Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => patchDraft({ cases: [...draft.cases, newCase()] })}
                  >
                    <Plus size={13} className="mr-1" /> Add case
                  </Button>
                  <div className="flex-1" />
                  {score && (
                    <Badge variant={score.passed === score.total ? "default" : "outline"} className="font-mono">
                      {score.passed}/{score.total} passed · {score.pct}%
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => removeSuite(draft)}>
                    <Trash2 size={13} />
                  </Button>
                </div>

                {running && (
                  <Progress
                    value={draft.cases.length ? (results.length / draft.cases.filter((c) => c.prompt.trim()).length) * 100 : 0}
                    className="h-1.5"
                  />
                )}
              </Card>

              {draft.cases.map((c, i) => {
                const outcome = outcomeFor(c.id);
                const isRunning = runningCaseId === c.id;
                return (
                  <Card
                    key={c.id}
                    className={cn(
                      "p-4 space-y-3",
                      outcome && (outcome.passed ? "border-primary/60" : "border-destructive/60"),
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Case {i + 1}
                      </span>
                      {isRunning && (
                        <span className="font-mono text-[10px] text-muted-foreground animate-pulse">running…</span>
                      )}
                      {outcome && (
                        <Badge variant="outline" className="text-[9px] gap-1">
                          {outcome.passed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                          {outcome.error ? "run failed" : outcome.passed ? "passed" : "failed"}
                          {" · "}{(outcome.ms / 1000).toFixed(2)}s
                        </Badge>
                      )}
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => patchDraft({ cases: draft.cases.filter((x) => x.id !== c.id) })}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>

                    <Textarea
                      rows={2}
                      value={c.prompt}
                      placeholder="The prompt this case sends to the agent."
                      onChange={(e) => patchCase(c.id, { prompt: e.target.value })}
                    />

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Checks · {c.checks.length}
                        </Label>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => patchCase(c.id, { checks: [...c.checks, newCheck()] })}
                        >
                          <Plus size={11} className="mr-1" /> Add check
                        </Button>
                      </div>

                      {!c.checks.length && (
                        <p className="text-[10px] text-muted-foreground">
                          No checks — this case runs but asserts nothing, so it only fails if the run errors.
                        </p>
                      )}

                      {c.checks.map((ck) => {
                        const res = outcome?.checks.find((x) => x.checkId === ck.id);
                        return (
                          <div key={ck.id} className="flex flex-wrap items-center gap-2">
                            <select
                              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                              value={ck.kind}
                              onChange={(e) => patchCheck(c.id, ck.id, { kind: e.target.value as EvalCheckKind })}
                            >
                              {CHECK_KINDS.map((k) => (
                                <option key={k} value={k}>{CHECK_LABELS[k]}</option>
                              ))}
                            </select>
                            <Input
                              className="h-8 flex-1 min-w-[140px] font-mono text-xs"
                              value={ck.value}
                              placeholder={ck.kind === "min_chars" || ck.kind === "max_chars" ? "e.g. 200" : "text or pattern"}
                              onChange={(e) => patchCheck(c.id, ck.id, { value: e.target.value })}
                            />
                            {(ck.kind === "contains" || ck.kind === "not_contains" || ck.kind === "regex") && (
                              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <Checkbox
                                  checked={ck.ignoreCase !== false}
                                  onCheckedChange={(v) => patchCheck(c.id, ck.id, { ignoreCase: v === true })}
                                />
                                ignore case
                              </label>
                            )}
                            {res && (
                              <Badge variant="outline" className="text-[9px] gap-1 shrink-0">
                                {res.passed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                                {res.invalid ? res.invalid : res.passed ? "pass" : "fail"}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-destructive"
                              onClick={() => patchCase(c.id, { checks: c.checks.filter((x) => x.id !== ck.id) })}
                            >
                              <Trash2 size={11} />
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    {outcome && (
                      <div className="rounded-md bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap break-words max-h-56 overflow-y-auto">
                        {outcome.error ? (
                          <span className="text-destructive">⚠ {outcome.error}</span>
                        ) : (
                          outcome.output || "(empty)"
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}

              <Card className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <History size={13} className="text-primary" />
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Scored runs · {history.length}
                  </Label>
                  <div className="flex-1" />
                  {history.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearEvalRuns(draft.id);
                        setHistory([]);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {!history.length ? (
                  <p className="text-[10px] text-muted-foreground">
                    No scored runs yet. Each run records the system prompt it scored, so two runs
                    tell you which prompt actually did better.
                  </p>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className="flex items-center gap-2 border-t border-border pt-2 text-[11px]">
                      <Badge variant="outline" className="font-mono text-[9px] shrink-0">
                        {h.passed}/{h.total}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {h.agentName} · {h.routing} · {new Date(h.at).toLocaleString()}
                      </span>
                      <div className="flex-1" />
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => exportEvalRun(h)}>
                        <FileDown size={12} />
                      </Button>
                    </div>
                  ))
                )}
              </Card>

              {/* The actual research question: did the prompt change help? */}
              {history.length >= 2 && (
                <Card className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <GitCompare size={13} className="text-primary" />
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Compare two runs
                    </Label>
                    <div className="flex-1" />
                    {comparison && (
                      <Button variant="outline" size="sm" onClick={() => exportEvalComparison(comparison)}>
                        <FileDown size={13} className="mr-1" /> Export
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs max-w-[45%]"
                      value={beforeId}
                      onChange={(e) => setBeforeId(e.target.value)}
                    >
                      {history.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.passed}/{h.total} · {new Date(h.at).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <ArrowRight size={13} className="text-muted-foreground shrink-0" />
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs max-w-[45%]"
                      value={afterId}
                      onChange={(e) => setAfterId(e.target.value)}
                    >
                      {history.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.passed}/{h.total} · {new Date(h.at).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!comparison ? (
                    <p className="text-[10px] text-muted-foreground">
                      Pick two different runs to compare.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {comparison.scoreDelta > 0 ? (
                          <TrendingUp size={14} className="text-primary" />
                        ) : comparison.scoreDelta < 0 ? (
                          <TrendingDown size={14} className="text-destructive" />
                        ) : (
                          <Minus size={14} className="text-muted-foreground" />
                        )}
                        <span className="font-mono text-sm">
                          {comparison.scoreDelta > 0 ? "+" : ""}{comparison.scoreDelta} case
                          {Math.abs(comparison.scoreDelta) === 1 ? "" : "s"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {comparison.fixed} fixed · {comparison.regressed} regressed ·{" "}
                          {comparison.cases.length} compared
                        </span>
                      </div>

                      <p className="text-[10px] text-muted-foreground">
                        {comparison.promptChanged ? (
                          <>
                            System prompt changed — roughly {comparison.promptDiff.added} char(s) added,{" "}
                            {comparison.promptDiff.removed} removed (summary, not a patch).
                          </>
                        ) : (
                          <>
                            System prompt identical in both runs — any change here is model
                            non-determinism, not the prompt.
                          </>
                        )}
                      </p>

                      {comparison.unmatched.length > 0 && (
                        <p className="text-[10px] text-destructive">
                          ⚠ {comparison.unmatched.length} case(s) exist in only one run (the suite was
                          edited between them) and are excluded from the numbers above.
                        </p>
                      )}

                      {comparison.cases.filter((c) => c.delta === "fixed" || c.delta === "regressed").length === 0 ? (
                        <p className="text-[10px] text-muted-foreground">
                          No case changed outcome between these runs.
                        </p>
                      ) : (
                        comparison.cases
                          .filter((c) => c.delta === "fixed" || c.delta === "regressed")
                          .map((c) => (
                            <div key={c.caseId} className="flex items-center gap-2 border-t border-border pt-2 text-[11px]">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] gap-1 shrink-0",
                                  c.delta === "fixed" ? "text-primary" : "text-destructive",
                                )}
                              >
                                {c.delta === "fixed" ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                                {c.delta}
                              </Badge>
                              <span className="truncate text-muted-foreground">
                                {c.prompt.replace(/\n/g, " ")}
                              </span>
                            </div>
                          ))
                      )}
                    </>
                  )}
                </Card>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
