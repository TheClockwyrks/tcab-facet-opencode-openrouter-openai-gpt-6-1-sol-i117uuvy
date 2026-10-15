# Facet

**Pressure finds the flaw.** A self-contained browser puzzle about matching cut stones, building strain, and turning a small clear into a beautiful chain reaction.

Swap neighboring gems to make lines of three or more. Every clear strains the stones beside it. After three hits a stone becomes flawed: it joins any touching clear and scores double. Four in a line earns a brilliant; crossed lines earn a star; five or more earn a kindless prism. Reach the level target to advance. A round ends when no legal swap remains.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. For a production build:

```sh
npm run build
npm run preview
```

`dist/` is the complete static site. Serve it from any static host, at its root or a sub-path. It makes no external requests and needs no backend.

## Controls

- **Mouse, pen, or touch:** press a stone, drag onto its neighbor, and release. Or tap a stone, then tap its neighbor. Bringing a held stone back withdraws the offer.
- **Menus:** click/tap the buttons, or use **↑ / ↓** and **Enter / Space**.
- **Pause/resume:** **Esc / P**, or the **PAUSE** button.
- **Back:** **Esc**, or **BACK** on the field guide.
- **Sound:** **M** toggles all music and effects. Audio unlocks on the first interaction.
- **Diagnostics:** backtick toggles the engine’s read-only overlay.

## Original media

All finished assets live in `public/assets/` and are included in the repository:

- Pixel-cut gem artwork in all four strain states, brilliant/star overlays, a bench frame, seven six-frame shatter sequences, and a twelve-frame prism turn.
- Four authored live particle systems: clear, flawed detonation, cut flash, and continuous cut aura.
- Eight event sounds, an eight-note ascending chain ladder, layered sampled glass, and two original sequenced music pieces with portable MIDI scores.

`tools/produce_assets.py` is the one-time production recipe, using `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, and `music`. Those authoring tools are only needed to reproduce or revise the media; **installation and builds never invoke them**.

## Code and verification

The Simple 2D engine owns the frame loop, logical-stage fitting, input, loading, audio, diagnostics, and recording. The game’s immutable state, match resolution, pressure closure, timing, controls, and debug poses are in `src/`. Particle systems are evaluated with the supplied particle runtime. The simulation is render-independent and consumes elapsed time across every crossed swap/chain boundary.

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests exercise the rules, minimum-wave closure, cut precedence, gravity, scoring, frame partitioning, menus, pointer gestures, debug poses, and an engine running over a real Node canvas with the shipped media. Browser captures in `showcase/` include an engine-recorded live replay. `tools/capture.mjs` reproduces the showcase against the development server; `tools/browser-check.mjs` checks the built site at a sub-path and multiple viewport sizes.
