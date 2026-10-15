/* global document, console */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => {
  throw e;
});
await page.route("**/capture.html", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: '<html><body style="margin:0"><canvas id="stage" style="width:1280px;height:720px;display:block"></canvas></body></html>',
  }),
);
await page.goto("http://localhost:5173/capture.html");
const capture = await page.evaluate(async () => {
  const { createEngine, ConstantClock } =
    await import("/node_modules/@clockwyrks/simple-2d/dist/index.js");
  const { game, BACKGROUND } = await import("/src/game.ts");
  const { productive, advance, requestSwap } = await import("/src/rules.ts");
  const canvas = document.getElementById("stage");
  const engine = createEngine({
    canvas,
    width: 1280,
    height: 720,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(1000 / 60),
  });
  await engine.initialize();
  const d = engine.debug;
  await engine.advance(90);
  const title = canvas.toDataURL("image/png");
  engine.apply((s) => d.setScreen(s, "howto"));
  await engine.advance(1);
  const howto = canvas.toDataURL("image/png");
  engine.apply((s) => d.dealBoard(s));
  engine.apply((s) => d.setScreen(s, "playing"));
  await engine.advance(45);
  // Stage a worn seam: one ordinary swap can trigger several earned cuts.
  const rows = [
    "R0 A0 C0 J0 B0 S0 M0 R0",
    "C0 J1 B0 S0 M0 R0 A0 C0",
    "B0 S0 M2 R0 A0 C0 J0 B0",
    "M0 R0b R0 A0 R0 J3 S0 M0",
    "A0 C0 J3 B3 S3 M3 R0 A0",
    "J0 B0 S1s M0 R3 A0 C0 J0",
    "S0 M0 R0 A0 X0 J0 B0 S0",
    "R0 A0 C0 J0 B0 S0 M0 R0",
  ];
  engine.apply((s) => d.loadBoard(s, rows));
  engine.apply((s) => d.setScore(s, 1160));
  engine.apply((s) => d.setLevelScore(s, 1160));
  engine.apply((s) => d.setBestMove(s, 410));
  engine.apply((s) => d.setBestChain(s, 3));
  // Pick a reproducible refill performance with a genuinely resolving cascade.
  const originalRandom = Math.random;
  const seedRandom = (seed) => {
    let value = seed;
    Math.random = () => {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  };
  let chosenSeed = 1;
  for (let seed = 1; seed <= 400; seed++) {
    seedRandom(seed);
    let trial = requestSwap(
      { ...engine.state, bestChain: 0 },
      { col: 3, row: 2 },
      { col: 3, row: 3 },
    );
    for (let tick = 0; tick < 240 && trial.phase !== "idle"; tick++)
      trial = advance(trial, 1 / 60);
    if (trial.bestChain >= 3 && trial.score < 2000) {
      chosenSeed = seed;
      break;
    }
  }
  seedRandom(chosenSeed);
  await engine.advance(1);
  const board = canvas.toDataURL("image/png");
  const rungs = [];
  engine.events.on("cue:played", (e) => {
    if (e.cue.startsWith("chain-")) rungs.push(e.cue);
  });
  engine.startRecording();
  await engine.advance(20);
  engine.apply((s) => d.pointerDown(s, 604, 288, "mouse"));
  engine.apply((s) => d.pointerMove(s, 604, 360, "mouse"));
  await engine.advance(12);
  engine.apply((s) => d.pointerUp(s, "mouse"));
  let reaction = null;
  for (let i = 0; i < 240; i++) {
    if (i === 32) reaction = canvas.toDataURL("image/png");
    if (
      engine.state.phase === "idle" &&
      engine.state.screen === "playing" &&
      i > 100 &&
      i < 170
    ) {
      const cells = engine.state.board.cells;
      const move = cells.flatMap((g) =>
        [
          { col: g.col + 1, row: g.row },
          { col: g.col, row: g.row + 1 },
        ]
          .filter(
            (b) =>
              b.col < 8 && b.row < 8 && productive(engine.state.board, g, b),
          )
          .map((b) => [g, b]),
      )[0];
      if (move)
        engine.apply((s) =>
          d.requestSwap(s, move[0].col, move[0].row, move[1].col, move[1].row),
        );
    }
    await engine.advance(1);
  }
  const recording = engine.stopRecording();
  const summary = d.snapshot(engine.state);
  Math.random = originalRandom;
  engine.destroy();
  return { title, board, howto, reaction, recording, summary, rungs };
});
assert(
  capture.rungs.includes("chain-3"),
  "The live capture must contain a real three-step cascade",
);
assert(
  !JSON.stringify(capture.recording).includes('"$opaque"'),
  "Every draw resource must be portable",
);
for (const name of ["title", "board"])
  await writeFile(
    `showcase/${name}.png`,
    Buffer.from(capture[name].split(",")[1], "base64"),
  );
for (const name of ["howto", "reaction"])
  if (capture[name])
    await writeFile(
      `/tmp/opencode/${name}.png`,
      Buffer.from(capture[name].split(",")[1], "base64"),
    );
await writeFile(
  "showcase/chain.json.gz",
  gzipSync(JSON.stringify(capture.recording), { level: 9 }),
);
console.log({
  frames: capture.recording.frames.length,
  images: capture.recording.images.length,
  bestChain: capture.summary.bestChain,
  score: capture.summary.score,
  screen: capture.summary.screen,
  phase: capture.summary.phase,
  stepTimer: capture.summary.stepTimer,
  stepHold: capture.summary.stepHold,
  rungs: capture.rungs,
});
await browser.close();
