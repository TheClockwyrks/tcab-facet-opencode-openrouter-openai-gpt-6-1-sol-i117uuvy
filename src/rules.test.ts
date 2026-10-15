import { describe, expect, it, vi } from "vitest";
import * as C from "./constants";
import { debug } from "./debug";
import { action, hitCell, targets } from "./controls";
import {
  advance,
  cellX,
  cellY,
  deal,
  findRuns,
  initialState,
  lastFall,
  legalSwap,
  parseGem,
  productive,
  resolveStep,
  stepHold,
} from "./rules";
import type { FacetState, Screen } from "./game";

const rows = () =>
  Array.from({ length: C.GRID_ROWS }, (_, row) =>
    Array.from(
      { length: C.GRID_COLS },
      (_, col) => `${"RACJBSM"[(row * 2 + col) % C.GEM_KIND_COUNT]}0`,
    ).join(" "),
  );
const base = () =>
  debug.setScreen(debug.loadBoard(initialState(), rows()), "playing");
const at = (s: FacetState, col: number, row: number) =>
  s.board.cells[row * C.GRID_COLS + col];
function moveBoard(n = 3) {
  let s = base();
  for (let col = 0; col < n; col++)
    s = debug.setGem(s, col, 0, col === 2 ? "A0" : "R0");
  s = debug.setGem(s, 2, 1, "R0");
  return s;
}
function fixedRefill(s: FacetState) {
  for (let col = 0; col < C.GRID_COLS; col++)
    s = debug.setRefillKinds(
      s,
      col,
      Array.from(
        { length: C.GRID_ROWS },
        (_, row) => "RACJBSM"[(row * 2 + col + 3) % C.GEM_KIND_COUNT],
      ).join(""),
    );
  return s;
}

describe("board, runs and transactions", () => {
  it("deals clean, playable boards with real arrival distances", () => {
    for (let n = 0; n < 30; n++) {
      const board = deal();
      expect(board.cells).toHaveLength(C.GRID_ROWS * C.GRID_COLS);
      expect(findRuns(board)).toEqual([]);
      expect(legalSwap(board)).toBe(true);
      expect(
        board.cells.every(
          (g) => g.cut === "plain" && g.strain === 0 && g.fell >= g.row + 1,
        ),
      ).toBe(true);
    }
  });
  it("parses every kind, cut and strain, including kindless prisms", () => {
    C.GEM_KINDS.forEach((kind, i) =>
      expect(parseGem(`${"RACJBSM"[i]}2b`, 2, 3)).toEqual({
        col: 2,
        row: 3,
        kind,
        strain: 2,
        cut: "brilliant",
        fell: 0,
      }),
    );
    expect(parseGem("X3", 0, 0)).toMatchObject({
      kind: null,
      cut: "prism",
      strain: 3,
    });
    expect(parseGem("J0s", 0, 0).cut).toBe("star");
    for (const token of ["R4", "X0b", "Q1", "r0", "R", "R0bb"])
      expect(() => parseGem(token, 0, 0)).toThrow();
  });
  it("finds maximal lines and excludes kindless prisms", () => {
    let s = base();
    for (let col = 0; col < 6; col++) s = debug.setGem(s, col, 4, "S2");
    expect(findRuns(s.board).some((r) => r.cells.length === 6)).toBe(true);
    s = debug.setGem(s, 2, 4, "X0");
    expect(findRuns(s.board).some((r) => r.cells.length === 3)).toBe(true);
    expect(findRuns(s.board).every((r) => !r.cells.includes(34))).toBe(true);
  });
  it("refuses nonproductive, diagonal and in-flight swaps without touching stones", () => {
    const s = base();
    for (const pair of [
      [0, 0, 1, 0],
      [0, 0, 1, 1],
      [0, 0, 0, 0],
    ]) {
      const next = debug.requestSwap(
        s,
        ...(pair as [number, number, number, number]),
      );
      expect(next.board).toBe(s.board);
      expect(next.refusal).not.toBeNull();
    }
    const moving = debug.requestSwap(moveBoard(), 2, 0, 2, 1);
    const refused = debug.requestSwap(moving, 2, 0, 2, 1);
    expect(refused.phase).toBe("swapping");
    expect(refused.board).toBe(moving.board);
  });
  it("exchanges immediately but scores only after the swap interval", () => {
    const original = moveBoard();
    const frozen = JSON.stringify(original);
    const moving = debug.requestSwap(original, 2, 0, 2, 1);
    expect(at(moving, 2, 0).kind).toBe("ruby");
    expect(moving.score).toBe(0);
    expect(advance(moving, C.SWAP_SECONDS - 0.001).phase).toBe("swapping");
    const resolved = advance(moving, C.SWAP_SECONDS);
    expect(resolved.phase).toBe("resolving");
    expect(resolved.chainStep).toBe(1);
    expect(resolved.lastCleared).toBe(3);
    expect(resolved.lastPoints).toBe(C.BASE_SCORE * 3);
    expect(JSON.stringify(original)).toBe(frozen);
  });
  it("legal-move search uses coordinates without copying the source gem's payload", () => {
    const s = moveBoard();
    const gem = at(s, 2, 0),
      other = at(s, 2, 1);
    expect(productive(s.board, gem, other)).toBe(true);
    expect(legalSwap(s.board)).toBe(true);
    expect(productive(s.board, gem, other)).toBe(
      productive(
        s.board,
        { col: gem.col, row: gem.row },
        { col: other.col, row: other.row },
      ),
    );
  });
});

