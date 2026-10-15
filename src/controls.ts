import * as C from "./constants";
import type {
  CellRef,
  FacetState,
  PointerDevice,
  ReadState,
  Screen,
  Target,
} from "./game";
import {
  adjacent,
  cellX,
  cellY,
  deal,
  emptyBoard,
  initialState,
  requestSwap,
  same,
} from "./rules";

export const menuItems = (screen: Screen): readonly string[] =>
  screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSED_ITEMS
      : screen === "levelclear"
        ? C.LEVELCLEAR_ITEMS
        : screen === "gameover"
          ? C.GAMEOVER_ITEMS
          : [];
export function targets(s: ReadState): Target[] {
  if (s.screen === "playing")
    return [
      {
        id: "pause",
        x: 1050,
        y: 30,
        w: Math.max(144, C.TARGET_MIN_W),
        h: C.TARGET_MIN_H,
      },
    ];
  if (s.screen === "howto")
    return [{ id: "back", x: 102, y: 594, w: 180, h: C.TARGET_MIN_H }];
  return menuItems(s.screen).map((_, i) => ({
    id: `menu-${i}`,
    x: s.screen === "title" ? 150 : 490,
    y: (s.screen === "title" ? 412 : 403) + i * 90,
    w: 300,
    h: C.TARGET_MIN_H,
  }));
}
const show = (s: ReadState, screen: Screen, menuIndex = 0): FacetState => ({
  ...s,
  screen,
  menuIndex,
  armedTarget: null,
});
export function openBoard(s: ReadState): FacetState {
  return {
    ...s,
    board: deal(),
    phase: "idle",
    chainStep: 0,
    stepTimer: 0,
    swapTimer: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    presentation: {
      swap: null,
      prismKind: null,
      before: [],
      cleared: [],
      created: [],
      dealTime: 0,
    },
  };
}
function startRound(s: ReadState): FacetState {
  return openBoard({
    ...initialState(),
    assets: s.assets,
    simTime: s.simTime,
    muted: s.muted,
    pointer: s.pointer,
    screen: "playing",
  });
}
function quit(s: ReadState): FacetState {
  return {
    ...show(s, "title"),
    board: emptyBoard(),
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    selection: null,
    offer: null,
    refusal: null,
    presentation: undefined,
  };
}
export function action(s: ReadState, name: string): FacetState {
  if (name === "pause" && (s.screen === "playing" || s.screen === "paused"))
    return show(s, s.screen === "playing" ? "paused" : "playing");
  if (name === "back") {
    if (s.screen === "howto") return show(s, "title", 1);
    if (s.screen === "gameover") return show(s, "title");
  }
  const items = menuItems(s.screen);
  if (!items.length) return { ...s };
  if (name === "up" || name === "down")
    return {
      ...s,
      menuIndex:
        (s.menuIndex + (name === "up" ? -1 : 1) + items.length) % items.length,
    };
  if (name !== "confirm") return { ...s };
  if (s.screen === "title")
    return s.menuIndex === 0 ? startRound(s) : show(s, "howto");
  if (s.menuIndex === 1) return quit(s);
  if (s.screen === "paused") return show(s, "playing");
  if (s.screen === "gameover") return startRound(s);
  return openBoard({
    ...show(s, "playing"),
    level: s.level + 1,
    levelScore: 0,
    bestChain: 0,
    bestMove: 0,
  });
}

export function hitCell(x: number, y: number): CellRef | null {
  let nearest: CellRef | null = null,
    distance = C.GEM_HIT_R ** 2;
  for (let row = 0; row < C.GRID_ROWS; row++)
    for (let col = 0; col < C.GRID_COLS; col++) {
      const d = (cellX(col) - x) ** 2 + (cellY(row) - y) ** 2;
      if (d <= distance && (nearest === null || d < distance)) {
        nearest = { col, row };
        distance = d;
      }
    }
  return nearest;
}
export function pointerEvent(
  s: ReadState,
  type: "down" | "move" | "up",
  x: number,
  y: number,
  device: PointerDevice,
): FacetState {
  const target = targets(s).find(
    (t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h,
  );
  let next: FacetState = {
    ...s,
    pointer: {
      x,
      y,
      down: type === "down" || (type === "move" && s.pointer.down),
      device,
    },
  };
  if (target?.id.startsWith("menu-") && (type === "down" || !s.pointer.down))
    next = { ...next, menuIndex: Number(target.id.slice(5)) };
  if (type === "down") {
    next = { ...next, armedTarget: target?.id ?? null };
    if (target || s.screen !== "playing") return next;
    const cell = hitCell(x, y);
    if (!cell) return { ...next, selection: null, offer: null };
    if (s.selection && adjacent(s.selection, cell))
      return { ...next, offer: cell };
    return { ...next, selection: cell, offer: null };
  }
  if (type === "move") {
    if (
      s.screen === "playing" &&
      s.pointer.down &&
      s.selection &&
      !s.armedTarget
    ) {
      const cell = hitCell(x, y);
      if (same(cell, s.selection)) return { ...next, offer: null };
      if (cell && adjacent(cell, s.selection)) return { ...next, offer: cell };
    }
    return next;
  }
  next = { ...next, armedTarget: null };
  if (s.armedTarget) {
    if (target?.id !== s.armedTarget) return next;
    return action(next, target.id.startsWith("menu-") ? "confirm" : target.id);
  }
  if (s.screen === "playing" && s.selection && s.offer)
    return {
      ...requestSwap(next, s.selection, s.offer),
      selection: null,
      offer: null,
    };
  return next;
}
