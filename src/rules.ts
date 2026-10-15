import * as C from "./constants";
import type {
  BoardState,
  CellRef,
  Cut,
  FacetState,
  GemKind,
  GemState,
  ReadState,
} from "./game";

export const letters = "RACJBSM";
export const cellX = (col: number) =>
  C.BOARD_CX - ((C.GRID_COLS - 1) * C.CELL_PITCH) / 2 + col * C.CELL_PITCH;
export const cellY = (row: number) =>
  C.BOARD_CY - ((C.GRID_ROWS - 1) * C.CELL_PITCH) / 2 + row * C.CELL_PITCH;
export const indexOf = (p: CellRef) => p.row * C.GRID_COLS + p.col;
export const adjacent = (a: CellRef, b: CellRef) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
export const same = (a: CellRef | null, b: CellRef | null) =>
  a !== null && b !== null && a.col === b.col && a.row === b.row;
export const emptyBoard = (): BoardState => ({ cols: 0, rows: 0, cells: [] });
export const randomKind = (): GemKind =>
  C.GEM_KINDS[Math.floor(Math.random() * C.GEM_KIND_COUNT)];
export const lastFall = (s: ReadState) =>
  Math.max(0, ...s.board.cells.map((g) => g.fell));
export const stepHold = (s: ReadState) =>
  s.lastWaves * C.WAVE_SECONDS +
  lastFall(s) * C.FALL_SECONDS_PER_ROW +
  C.STEP_SECONDS;

export function initialState(): FacetState {
  return {
    screen: "title",
    menuIndex: 0,
    board: emptyBoard(),
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    score: 0,
    level: 1,
    levelScore: 0,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    pointer: { x: 0, y: 0, down: false, device: "mouse" },
    simTime: 0,
    muted: false,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  };
}

export function parseGem(token: string, col: number, row: number): GemState {
  const match = /^([RACJBSMX])([0-3])([bs]?)$/.exec(token);
  if (!match || (match[1] === "X" && match[3]))
    throw new RangeError(`Invalid gem token: ${token}`);
  return {
    col,
    row,
    kind: match[1] === "X" ? null : C.GEM_KINDS[letters.indexOf(match[1])],
    strain: Number(match[2]),
    cut:
      match[1] === "X"
        ? "prism"
        : match[3] === "b"
          ? "brilliant"
          : match[3] === "s"
            ? "star"
            : "plain",
    fell: 0,
  };
}

export interface Run {
  readonly cells: readonly number[];
  readonly horizontal: boolean;
}
export function findRuns(board: BoardState): Run[] {
  const runs: Run[] = [];
  for (const horizontal of [true, false]) {
    const outer = horizontal ? board.rows : board.cols;
    const inner = horizontal ? board.cols : board.rows;
    for (let line = 0; line < outer; line++) {
      let start = 0;
      const ix = (n: number) =>
        horizontal ? line * board.cols + n : n * board.cols + line;
      while (start < inner) {
        const kind = board.cells[ix(start)]?.kind;
        let end = start + 1;
        while (
          kind != null &&
          end < inner &&
          board.cells[ix(end)]?.kind === kind
        )
          end++;
        if (kind != null && end - start >= C.MATCH_MIN)
          runs.push({
            cells: Array.from({ length: end - start }, (_, n) => ix(start + n)),
            horizontal,
          });
        start = end;
      }
    }
  }
  return runs;
}

export function exchanged(
  board: BoardState,
  a: CellRef,
  b: CellRef,
): BoardState {
  const ai = indexOf(a),
    bi = indexOf(b);
  return {
    ...board,
    cells: board.cells.map((g, i) =>
      i === ai
        ? { ...board.cells[bi], col: a.col, row: a.row, fell: 0 }
        : i === bi
          ? { ...board.cells[ai], col: b.col, row: b.row, fell: 0 }
          : g,
    ),
  };
}
export function productive(board: BoardState, a: CellRef, b: CellRef): boolean {
  if (!board.cells[indexOf(a)] || !board.cells[indexOf(b)] || !adjacent(a, b))
    return false;
  return (
    board.cells[indexOf(a)].cut === "prism" ||
    board.cells[indexOf(b)].cut === "prism" ||
    findRuns(exchanged(board, a, b)).length > 0
  );
}
export function legalSwap(board: BoardState): boolean {
  return board.cells.some(
    (g) =>
      (g.col + 1 < board.cols &&
        productive(board, g, { col: g.col + 1, row: g.row })) ||
      (g.row + 1 < board.rows &&
        productive(board, g, { col: g.col, row: g.row + 1 })),
  );
}
export function deal(): BoardState {
  for (;;) {
    const cells: GemState[] = [];
    for (let row = 0; row < C.GRID_ROWS; row++)
      for (let col = 0; col < C.GRID_COLS; col++) {
        let kind: GemKind;
        do {
          kind = randomKind();
        } while (
          (col >= 2 &&
            cells[cells.length - 1].kind === kind &&
            cells[cells.length - 2].kind === kind) ||
          (row >= 2 &&
            cells[(row - 1) * C.GRID_COLS + col].kind === kind &&
            cells[(row - 2) * C.GRID_COLS + col].kind === kind)
        );
        cells.push({ col, row, kind, cut: "plain", strain: 0, fell: row + 1 });
      }
    const board = { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells };
    if (legalSwap(board)) return board;
  }
}

