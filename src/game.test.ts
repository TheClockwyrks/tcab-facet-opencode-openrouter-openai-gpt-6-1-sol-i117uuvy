/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import { BACKGROUND, game } from "./game";
import * as C from "./constants";
import { targets } from "./controls";

// The engine runs unchanged over a real raster canvas. Only browser decoding and
// network transport are supplied by the Node host; every shipped asset is read.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(await readFile(`public/${url}`)),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(new Uint8Array(await blob.arrayBuffer())),
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      async decodeAudioData(bytes: ArrayBuffer) {
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
        expect(bytes.byteLength).toBeGreaterThan(44);
        return { duration: 1 };
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

function host(step = 10) {
  const events = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    game,
    clock: new ConstantClock(step),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  const key = (code: string) => {
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code, repeat: false }),
    );
    events.dispatchEvent(Object.assign(new Event("keyup"), { code }));
  };
  const pointer = (
    type: string,
    x: number,
    y: number,
    primary = true,
    device = "mouse",
  ) =>
    events.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: primary ? 1 : 2,
        isPrimary: primary,
        pointerType: device,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  return { engine, canvas, events, key, pointer };
}

describe("the engine-driven finished game", () => {
  it("loads the real library, draws all screens, responds to every key, and exposes pure diagnostics", async () => {
    const { engine, canvas, key } = host();
    const loaded: string[] = [];
    engine.events.on("asset:loaded", (e) => loaded.push(e.path));
    const loops: string[] = [];
    engine.events.on("cue:looped", (e) => loops.push(e.cue));
    await engine.initialize();
    expect(engine.debug.version).toBe(C.FACET_DEBUG_VERSION);
    expect(loaded).toHaveLength(112);
    await engine.advance(1);
    expect(loops).toEqual(["music-title"]);
    expect(canvas.getContext("2d").getImageData(150, 412, 1, 1).data[3]).toBe(
      255,
    );
    key("ArrowDown");
    await engine.advance(1);
    expect(engine.state.menuIndex).toBe(1);
    key("Space");
    await engine.advance(1);
    expect(engine.state.screen).toBe("howto");
    key("Escape");
    await engine.advance(1);
    expect(engine.state.menuIndex).toBe(1);
    key("ArrowUp");
    await engine.advance(1);
    key("Enter");
    await engine.advance(50);
    expect(engine.state.screen).toBe("playing");
    expect(loops).toContain("music-play");
    key("KeyM");
    await engine.advance(1);
    expect(engine.state.muted).toBe(true);
    key("KeyP");
    await engine.advance(1);
    const paused = engine.state;
    expect(paused.screen).toBe("paused");
    await engine.advance(5);
    expect(engine.state.simTime).toBeGreaterThan(paused.simTime);
    expect(engine.state.board).toEqual(paused.board);
    key("Escape");
    await engine.advance(1);
    expect(engine.state.screen).toBe("playing");
    for (const screen of ["levelclear", "gameover"] as const) {
      engine.apply((s) => engine.debug.setScreen(s, screen));
      await engine.advance(1);
    }
    const before = engine.debug.snapshot(engine.state);
    expect(engine.diagnostics().every((d) => d.error === undefined)).toBe(true);
    expect(engine.diagnostics().length).toBeGreaterThanOrEqual(18);
    expect(engine.debug.snapshot(engine.state)).toEqual(before);
    expect(engine.state.simTime).toBeCloseTo(engine.frame().timeMs / 1000, 10);
    engine.destroy();
  });

  it("consumes all primary pointer positions in order and emits deduplicated event cues", async () => {
    const { engine, pointer } = host();
    const cues: string[] = [];
    engine.events.on("cue:played", (e) => cues.push(e.cue));
    await engine.initialize();
    const play = targets(engine.state)[0];
    pointer("pointerdown", play.x + 20, play.y + 20);
    pointer("pointerup", play.x + 20, play.y + 20);
    engine.setClock(new ConstantClock(100));
    await engine.advance(6);
    engine.setClock(new ConstantClock(10));
    expect(engine.state.screen).toBe("playing");
    const rows = [
      "R0 R0 A0 J0 B0 S0 M0 R0",
      "C0 J0 R0 S0 M0 R0 A0 C0",
      "B0 S0 M0 R0 A0 C0 J0 B0",
      "M0 R0 A0 C0 J0 B0 S0 M0",
      "A0 C0 J0 B0 S0 M0 R0 A0",
      "J0 B0 S0 M0 R0 A0 C0 J0",
      "S0 M0 R0 A0 C0 J0 B0 S0",
      "R0 A0 C0 J0 B0 S0 M0 R0",
    ];
    engine.apply((s) => engine.debug.loadBoard(s, rows));
    for (let col = 0; col < C.GRID_COLS; col++)
      engine.apply((s) => engine.debug.setRefillKinds(s, col, "CJBSMRAC"[col]));
    pointer("pointerdown", 532, 144);
    pointer("pointerdown", 0, 0, false, "touch");
    pointer("pointermove", 532, 216);
    pointer("pointermove", 532, 144);
    pointer("pointermove", 532, 216);
    pointer("pointerup", 532, 216);
    await engine.advance(1);
    expect(engine.state.phase).toBe("swapping");
    expect(cues).toEqual([C.CUES.select, C.CUES.swap]);
    await engine.advance(17);
    expect(engine.state.score).toBe(30);
    expect(cues).toContain(C.CUES.clear);
    expect(cues).toContain("chain-1");
    expect(cues.filter((c) => c === C.CUES.clear)).toHaveLength(1);
    engine.setClock(new ConstantClock(100));
    await engine.advance(10);
    expect(engine.state.phase).toBe("idle");
    expect(engine.state.bestMove).toBeGreaterThanOrEqual(30);
    engine.apply((s) => engine.debug.loadBoard(s, rows));
    engine.apply((s) => engine.debug.setBestChain(s, 15));
    engine.apply((s) => engine.debug.setScreen(s, "playing"));
    engine.apply((s) => engine.debug.setLevelScore(s, C.LEVEL_TARGET_STEP));
    engine.apply((s) => engine.debug.requestSwap(s, 2, 0, 2, 1));
    engine.setClock(new ConstantClock(1000));
    await engine.advance(1);
    expect(engine.state.screen).toBe("levelclear");
    expect(cues.filter((c) => c.startsWith("chain-")).pop()).toBe("chain-1");
    engine.destroy();
  });

  it("records actual sprite drawing, cut motion and wave bursts through the engine recorder", async () => {
    const { engine } = host(1000 / 60);
    await engine.initialize();
    engine.apply((s) => engine.debug.dealBoard(s));
    engine.apply((s) => engine.debug.setScreen(s, "playing"));
    await engine.advance(40);
    engine.apply((s) => engine.debug.setGem(s, 0, 0, "X3"));
    engine.apply((s) => engine.debug.setGem(s, 1, 0, "X0"));
    engine.apply((s) => engine.debug.setGem(s, 3, 3, "R2b"));
    engine.apply((s) => engine.debug.setGem(s, 4, 4, "C1s"));
    engine.apply((s) => engine.debug.setSelection(s, 4, 4));
    engine.apply((s) => engine.debug.setOffer(s, 5, 4));
    engine.startRecording();
    await engine.advance(2);
    engine.apply((s) => engine.debug.clearOffer(s));
    engine.apply((s) => engine.debug.clearSelection(s));
    const cues: string[] = [];
    engine.events.on("cue:played", (e) => cues.push(e.cue));
    engine.apply((s) => engine.debug.requestSwap(s, 0, 0, 1, 0));
    expect(cues).toEqual([]);
    await engine.advance(45);
    const recording = engine.stopRecording();
    expect(recording.frames).toHaveLength(47);
    expect(
      recording.ops.some((op) => op.op === "call" && op.method === "drawImage"),
    ).toBe(true);
    expect(cues).toContain(C.CUES.land);
    expect(engine.state.score).toBeGreaterThanOrEqual(640);
    engine.destroy();
  }, 15000);
});
