import * as C from "./constants";
import type { FacetDebugApi, GemState, ReadState, Screen } from "./game";
import {
  cellX,
  cellY,
  deal,
  emptyBoard,
  initialState,
  lastFall,
  legalSwap,
  letters,
  parseGem,
  requestSwap,
  stepHold,
} from "./rules";
import { pointerEvent, targets } from "./controls";

function integer(n: number, min = 0, max = Infinity): number {
  if (!Number.isInteger(n) || n < min || n > max)
    throw new RangeError(`Out of domain: ${n}`);
  return n;
}
function point(col: number, row: number) {
  return {
    col: integer(col, 0, C.GRID_COLS - 1),
    row: integer(row, 0, C.GRID_ROWS - 1),
  };
}
function finite(n: number) {
  if (!Number.isFinite(n)) throw new RangeError("Expected a finite number");
  return n;
}
const screens: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "levelclear",
  "gameover",
];
export function snapshot(s: ReadState) {
  return {
    version: C.FACET_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    score: s.score,
    level: s.level,
    levelScore: s.levelScore,
    levelTarget: C.LEVEL_TARGET_STEP * s.level,
    phase: s.phase,
    chainStep: s.chainStep,
    multiplier: Math.min(s.chainStep, C.MAX_MULTIPLIER),
    swapTimer: s.swapTimer,
    stepTimer: s.stepTimer,
    stepHold: stepHold(s),
    board: {
      cols: s.board.cols,
      rows: s.board.rows,
      cells: s.board.cells.map((g) => ({
        ...g,
        x: cellX(g.col),
        y: cellY(g.row),
      })),
    },
    selection: s.selection ? { ...s.selection } : null,
    offer: s.offer ? { ...s.offer } : null,
    refusal: s.refusal
      ? { a: { ...s.refusal.a }, b: { ...s.refusal.b } }
      : null,
    lastCleared: s.lastCleared,
    lastPoints: s.lastPoints,
    lastWaves: s.lastWaves,
    lastFall: lastFall(s),
    moveScore: s.moveScore,
    bestMove: s.bestMove,
    bestChain: s.bestChain,
    legalSwap: legalSwap(s.board),
    refillKinds: [...s.refillKinds],
    pointer: { ...s.pointer },
    armedTarget: s.armedTarget,
    targets: targets(s),
    muted: s.muted,
    simTime: s.simTime,
  };
}
export const debug: FacetDebugApi = {
  version: C.FACET_DEBUG_VERSION,
  reset: (s) => ({ ...initialState(), assets: s.assets, muted: s.muted }),
  reconcile: (s) => ({ ...s }),
  snapshot,
  setScreen(s, screen) {
    if (!screens.includes(screen))
      throw new RangeError(`Unknown screen: ${screen}`);
    return { ...s, screen };
  },
  setMenuIndex: (s, index) => ({ ...s, menuIndex: integer(index) }),
  loadBoard(s, rows) {
    if (rows.length !== C.GRID_ROWS)
      throw new RangeError("Expected eight rows");
    const cells: GemState[] = rows.flatMap((line, row) => {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length !== C.GRID_COLS)
        throw new RangeError("Expected eight cells");
      return tokens.map((t, col) => parseGem(t, col, row));
    });
    return { ...s, board: { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells } };
  },
  dealBoard: (s) => ({
    ...s,
    board: deal(),
    presentation: {
      swap: null,
      prismKind: null,
      before: [],
      cleared: [],
      created: [],
      dealTime: 0,
    },
  }),
  clearBoard: (s) => ({ ...s, board: emptyBoard() }),
  setGem(s, col, row, token) {
    point(col, row);
    if (!s.board.cells[row * C.GRID_COLS + col])
      throw new RangeError("No board in play");
    const gem = parseGem(token, col, row);
    return {
      ...s,
      board: {
        ...s.board,
        cells: s.board.cells.map((g) =>
          g.col === col && g.row === row ? gem : g,
        ),
      },
    };
  },
  setRefillKinds(s, col, kinds) {
    integer(col, 0, C.GRID_COLS - 1);
    if ([...kinds].some((k) => !letters.includes(k)))
      throw new RangeError("Invalid refill kind");
    return {
      ...s,
      refillKinds: s.refillKinds.map((k, i) => (i === col ? kinds : k)),
    };
  },
  clearRefillKinds: (s) => ({
    ...s,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  }),
  setScore: (s, points) => ({ ...s, score: finite(points) }),
  setLevel: (s, level) => ({ ...s, level: integer(level, 1) }),
  setLevelScore: (s, points) => ({ ...s, levelScore: finite(points) }),
  setBestChain: (s, chainStep) => ({ ...s, bestChain: integer(chainStep) }),
  setBestMove: (s, points) => ({ ...s, bestMove: finite(points) }),
  setMoveScore: (s, points) => ({ ...s, moveScore: finite(points) }),
  setSelection: (s, col, row) => ({ ...s, selection: point(col, row) }),
  clearSelection: (s) => ({ ...s, selection: null }),
  setOffer: (s, col, row) => ({ ...s, offer: point(col, row) }),
  clearOffer: (s) => ({ ...s, offer: null }),
  clearRefusal: (s) => ({ ...s, refusal: null }),
  clearChain: (s) => ({
    ...s,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
  }),
  requestSwap: (s, ca, ra, cb, rb) =>
    requestSwap(s, point(ca, ra), point(cb, rb)),
  pointerDown: (s, x, y, device = "mouse") =>
    pointerEvent(s, "down", finite(x), finite(y), validDevice(device)),
  pointerMove: (s, x, y, device = "mouse") =>
    pointerEvent(s, "move", finite(x), finite(y), validDevice(device)),
  pointerUp: (s, device = "mouse") =>
    pointerEvent(s, "up", s.pointer.x, s.pointer.y, validDevice(device)),
};
function validDevice(device: "mouse" | "pen" | "touch") {
  if (!["mouse", "pen", "touch"].includes(device))
    throw new RangeError("Invalid pointer device");
  return device;
}
