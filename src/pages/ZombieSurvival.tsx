import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, RotateCw, Skull } from "lucide-react";

/**
 * Zombie Survival — the third-person survival game, embedded whole.
 *
 * The game's production build ships untouched under /public/zombie-survival/
 * (its own React and Three.js runtime, saves in this origin's IndexedDB, no
 * backend), so nothing about it is compromised. This page frames it inside
 * Jackie with a slim header, the same way /pc frames the Visual Computer.
 *
 * Source: 93jessycollin93-del/eru, folder zombie-survival-game/ (see
 * docs/zombie-survival.md for how to update the embedded build).
 */
const SRC = "/zombie-survival/index.html";

const ZombieSurvival = () => {
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-sidebar flex-shrink-0">
        <Link
          to="/"
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Back to Jackie"
        >
          <ArrowLeft size={14} />
          Jackie
        </Link>
        <div className="flex items-center gap-2">
          <Skull size={14} className="text-primary" />
          <span className="font-mono text-xs uppercase tracking-widest text-foreground">Zombie Survival</span>
        </div>
        <div className="flex-1" />
        {!loaded && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">building the town…</span>}
        <button
          type="button"
          onClick={() => {
            setLoaded(false);
            setReloadKey((k) => k + 1);
          }}
          className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Reload the game (your saves are kept)"
        >
          <RotateCw size={14} />
        </button>
        <a
          href={SRC}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Open the game in its own tab"
        >
          <ExternalLink size={14} />
        </a>
      </header>
      <iframe
        ref={frame}
        key={reloadKey}
        src={SRC}
        title="Zombie Survival"
        className="flex-1 w-full border-0 bg-black"
        // Not sandboxed, so mouse look (pointer lock) works; keyboard needs focus inside the frame.
        allow="fullscreen; gamepad; autoplay"
        onLoad={() => {
          setLoaded(true);
          frame.current?.focus();
        }}
      />
    </div>
  );
};

export default ZombieSurvival;