export function requestSwap(s: ReadState, a: CellRef, b: CellRef): FacetState {
  if (s.phase !== "idle" || !productive(s.board, a, b))
    return { ...s, refusal: { a, b, timer: 0 } };
  const ag = s.board.cells[indexOf(a)],
    bg = s.board.cells[indexOf(b)];
  const prismKind =
    ag.cut === "prism" && bg.cut === "prism"
      ? "all"
      : ag.cut === "prism"
        ? bg.kind
        : bg.cut === "prism"
          ? ag.kind
          : null;
  return {
    ...s,
    board: exchanged(s.board, a, b),
    phase: "swapping",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    moveScore: 0,
    refusal: null,
    presentation: {
      swap: [a, b],
      prismKind,
      before: s.board.cells,
      cleared: [],
      created: [],
      dealTime: 1,
    },
  };
}

function neighbors(i: number, diagonal = false): number[] {
  const col = i % C.GRID_COLS,
    row = Math.floor(i / C.GRID_COLS),
    out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (
        (diagonal ? dx || dy : Math.abs(dx) + Math.abs(dy) === 1) &&
        col + dx >= 0 &&
        col + dx < C.GRID_COLS &&
        row + dy >= 0 &&
        row + dy < C.GRID_ROWS
      )
        out.push((row + dy) * C.GRID_COLS + col + dx);
  return out;
}

export function resolveStep(
  s: ReadState,
  cues: Set<string> = new Set(),
): FacetState {
  const runs =
    s.chainStep === 1 && s.presentation?.prismKind ? [] : findRuns(s.board);
  const prism = s.chainStep === 1 ? s.presentation?.prismKind : null;
  const seed = prism
    ? s.board.cells.flatMap((g, i) =>
        prism === "all" ||
        g.kind === prism ||
        (g.cut === "prism" && s.presentation?.swap?.some((p) => same(p, g)))
          ? [i]
          : [],
      )
    : runs.flatMap((r) => r.cells);
  const waves = new Map<number, number>();
  const queue: number[] = [];
  for (const i of seed)
    if (!waves.has(i)) {
      waves.set(i, 0);
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      gem = s.board.cells[i],
      w = waves.get(i)!;
    const additions = neighbors(i).filter(
      (n) => s.board.cells[n].strain === C.MAX_STRAIN,
    );
    if (gem.cut === "brilliant") additions.push(...neighbors(i, true));
    if (gem.cut === "star")
      s.board.cells.forEach((g, n) => {
        if (g.col === gem.col || g.row === gem.row) additions.push(n);
      });
    for (const n of additions)
      if (!waves.has(n)) {
        waves.set(n, w + 1);
        queue.push(n);
      }
  }
  const creations = new Map<number, Cut>();
  const rank = { plain: 0, brilliant: 1, star: 2, prism: 3 };
  const create = (i: number, cut: Cut) => {
    if (rank[cut] > rank[creations.get(i) ?? "plain"]) creations.set(i, cut);
  };
  for (const run of runs) {
    if (run.cells.length >= C.MATCH_MIN + 1) {
      const swapped = run.cells.filter((i) =>
        s.presentation?.swap?.some((p) => indexOf(p) === i),
      );
      create(
        swapped[0] ?? run.cells[Math.floor((run.cells.length - 1) / 2)],
        run.cells.length >= C.MATCH_MIN + 2 ? "prism" : "brilliant",
      );
    }
    for (const other of runs)
      if (run.horizontal !== other.horizontal)
        for (const i of run.cells)
          if (other.cells.includes(i)) create(i, "star");
  }
  let points = 0;
  const remaining: (GemState | null)[] = s.board.cells.map((g, i) => {
    if (waves.has(i)) {
      points +=
        (g.strain === C.MAX_STRAIN ? C.FLAWED_SCORE : C.BASE_SCORE) *
        Math.min(s.chainStep, C.MAX_MULTIPLIER);
      return null;
    }
    const strain = Math.min(
      C.MAX_STRAIN,
      g.strain + (neighbors(i).some((n) => waves.has(n)) ? 1 : 0),
    );
    if (strain === C.MAX_STRAIN && g.strain < strain) cues.add(C.CUES.flaw);
    return { ...g, strain, fell: 0 };
  });
  for (const [i, cut] of creations)
    remaining[i] = {
      ...s.board.cells[i],
      cut,
      kind: cut === "prism" ? null : s.board.cells[i].kind,
      strain: 0,
      fell: 0,
    };
  const cells: GemState[] = [];
  for (let col = 0; col < C.GRID_COLS; col++) {
    const survivors = remaining.filter(
      (g): g is GemState => g !== null && g.col === col,
    );
    for (let row = C.GRID_ROWS - 1; row >= 0; row--) {
      const gem = survivors.pop();
      const posed = s.refillKinds[col]?.[row];
      cells[row * C.GRID_COLS + col] = gem
        ? { ...gem, row, fell: row - gem.row }
        : {
            col,
            row,
            kind: posed ? C.GEM_KINDS[letters.indexOf(posed)] : randomKind(),
            strain: 0,
            cut: "plain",
            fell: row + 1,
          };
    }
  }
  cues.add(C.CUES.clear);
  // A coarse frame may cross several steps and settle the chain. Keep the last
  // rung fired by this frame, rather than inferring it from the resting state.
  for (const cue of cues) if (cue.startsWith("chain-")) cues.delete(cue);
  cues.add(`chain-${Math.min(s.chainStep, C.MAX_MULTIPLIER)}`);
  if (creations.size) cues.add(C.CUES.cut);
  return {
    ...s,
    board: { ...s.board, cells },
    score: s.score + points,
    levelScore: s.levelScore + points,
    moveScore: s.moveScore + points,
    bestChain: Math.max(s.bestChain, s.chainStep),
    lastCleared: waves.size,
    lastPoints: points,
    lastWaves: Math.max(0, ...waves.values()),
    stepTimer: 0,
    presentation: {
      swap: s.presentation?.swap ?? null,
      prismKind: null,
      before: s.board.cells,
      cleared: [...waves].map(([i, wave]) => ({ gem: s.board.cells[i], wave })),
      created: [...creations.keys()].map((i) => s.board.cells[i]),
      dealTime: 1,
    },
  };
}

