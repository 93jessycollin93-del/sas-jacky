import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Jackie's left-menu navigation, grouped into collapsible sections so the
 * growing tool list stays scannable. Every destination that used to live in
 * the flat list is still here — plus The PC sections at the top, which
 * deep-link into the embedded Visual Computer (/pc?app=<pc-app-id>).
 *
 * The PC ships whole under /public/pc-os/ and is framed by /pc (PCDesktop).
 * The four PC groups lead the menu: the desktop itself + the App Commander,
 * then AI & Agents, Data & Ops, and Studio & Research deep links. Every
 * app id below is verified present in the embedded build, so no link is dead.
 */

interface NavItem {
  label: string;
  href: string;
  title?: string;
  external?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "pc",
    label: "The PC",
    items: [
      { label: "🖥️ The PC · Visual Computer", href: "/pc", title: "The whole PC — 90+ apps, windows, ink gestures — embedded with nothing compromised" },
      { label: "👁️ eYe App Commander", href: "/app-commander.html", title: "Fleet command center — live GPU/thermal, routing tier, AES-GCM vault, collapse pipeline", external: true },
      { label: "📡 Jacky Live · Real Engine", href: "/jacky-live", title: "Live RTX-3090 telemetry, situation-aware routing and squad dispatch from the real jacky engine" },
      { label: "🧭 JACKY v3 (in PC)", href: "/pc?app=jacky", title: "Open the PC with JACKY v3 running" },
      { label: "⌨️ ai-term Console", href: "/pc?app=aiterm", title: "Open the PC with the ai-term console running" },
      { label: "🛡️ PC Security Center", href: "/pc?app=security_center", title: "Open the PC with the Security Center running" },
      { label: "🧬 qpdb Matrix", href: "/pc?app=qpdb", title: "Open the PC with the qpdb Matrix running" },
    ],
  },
  {
    id: "pc-ai",
    label: "PC · AI & Agents",
    items: [
      { label: "🔀 Model Router", href: "/pc?app=model_router" },
      { label: "🧠 On-Device Models", href: "/pc?app=ondevice_models" },
      { label: "📎 Claude Assistant", href: "/pc?app=claude_assistant" },
      { label: "⚡ Grok Terminal", href: "/pc?app=grok_terminal" },
      { label: "📜 Codex", href: "/pc?app=codex" },
      { label: "🛠️ Agent Builder", href: "/pc?app=agent_builder" },
      { label: "🐝 Small Agent Fleet", href: "/pc?app=small_agent_fleet" },
      { label: "🌐 LLM Environment", href: "/pc?app=llm_environment" },
      { label: "🔗 LangChain", href: "/pc?app=langchain" },
      { label: "🦙 Ollama", href: "/pc?app=ollama" },
      { label: "🦅 OpenClaw", href: "/pc?app=openclaw" },
    ],
  },
  {
    id: "pc-data",
    label: "PC · Data & Ops",
    items: [
      { label: "💾 Data Pods", href: "/pc?app=data_pods" },
      { label: "🗜️ Knowledge Compressor", href: "/pc?app=knowledge_compressor" },
      { label: "📦 Archiver", href: "/pc?app=archiver" },
      { label: "💬 Chat History & Share", href: "/pc?app=chat_history_share" },
      { label: "🗺️ Fleet Atlas", href: "/pc?app=fleet_atlas" },
      { label: "☁️ Cloud Infrastructure", href: "/pc?app=cloud_infrastructure" },
      { label: "⚙️ Automation", href: "/pc?app=automation" },
      { label: "🔔 Notification Center", href: "/pc?app=notification_center" },
      { label: "🗝️ API Keys", href: "/pc?app=api_keys" },
      { label: "🎛️ System Settings", href: "/pc?app=system_settings" },
      { label: "🐙 GitHub Sync", href: "/pc?app=github_sync" },
      { label: "🐇 CodeRabbit", href: "/pc?app=coderabbit" },
      { label: "📤 Cybernetic Export", href: "/pc?app=cybernetic_export" },
    ],
  },
  {
    id: "pc-studio",
    label: "PC · Studio & Research",
    items: [
      { label: "🎛️ SuperSayen Studio", href: "/pc?app=supersayen" },
      { label: "🌀 Blender", href: "/pc?app=blender" },
      { label: "🎮 Unreal Engine", href: "/pc?app=unreal" },
      { label: "📊 Slides", href: "/pc?app=slides" },
      { label: "📝 Notepad", href: "/pc?app=notepad" },
      { label: "✉️ Mail", href: "/pc?app=mail" },
      { label: "📁 Folders", href: "/pc?app=folder" },
      { label: "🎓 Semantic Scholar", href: "/pc?app=semantic_scholar" },
      { label: "🐰 Research Rabbit", href: "/pc?app=research_rabbit" },
      { label: "📄 Papers with Code", href: "/pc?app=papers_with_code" },
      { label: "♟️ Zenith Chess", href: "/pc?app=chess" },
      { label: "🐍 Snake", href: "/pc?app=snake" },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { label: "🧪 Agent R&D Lab", href: "/agent-lab", title: "Build agents on any provider, set a small or large context budget, run them for real, and export them as portable assets" },
      { label: "⚖️ Agent Compare", href: "/agent-compare", title: "Run one prompt across several agents side by side — measured latency, real outputs, exportable report" },
      { label: "🤖 Bot Foundry", href: "/bots" },
      { label: "🕸️ Bot Swarm", href: "/swarm" },
      { label: "🛰️ Control", href: "/control" },
      { label: "🔑 API Key Vault", href: "/keys" },
      { label: "🧠 AI Providers", href: "/providers", title: "Groq, OpenRouter, Ollama and more" },
    ],
  },
  {
    id: "games",
    label: "Games & Worlds",
    items: [
      { label: "⚔️ Play Game", href: "/play" },
      { label: "🐉 Realm Accord ↗", href: "https://dragon-chaos-wars.lovable.app", title: "Realm Accord — strategy game", external: true },
      { label: "🌐 Horizon Network ↗", href: "https://jadelounge.lovable.app", title: "Horizon Network — social network", external: true },
      { label: "👑 Emperors of the Last Kingdom ↗", href: "https://chaos-dragon-emperor.lovable.app", title: "Emperors of the Last Kingdom — fantasy strategy", external: true },
    ],
  },
  {
    id: "ops",
    label: "Ops & Intel",
    items: [
      { label: "🛡️ VeilOps Threat Intel", href: "/veilops", title: "VeilOps — factual threat intelligence reference (MITRE ATT&CK, CISA KEV, APT profiles)" },
      { label: "🛰️ Sentinel · Crypto Forensics", href: "/sentinel", title: "RugDNA Sentinel — synthetic crypto-forensics reference dashboard" },
      { label: "🏔 Apex Hub (placeholder)", href: "/apex", title: "Apex Intelligence Hub — reserved mount point" },
      { label: "🧊 eYe Pod Station", href: "/pods", title: "eYe Pod Station — 24 compression pods with SHA-256 integrity" },
    ],
  },
  {
    id: "labs",
    label: "Labs",
    items: [
      { label: "🧬 Microscopic Marvels Lab", href: "/marvels", title: "Microscopic Marvels — procedural cell-race simulation (virtual credits only)" },
      { label: "🧬 Visualizer Lab", href: "/eru/visualizers", title: "Shared visualizer primitives — vibe-coding lab" },
      { label: "🧪 Eru · AI Lab", href: "/eru/ailab" },
      { label: "🛰 Eru · Security", href: "/eru/admin/security", title: "Eru Security Command Center" },
      { label: "🤖 Eru · Bot Forge", href: "/eru/bot-forge" },
      { label: "🛍️ Eru · Bot Market", href: "/eru/bot-marketplace" },
      { label: "🐝 Eru · Swarm", href: "/eru/eru-swarm-test", title: "Eru Swarm test harness" },
      { label: "⚔️ Eru · Red Team", href: "/eru/eru-redteam-test", title: "Eru Red-team test harness" },
    ],
  },
];

const STORAGE_KEY = "jackie.sidebar.groups.v1";
const DEFAULT_OPEN: Record<string, boolean> = { pc: true, build: true };

const loadOpenState = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPEN, ...JSON.parse(raw) };
  } catch {
    /* corrupt state — use defaults */
  }
  return { ...DEFAULT_OPEN };
};

export function SidebarNav() {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      /* state just won't persist */
    }
  }, [openGroups]);

  const toggle = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <nav className="space-y-0.5">
      {NAV_GROUPS.map((group) => {
        const open = !!openGroups[group.id];
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={open}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {group.label}
              <span className="ml-auto text-[9px] text-muted-foreground/50">{group.items.length}</span>
            </button>
            {open && (
              <div className="space-y-0.5 pb-1">
                {group.items.map((item) =>
                  item.external ? (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 pl-5 pr-2 py-1.5 font-mono text-xs text-primary hover:bg-secondary/50 rounded-sm transition-colors"
                      title={item.title}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      to={item.href}
                      className="flex items-center gap-2 pl-5 pr-2 py-1.5 font-mono text-xs text-primary hover:bg-secondary/50 rounded-sm transition-colors"
                      title={item.title}
                    >
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
