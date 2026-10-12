# Zombie Survival (embedded game)

Left menu → **Games & Worlds → 🧟 Zombie Survival** opens `/zombie-survival`, which frames the
game's production build from `public/zombie-survival/` (like `/pc` frames `public/pc-os/`).

- **Source:** `93jessycollin93-del/eru`, folder `zombie-survival-game/` (Vite + React + TypeScript +
  Three.js). Its `HANDOFF.md` describes the project; game rules live in `src/sim/` there.
- **No backend.** The game talks to nothing: saves go to this origin's IndexedDB (database
  `zombie-survival`), settings to `localStorage`. It does not use Supabase or Base44.
- **Self-contained.** Its own React and Three.js runtime, relative asset paths, so the folder can
  move anywhere. The service worker precaches it like the rest of `dist/`.

## Updating the embedded build

From the game's folder in the eru repo:

```sh
npx vite build --base ./ --outDir <path-to-sas-jacky>/public/zombie-survival --emptyOutDir
```

Commit the whole `public/zombie-survival/` folder (old hashed assets are removed by `--emptyOutDir`).