describe("closure, pressure and cuts", () => {
  it("expands through a brilliant, then through orthogonal flawed gems in minimum waves", () => {
    let s = base();
    for (let col = 0; col < 3; col++)
      s = debug.setGem(s, col, 0, col === 1 ? "R0b" : "R0");
    s = debug.setGem(s, 2, 1, "J3");
    s = debug.setGem(s, 3, 1, "C3");
    s = debug.setGem(s, 4, 1, "S2");
    const next = resolveStep({ ...s, chainStep: 1 });
    expect(next.lastCleared).toBe(7);
    expect(next.lastWaves).toBe(2);
    expect(next.lastPoints).toBe(9 * C.BASE_SCORE);
    expect(
      next.presentation?.cleared.find((c) => c.gem.col === 3 && c.gem.row === 1)
        ?.wave,
    ).toBe(2);
    const survivor = next.board.cells.find(
      (g) => g.kind === "sapphire" && g.col === 4 && g.strain === 3,
    );
    expect(survivor).toBeDefined();
  });
  it("pressures each neighboring survivor once, even with two touching clears", () => {
    let s = base();
    for (const [col, row] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ])
      s = debug.setGem(s, col, row, "R0");
    s = debug.setGem(s, 1, 1, "S1");
    const next = resolveStep({ ...s, chainStep: 1 });
    expect(at(next, 1, 1)).toMatchObject({ kind: "sapphire", strain: 2 });
  });
  it.each([
    [4, "brilliant"],
    [5, "prism"],
    [6, "prism"],
  ] as const)("a run of %i earns a %s at the exchanged cell", (length, cut) => {
    const moving = debug.requestSwap(moveBoard(length), 2, 0, 2, 1);
    const next = advance(moving, C.SWAP_SECONDS);
    expect(at(next, 2, 0)).toMatchObject({
      cut,
      strain: 0,
      kind: cut === "prism" ? null : "ruby",
    });
  });
  it("crossed runs create a star, while a five-run wins at a shared placement", () => {
    let s = base();
    for (const [col, row] of [
      [2, 3],
      [3, 3],
      [4, 3],
      [3, 2],
      [3, 4],
    ])
      s = debug.setGem(s, col, row, "R0");
    const next = resolveStep({ ...s, chainStep: 1 });
    expect(next.board.cells.some((g) => g.col === 3 && g.cut === "star")).toBe(
      true,
    );
    s = debug.setGem(debug.setGem(s, 1, 3, "R0"), 5, 3, "R0");
    const higher = resolveStep({ ...s, chainStep: 1 });
    expect(
      higher.board.cells.some((g) => g.col === 3 && g.cut === "prism"),
    ).toBe(true);
  });
  it("a star clears its full row and column and activates more cuts", () => {
    let s = base();
    for (let col = 0; col < 3; col++)
      s = debug.setGem(s, col, 2, col === 1 ? "R0s" : "R0");
    s = debug.setGem(s, 1, 6, "J0b");
    const next = resolveStep({ ...s, chainStep: 1 });
    expect(next.lastCleared).toBeGreaterThanOrEqual(
      C.GRID_COLS + C.GRID_ROWS - 1,
    );
    expect(
      next.presentation?.cleared.some(
        (c) => c.gem.col === 2 && c.gem.row === 7,
      ),
    ).toBe(true);
  });
  it("a prism exchange seeds its partner's kind, creates no cut, and two prisms clear all", () => {
    let s = debug.setGem(base(), 0, 0, "X0");
    const kindCount = s.board.cells.filter(
      (g) => g.kind === at(s, 1, 0).kind,
    ).length;
    const next = advance(debug.requestSwap(s, 0, 0, 1, 0), C.SWAP_SECONDS);
    expect(next.lastCleared).toBe(kindCount + 1);
    expect(next.presentation?.created).toHaveLength(0);
    s = debug.setGem(s, 1, 0, "X0");
    const all = advance(debug.requestSwap(s, 0, 0, 1, 0), C.SWAP_SECONDS);
    expect(all.lastCleared).toBe(C.GRID_COLS * C.GRID_ROWS);
    expect(lastFall(all)).toBe(C.GRID_ROWS);
  });
  it("caps the chain multiplier, doubles flawed points, and tracks move totals", () => {
    let s = base();
    for (let col = 0; col < 3; col++) s = debug.setGem(s, col, 0, "R3");
    const next = resolveStep({
      ...s,
      chainStep: 12,
      score: 100,
      levelScore: 50,
      moveScore: 20,
    });
    const points = C.FLAWED_SCORE * 3 * C.MAX_MULTIPLIER;
    expect(next.lastPoints).toBe(points);
    expect(next.score).toBe(100 + points);
    expect(next.levelScore).toBe(50 + points);
    expect(next.moveScore).toBe(20 + points);
    expect(next.bestChain).toBe(12);
  });
});