/** Consume every crossed boundary; leftover time belongs to the following step. */
export function advance(
  state: ReadState,
  dt: number,
  cues: Set<string> = new Set(),
): FacetState {
  if (state.screen !== "playing") return { ...state };
  let s: FacetState = { ...state };
  if (s.refusal)
    s = {
      ...s,
      refusal:
        s.refusal.timer + dt >= C.REFUSAL_SECONDS
          ? null
          : { ...s.refusal, timer: s.refusal.timer + dt },
    };
  if (s.presentation)
    s = {
      ...s,
      presentation: {
        ...s.presentation,
        dealTime: s.presentation.dealTime + dt,
      },
    };
  let remaining = dt;
  while (s.screen === "playing" && s.phase !== "idle") {
    const swapping = s.phase === "swapping";
    const timer = swapping ? s.swapTimer : s.stepTimer;
    const hold = swapping ? C.SWAP_SECONDS : stepHold(s);
    const used = Math.min(remaining, Math.max(0, hold - timer));
    if (!swapping) {
      const land =
        s.lastWaves * C.WAVE_SECONDS + lastFall(s) * C.FALL_SECONDS_PER_ROW;
      if (
        lastFall(s) > C.LAND_MIN_ROWS &&
        timer < land &&
        timer + used + 1e-10 >= land
      )
        cues.add(C.CUES.land);
    }
    s = swapping
      ? { ...s, swapTimer: timer + used }
      : { ...s, stepTimer: timer + used };
    remaining -= used;
    if (timer + used + 1e-10 < hold) break;
    if (swapping)
      s = resolveStep(
        { ...s, phase: "resolving", swapTimer: 0, chainStep: 1 },
        cues,
      );
    else if (findRuns(s.board).length)
      s = resolveStep({ ...s, chainStep: s.chainStep + 1, stepTimer: 0 }, cues);
    else {
      s = {
        ...s,
        phase: "idle",
        chainStep: 0,
        stepTimer: 0,
        bestMove: Math.max(s.bestMove, s.moveScore),
      };
      if (s.levelScore >= C.LEVEL_TARGET_STEP * s.level) {
        s = { ...s, screen: "levelclear", menuIndex: 0, armedTarget: null };
        cues.add(C.CUES.levelUp);
      } else if (!legalSwap(s.board)) {
        s = { ...s, screen: "gameover", menuIndex: 0, armedTarget: null };
        cues.add(C.CUES.gameOver);
      }
    }
    if (remaining <= 1e-10) break;
  }
  return s;
}
