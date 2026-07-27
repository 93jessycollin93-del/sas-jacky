import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { suggestRoutes } from "@/lib/routeManifest";
import { toast } from "@/hooks/use-toast";

const NotFound = () => {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  const suggestions = useMemo(() => suggestRoutes(location.pathname), [location.pathname]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.warn("[router] no route matched:", location.pathname, {
      suggestions: suggestions.map((s) => s.path),
    });
  }, [location.pathname, suggestions]);

  /** Plain-text report: the path that failed plus the nearest valid routes. */
  const report = useMemo(
    () =>
      [
        "Jackie routing issue",
        `Requested path: ${path}`,
        `Referrer: ${document.referrer || "(direct)"}`,
        `When: ${new Date().toISOString()}`,
        "Nearest routes:",
        ...suggestions.map((s) => `  - ${s.path} (${s.label})`),
      ].join("\n"),
    [path, suggestions],
  );

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      toast({
        title: "Route report copied",
        description: "Requested path and nearest routes are on your clipboard.",
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Clipboard access was blocked — select the path manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            404 · route not found
          </p>
          <h1 className="text-2xl font-semibold text-foreground">No module lives here</h1>
          <p className="text-sm text-muted-foreground">
            Requested path:{" "}
            <code className="font-mono text-foreground break-all">{path}</code>
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Closest module routes
            </p>
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.path}>
                  <Link
                    to={s.path}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <span>{s.label}</span>
                    <code className="font-mono text-xs text-muted-foreground">{s.path}</code>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Back to Jackie
          </Link>
          <button
            type="button"
            onClick={copyReport}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy route report"}
          </button>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