describe("settling and time", () => {
  it("preserves survivor order, damage and cuts, writes refill rows, and keeps fell after rest", () => {
    let s = base();
    s = debug.setGem(s, 1, 0, "A2b");
    for (let col = 0; col < 3; col++) s = debug.setGem(s, col, 7, "R0");
    s = debug.setRefillKinds(s, 1, "M");
    const next = resolveStep({ ...s, chainStep: 1 });
    expect(at(next, 1, 1)).toMatchObject({
      kind: "amber",
      cut: "brilliant",
      strain: 2,
      fell: 1,
    });
    expect(at(next, 1, 0)).toMatchObject({
      kind: "amethyst",
      cut: "plain",
      strain: 0,
      fell: 1,
    });
    expect(next.board.cells).toHaveLength(64);
    expect(at(advance(debug.clearChain(next), 1), 1, 1).fell).toBe(1);
  });
  it("integrates a chain identically across coarse and uneven frames", () => {
    const s = debug.requestSwap(fixedRefill(moveBoard()), 2, 0, 2, 1);
    vi.spyOn(Math, "random").mockReturnValue(0.46);
    const coarse = advance(s, 0.54);
    let fine = s;
    for (const dt of [0.01, 0.03, 0.09, 0.07, 0.14, 0.2])
      fine = advance(fine, dt);
    expect(fine.board).toEqual(coarse.board);
    expect(fine.phase).toBe(coarse.phase);
    expect(fine.score).toBe(coarse.score);
    expect(fine.stepTimer).toBeCloseTo(coarse.stepTimer, 10);
    vi.restoreAllMocks();
  });
  it("freezes timers and refusal on every non-playing screen", () => {
    const s = debug.requestSwap(moveBoard(), 2, 0, 2, 1);
    for (const screen of [
      "title",
      "howto",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const posed = {
        ...s,
        screen,
        refusal: { a: { col: 0, row: 0 }, b: { col: 1, row: 0 }, timer: 0.1 },
      };
      expect(advance(posed, 4)).toEqual(posed);
    }
  });
  it("expires refusal only after its whole duration", () => {
    const s = debug.requestSwap(base(), 0, 0, 1, 0);
    expect(advance(s, C.REFUSAL_SECONDS - 0.001).refusal).not.toBeNull();
    expect(advance(s, C.REFUSAL_SECONDS).refusal).toBeNull();
  });
  it("evaluates level completion before dead-board ending, banks best move, then continues fresh", () => {
    const s = {
      ...base(),
      phase: "resolving" as const,
      chainStep: 2,
      levelScore: C.LEVEL_TARGET_STEP,
      moveScore: 240,
      score: 2300,
      bestChain: 2,
    };
    const cues = new Set<string>();
    const cleared = advance(s, stepHold(s), cues);
    expect(cleared.screen).toBe("levelclear");
    expect(cleared.bestMove).toBe(240);
    expect(cues.has(C.CUES.levelUp)).toBe(true);
    const next = action(cleared, "confirm");
    expect(next).toMatchObject({
      screen: "playing",
      level: 2,
      score: 2300,
      levelScore: 0,
      bestMove: 0,
      bestChain: 0,
    });
    expect(next.board).not.toEqual(cleared.board);
  });
  it("ends a round only when a chain comes to rest with no legal move", () => {
    const s = base();
    expect(legalSwap(s.board)).toBe(false);
    expect(advance(s, 10).screen).toBe("playing");
    const over = advance(
      { ...s, phase: "resolving", chainStep: 1 },
      C.STEP_SECONDS,
    );
    expect(over.screen).toBe("gameover");
    expect(action(over, "back").board).toBe(over.board);
    expect(action({ ...over, menuIndex: 1 }, "confirm").board.cells).toEqual(
      [],
    );
  });
});

describe("pointer, menus and independent poses", () => {
  it.each(["mouse", "pen", "touch"] as const)(
    "offers, withdraws and releases the same way with %s",
    (device) => {
      let s = moveBoard();
      s = debug.pointerDown(s, cellX(2), cellY(0), device);
      s = debug.pointerMove(s, cellX(2), cellY(1), device);
      expect(s.offer).toEqual({ col: 2, row: 1 });
      expect(s.phase).toBe("idle");
      s = debug.pointerMove(s, cellX(2), cellY(0), device);
      expect(s.offer).toBeNull();
      s = debug.pointerMove(s, cellX(2), cellY(1), device);
      s = debug.pointerUp(s, device);
      expect(s).toMatchObject({
        phase: "swapping",
        selection: null,
        offer: null,
      });
      expect(s.pointer.device).toBe(device);
    },
  );
  it("supports two taps, nonadjacent re-selection, missed presses and nearest-cell ties", () => {
    let s = debug.pointerUp(debug.pointerDown(moveBoard(), cellX(2), cellY(0)));
    expect(s.selection).toEqual({ col: 2, row: 0 });
    s = debug.pointerUp(debug.pointerDown(s, cellX(2), cellY(1)));
    expect(s.phase).toBe("swapping");
    s = debug.pointerDown(base(), cellX(0), cellY(0));
    s = debug.pointerDown(s, cellX(5), cellY(5));
    expect(s.selection).toEqual({ col: 5, row: 5 });
    s = debug.pointerDown(s, 0, 0);
    expect(s.selection).toBeNull();
    expect(hitCell(cellX(0) + C.GEM_HIT_R, cellY(0))).toEqual({
      col: 0,
      row: 0,
    });
    expect(hitCell(cellX(0), cellY(0) + C.GEM_HIT_R)).toEqual({
      col: 0,
      row: 0,
    });
    expect(hitCell(0, 0)).toBeNull();
  });
  it("arms only a pressed target, cancels a release outside, and preserves how-to focus", () => {
    let s = initialState();
    const [play, how] = targets(s);
    s = debug.pointerMove(s, how.x + 10, how.y + 10);
    expect(s.menuIndex).toBe(1);
    s = debug.pointerDown(s, how.x + 10, how.y + 10);
    s = debug.pointerMove(s, play.x + 10, play.y + 10);
    s = debug.pointerUp(s);
    expect(s.screen).toBe("title");
    s = debug.pointerUp(debug.pointerDown(s, how.x + 10, how.y + 10));
    expect(s.screen).toBe("howto");
    expect(s.armedTarget).toBeNull();
    s = action(s, "back");
    expect(s).toMatchObject({ screen: "title", menuIndex: 1 });
    expect(action(s, "down").menuIndex).toBe(0);
    expect(action({ ...s, menuIndex: 0 }, "up").menuIndex).toBe(1);
  });
  it("all screens expose usable, separated fingertip targets inside the stage", () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as Screen[]) {
      const ts = targets({ ...initialState(), screen });
      for (const t of ts) {
        expect(t.w).toBeGreaterThanOrEqual(C.TARGET_MIN_W);
        expect(t.h).toBeGreaterThanOrEqual(C.TARGET_MIN_H);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(C.STAGE_W);
        expect(t.y + t.h).toBeLessThanOrEqual(C.STAGE_H);
      }
      if (ts.length === 2) expect(ts[0].y + ts[0].h).toBeLessThan(ts[1].y);
    }
  });
  it("pauses without changing the board and QUIT truly puts it down", () => {
    const playing = debug.requestSwap(moveBoard(), 2, 0, 2, 1);
    const paused = action(playing, "pause");
    expect(action(paused, "pause").board).toBe(playing.board);
    const quit = action({ ...paused, menuIndex: 1 }, "confirm");
    expect(quit).toMatchObject({
      screen: "title",
      phase: "idle",
      chainStep: 0,
      selection: null,
      offer: null,
      refusal: null,
      armedTarget: null,
    });
    expect(quit.board.cells).toHaveLength(0);
    const fresh = action({ ...quit, score: 1000, level: 4 }, "confirm");
    expect(fresh).toMatchObject({ score: 0, level: 1, levelScore: 0 });
  });
  it("poses values independently; reconcile is an idempotent pure reading repair", () => {
    let s = debug.setSelection(base(), 7, 7);
    s = debug.setOffer(s, 0, 0);
    s = debug.setScore(s, 987);
    s = debug.setLevel(s, 8);
    s = debug.setLevelScore(s, 901);
    s = debug.setBestChain(s, 15);
    s = debug.setBestMove(s, 37);
    s = debug.setMoveScore(s, 29);
    s = debug.setMenuIndex(s, 200);
    expect(debug.reconcile(debug.reconcile(s))).toEqual(s);
    const snap = debug.snapshot(s);
    expect(snap).toMatchObject({
      score: 987,
      levelTarget: 16000,
      levelScore: 901,
      bestChain: 15,
      bestMove: 37,
      moveScore: 29,
      menuIndex: 200,
      legalSwap: false,
    });
    expect(snap.board.cells[0]).toMatchObject({ x: 388, y: 144, fell: 0 });
    expect(debug.clearSelection(s).offer).toEqual(s.offer);
    expect(debug.clearOffer(s).selection).toEqual(s.selection);
    expect(debug.clearRefusal(s).score).toBe(987);
    expect(debug.clearBoard(s).selection).toEqual(s.selection);
    expect(debug.dealBoard(s).score).toBe(987);
    expect(debug.reset({ ...s, muted: true })).toEqual({
      ...initialState(),
      muted: true,
      assets: undefined,
    });
  });
  it("rejects out-of-domain poses loudly", () => {
    const s = base();
    for (const call of [
      () => debug.setLevel(s, 0),
      () => debug.setMenuIndex(s, -1),
      () => debug.setGem(s, 8, 0, "R0"),
      () => debug.setSelection(s, -1, 2),
      () => debug.setOffer(s, 0, 8),
      () => debug.setRefillKinds(s, 0, "RX"),
      () => debug.loadBoard(s, ["R0"]),
      () => debug.loadBoard(s, Array<string>(8).fill("R0")),
      () => debug.setGem(initialState(), 0, 0, "R0"),
      () => debug.pointerDown(s, NaN, 0),
    ])
      expect(call).toThrow();
    expect(debug.clearRefillKinds(debug.setRefillKinds(s, 0, "RAC"))).toEqual(
      s,
    );
  });
  it("writes numeric score poses exactly, independent of a player's route to them", () => {
    const s = base();
    expect(debug.setScore(s, -12.5).score).toBe(-12.5);
    expect(debug.setLevelScore(s, -3.25).levelScore).toBe(-3.25);
    expect(debug.setBestMove(s, 12.75).bestMove).toBe(12.75);
    expect(debug.setMoveScore(s, -4).moveScore).toBe(-4);
  });
});
