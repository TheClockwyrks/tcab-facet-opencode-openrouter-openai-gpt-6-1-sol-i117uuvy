import type { Game } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import type { AssetLibrary } from "./assets";
import { loadAssets, updateAudio } from "./assets";
import { debug, snapshot } from "./debug";
import { initialState, advance } from "./rules";
import { action, pointerEvent } from "./controls";
import { drawGame } from "./render";
import * as C from "./constants";

export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";
export type Cut = "plain" | "brilliant" | "star" | "prism";
export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";
export type Phase = "idle" | "swapping" | "resolving";
export type PointerDevice = "mouse" | "pen" | "touch";
export interface CellRef {
  readonly col: number;
  readonly row: number;
}
export interface GemState {
  readonly col: number;
  readonly row: number;
  readonly kind: GemKind | null;
  readonly cut: Cut;
  readonly strain: number;
  readonly fell: number;
}
export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly GemState[];
}
export interface RefusalState {
  readonly a: CellRef;
  readonly b: CellRef;
  readonly timer: number;
}
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}
/** Derived transition history: exchanged coordinates for seeding/cut placement,
 * and the previous board and clear waves for drawing the journey between boards.
 */
export interface Presentation {
  readonly swap: readonly [CellRef, CellRef] | null;
  readonly prismKind: GemKind | "all" | null;
  readonly before: readonly GemState[];
  readonly cleared: readonly {
    readonly gem: GemState;
    readonly wave: number;
  }[];
  readonly created: readonly CellRef[];
  readonly dealTime: number;
}
export interface FacetState {
  readonly screen: Screen;
  readonly menuIndex: number;
  readonly board: BoardState;
  readonly phase: Phase;
  readonly chainStep: number;
  readonly swapTimer: number;
  readonly stepTimer: number;
  readonly score: number;
  readonly level: number;
  readonly levelScore: number;
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;
  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;
  readonly selection: CellRef | null;
  readonly offer: CellRef | null;
  readonly refusal: RefusalState | null;
  readonly armedTarget: string | null;
  readonly pointer: PointerState;
  readonly simTime: number;
  readonly muted: boolean;
  readonly refillKinds: readonly string[];
  readonly presentation?: Presentation;
  readonly assets?: AssetLibrary;
}
export type ReadState = DeepReadonly<FacetState>;
export interface Target {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface FacetDebugApi {
  readonly version: number;
  reset(s: ReadState): FacetState;
  reconcile(s: ReadState): FacetState;
  snapshot(s: ReadState): ReturnType<typeof snapshot>;
  setScreen(s: ReadState, screen: Screen): FacetState;
  setMenuIndex(s: ReadState, index: number): FacetState;
  loadBoard(s: ReadState, rows: readonly string[]): FacetState;
  dealBoard(s: ReadState): FacetState;
  clearBoard(s: ReadState): FacetState;
  setGem(s: ReadState, col: number, row: number, token: string): FacetState;
  setRefillKinds(s: ReadState, col: number, kinds: string): FacetState;
  clearRefillKinds(s: ReadState): FacetState;
  setScore(s: ReadState, points: number): FacetState;
  setLevel(s: ReadState, level: number): FacetState;
  setLevelScore(s: ReadState, points: number): FacetState;
  setBestChain(s: ReadState, chainStep: number): FacetState;
  setBestMove(s: ReadState, points: number): FacetState;
  setMoveScore(s: ReadState, points: number): FacetState;
  setSelection(s: ReadState, col: number, row: number): FacetState;
  clearSelection(s: ReadState): FacetState;
  setOffer(s: ReadState, col: number, row: number): FacetState;
  clearOffer(s: ReadState): FacetState;
  clearRefusal(s: ReadState): FacetState;
  clearChain(s: ReadState): FacetState;
  requestSwap(
    s: ReadState,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): FacetState;
  pointerDown(
    s: ReadState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerMove(
    s: ReadState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerUp(s: ReadState, device?: PointerDevice): FacetState;
}

export const BACKGROUND = "#0a151b";

export const game: Game<FacetState, FacetDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    for (const name of [
      "screen",
      "phase",
      "score",
      "level",
      "chainStep",
      "lastCleared",
      "lastPoints",
      "lastWaves",
      "bestMove",
      "bestChain",
    ] as const) {
      api.diagnostics.register(name, (s) => s[name]);
    }
    api.diagnostics.register(
      "board",
      (s) => `${s.board.cols} × ${s.board.rows}`,
    );
    api.diagnostics.register(
      "levelScore",
      (s) => `${s.levelScore} / ${s.level * C.LEVEL_TARGET_STEP}`,
    );
    for (const name of ["multiplier", "lastFall", "legalSwap"] as const)
      api.diagnostics.register(name, (s) => snapshot(s)[name]);
    for (const name of ["selection", "offer"] as const)
      api.diagnostics.register(name, (s) =>
        s[name] ? `${s[name].col},${s[name].row}` : "—",
      );
    api.diagnostics.register(
      "pointer",
      (s) =>
        `${s.pointer.x.toFixed(0)},${s.pointer.y.toFixed(0)} ${s.pointer.device}`,
    );
    const assets = await loadAssets(api);
    return [{ ...initialState(), assets }, debug];
  },
  update(state, api, dt) {
    const cues = new Set<string>();
    let next: FacetState = { ...state, simTime: state.simTime + dt };
    for (const name of C.ACTIONS) {
      if (api.input.pressed(name)) {
        if (name === "mute") api.audio.setMuted(!api.audio.muted());
        else next = action(next, name);
      }
    }
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary) continue;
      const previous = next;
      next = pointerEvent(next, sample.type, sample.x, sample.y, sample.device);
      if (
        next.selection &&
        (next.selection.col !== previous.selection?.col ||
          next.selection.row !== previous.selection?.row)
      )
        cues.add(C.CUES.select);
      if (next.phase === "swapping" && previous.phase !== "swapping")
        cues.add(C.CUES.swap);
      if (next.refusal !== previous.refusal && next.refusal)
        cues.add(C.CUES.refuse);
    }
    const { x, y, down, device } = api.input.pointer();
    next = {
      ...next,
      pointer: { x, y, down, device },
      muted: api.audio.muted(),
    };
    next = advance(next, dt, cues);
    updateAudio(next, api, cues);
    return next;
  },
  render: drawGame,
};
