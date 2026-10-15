import type { RenderApi } from "@clockwyrks/simple-2d";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import * as C from "./constants";
import type { CellRef, GemState, ReadState, Target } from "./game";
import { cellX, cellY, indexOf, same } from "./rules";
import { menuItems, targets } from "./controls";

const INK = "#eee7d5",
  GOLD = "#d5bd88",
  MUTED = "#829c9f",
  TEAL = "#8ad8cc";
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Trebuchet MS", Arial, sans-serif';
type Context = CanvasRenderingContext2D;

function text(
  ctx: Context,
  value: string | number,
  x: number,
  y: number,
  size = 18,
  color = INK,
  align: CanvasTextAlign = "left",
  family = SANS,
) {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${family}`;
  ctx.textAlign = align;
  ctx.fillText(String(value), x, y);
}
function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 12,
  color = MUTED,
  spacing = 3,
  align: "left" | "center" = "left",
  family = SANS,
) {
  ctx.font = `${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  let cursor =
    x -
    (align === "center"
      ? ([...value].reduce(
          (w, c) => w + ctx.measureText(c).width + spacing,
          0,
        ) -
          spacing) /
        2
      : 0);
  for (const c of value) {
    ctx.fillText(c, cursor, y);
    cursor += ctx.measureText(c).width + spacing;
  }
}
function line(
  ctx: Context,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = "#31434a",
  width = 1,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function diamond(ctx: Context, x: number, y: number, r: number, color = GOLD) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.stroke();
}
function field(ctx: Context) {
  const glow = ctx.createRadialGradient(
    C.STAGE_CX,
    330,
    30,
    C.STAGE_CX,
    C.STAGE_CY,
    760,
  );
  glow.addColorStop(0, "#1b3036");
  glow.addColorStop(0.65, "#0e1e25");
  glow.addColorStop(1, "#0a151b");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  // Engraved bench registration lines, deliberately quieter than the stones.
  ctx.fillStyle = "#abc5bd08";
  for (let x = 32; x < C.STAGE_W; x += 48) {
    for (let y = 16; y < C.STAGE_H; y += 48) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  line(ctx, 36, 24, 1244, 24, "#334147");
  line(ctx, 36, 696, 1244, 696, "#334147");
  for (const x of [36, 1244]) {
    line(ctx, x, 24, x, 58);
    line(ctx, x, 662, x, 696);
  }
}

function sprite(
  ctx: Context,
  s: ReadState,
  key: string,
  x: number,
  y: number,
  size = 64,
) {
  const image = s.assets?.images[key];
  if (image)
    ctx.drawImage(
      image as ImageBitmap,
      Math.round(x - size / 2),
      Math.round(y - size / 2),
      size,
      size,
    );
}
function stone(
  ctx: Context,
  s: ReadState,
  gem: GemState,
  x: number,
  y: number,
  scale = 1,
  time = 0,
) {
  const name = gem.kind ?? "prism";
  if (gem.cut === "prism") {
    sprite(ctx, s, `prism-turn/${Math.floor(time * 9) % 12}`, x, y, 64 * scale);
    if (gem.strain) {
      ctx.globalAlpha = 0.72;
      sprite(ctx, s, `prism-${gem.strain}`, x, y, 64 * scale);
      ctx.globalAlpha = 1;
    }
  } else sprite(ctx, s, `${name}-${gem.strain}`, x, y, 64 * scale);
  if (gem.cut === "brilliant" || gem.cut === "star")
    sprite(ctx, s, gem.cut, x, y, 64 * scale);
}

/** Pure, live evaluation of an authored system at the transition's game time.
 * Reconstructing a local simulator makes scrubbing and paused frames deterministic;
 * the renderer owns no advancing clock or persistent particle state.
 */
function effect(
  ctx: Context,
  s: ReadState,
  name: string,
  x: number,
  y: number,
  age: number,
  seed: number,
) {
  if (age < 0 || age > 1.4) return;
  const system = s.assets?.effects[name];
  if (!system) return;
  const simulator = new ParticleSimulator(system as ParticleSystem, {
    seed,
    maxParticles: 96,
  });
  let elapsed = 0;
  while (elapsed < age * 1000) {
    const step = Math.min(1000 / 60, age * 1000 - elapsed);
    simulator.step(step);
    elapsed += step;
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of simulator.capture()) {
    ctx.fillStyle = `rgba(${p.color.map((c) => Math.round(c * 255)).join(",")},${p.opacity})`;
    const r = p.size;
    ctx.fillRect(
      Math.round(x + p.position[0] - r / 2),
      Math.round(y - p.position[1] - r / 2),
      Math.max(1, r),
      Math.max(1, r * p.stretch),
    );
  }
  ctx.restore();
}
function mark(ctx: Context, p: CellRef, color: string, r = C.GEM_R + 3) {
  const x = cellX(p.col),
    y = cellY(p.row);
  ctx.fillStyle = `${color}12`;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  for (const dx of [-1, 1])
    for (const dy of [-1, 1]) {
      line(
        ctx,
        x + dx * r,
        y + dy * (r - 10),
        x + dx * r,
        y + dy * r,
        color,
        2,
      );
      line(
        ctx,
        x + dx * r,
        y + dy * r,
        x + dx * (r - 10),
        y + dy * r,
        color,
        2,
      );
    }
}
function board(ctx: Context, s: ReadState) {
  const image = s.assets?.images["board-frame"];
  if (image) {
    ctx.shadowColor = "#0009";
    ctx.shadowBlur = 28;
    ctx.drawImage(image as ImageBitmap, 336, 92, 608, 608);
    ctx.shadowBlur = 0;
  }
  const pres = s.presentation;
  const shatterEnd = s.lastWaves * C.WAVE_SECONDS;
  const shattering = s.phase === "resolving" && s.stepTimer < shatterEnd;
  const gems = shattering && pres?.before.length ? pres.before : s.board.cells;
  const time = pres?.dealTime ?? 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(352, 108, C.CELL_PITCH * C.GRID_COLS, C.CELL_PITCH * C.GRID_ROWS);
  ctx.clip();
  for (const gem of gems) {
    let x = cellX(gem.col),
      y = cellY(gem.row);
    if (
      shattering &&
      pres?.cleared.some(
        (c) => same(c.gem, gem) && s.stepTimer >= c.wave * C.WAVE_SECONDS,
      )
    )
      continue;
    if (s.selection && s.offer) {
      if (same(gem, s.selection)) {
        x = cellX(s.offer.col);
        y = cellY(s.offer.row);
      } else if (same(gem, s.offer)) {
        x = cellX(s.selection.col);
        y = cellY(s.selection.row);
      }
    }
    if (s.phase === "swapping" && pres?.swap) {
      const [a, b] = pres.swap;
      const other = same(gem, a) ? b : same(gem, b) ? a : null;
      if (other) {
        const t = Math.min(1, s.swapTimer / C.SWAP_SECONDS),
          eased = t * t * (3 - 2 * t);
        x += (cellX(other.col) - x) * (1 - eased);
        y += (cellY(other.row) - y) * (1 - eased);
      }
    } else if (!shattering) {
      const fallTime =
        s.phase === "resolving"
          ? Math.max(0, s.stepTimer - shatterEnd)
          : (pres?.dealTime ?? Infinity);
      if (s.phase === "resolving" || (pres?.dealTime ?? Infinity) < 0.5) {
        const progress = gem.fell
          ? Math.min(1, fallTime / (gem.fell * C.FALL_SECONDS_PER_ROW))
          : 1;
        y -= gem.fell * C.CELL_PITCH * (1 - progress * progress);
      }
    }
    stone(ctx, s, gem, x, y, 1, time);
    if (gem.cut !== "plain")
      effect(
        ctx,
        s,
        "aura",
        x,
        y,
        ((time + indexOf(gem) * 0.17) % 1.1) + 0.2,
        indexOf(gem) + 893,
      );
  }
  ctx.restore();
  if (s.phase === "resolving" && pres) {
    for (const { gem, wave } of pres.cleared) {
      const age = s.stepTimer - wave * C.WAVE_SECONDS;
      if (age < 0) continue;
      if (age < 0.3 && gem.kind)
        sprite(
          ctx,
          s,
          `break/${gem.kind}/${Math.min(5, Math.floor(age * 20))}`,
          cellX(gem.col),
          cellY(gem.row),
        );
      effect(
        ctx,
        s,
        gem.strain === C.MAX_STRAIN ? "flawed" : "clear",
        cellX(gem.col),
        cellY(gem.row),
        age,
        indexOf(gem) + Math.floor(s.score),
      );
    }
    for (const p of pres.created)
      effect(
        ctx,
        s,
        "cut",
        cellX(p.col),
        cellY(p.row),
        s.stepTimer,
        indexOf(p) + 1,
      );
  }
  if (s.selection) mark(ctx, s.selection, TEAL);
  if (s.offer) mark(ctx, s.offer, GOLD);
  if (s.refusal) {
    mark(ctx, s.refusal.a, "#e68e84");
    mark(ctx, s.refusal.b, "#e68e84");
  }
}

function button(
  ctx: Context,
  s: ReadState,
  t: Target,
  label: string,
  active = false,
) {
  const hovered =
    s.pointer.x >= t.x &&
    s.pointer.x <= t.x + t.w &&
    s.pointer.y >= t.y &&
    s.pointer.y <= t.y + t.h;
  const lit = active || hovered;
  ctx.fillStyle = lit ? "#cbb783" : "#10242b";
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.strokeStyle = lit ? "#ead9b1" : "#40545a";
  ctx.lineWidth = 1;
  ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
  tracked(
    ctx,
    label,
    t.x + t.w / 2,
    t.y + t.h / 2 + 6,
    16,
    lit ? "#16282b" : INK,
    2.5,
    "center",
  );
  if (lit) {
    text(ctx, "›", t.x + t.w - 25, t.y + t.h / 2 + 8, 26, "#34423a");
  }
}
function footer(ctx: Context, s: ReadState) {
  tracked(ctx, "A PUZZLE OF CHAIN REACTIONS", 60, 680, 10, "#647f83", 1.8);
  tracked(
    ctx,
    s.muted ? "M  /  SOUND OFF" : "M  /  SOUND ON",
    1070,
    680,
    10,
    "#647f83",
    1.5,
  );
}
function title(ctx: Context, s: ReadState) {
  tracked(ctx, "THE LAPIDARY COLLECTION   /   No. 01", 150, 136, 11, GOLD, 2.6);
  tracked(ctx, C.TITLE_TEXT, 141, 282, 106, INK, 12, "left", SERIF);
  line(ctx, 150, 310, 450, 310, "#827859");
  tracked(ctx, C.TAGLINE_TEXT, 150, 346, 13, GOLD, 2.8);
  text(
    ctx,
    "A single move. A beautiful fracture.",
    150,
    381,
    18,
    MUTED,
    "left",
    SERIF,
  );
  targets(s).forEach((t, i) =>
    button(ctx, s, t, C.TITLE_ITEMS[i], i === s.menuIndex),
  );
  tracked(ctx, "DRAG TO SWAP   ·   MATCH TO SHATTER", 150, 618, 10, MUTED, 1.7);
  const cx = 888,
    cy = 335;
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 240);
  glow.addColorStop(0, "#73c1b51e");
  glow.addColorStop(1, "#73c1b500");
  ctx.fillStyle = glow;
  ctx.fillRect(600, 80, 600, 550);
  diamond(ctx, cx, cy, 230, "#354e52");
  diamond(ctx, cx, cy, 207, "#2a444a");
  ctx.setLineDash([2, 8]);
  ctx.strokeStyle = "#496065";
  ctx.beginPath();
  ctx.arc(cx, cy, 167, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  line(ctx, 632, cy, 1144, cy, "#2c444a");
  line(ctx, cx, 80, cx, 590, "#2c444a");
  const float = Math.sin(s.simTime * 0.9) * 6;
  stone(
    ctx,
    s,
    { col: 0, row: 0, kind: null, cut: "prism", strain: 0, fell: 0 },
    cx,
    cy + float,
    3.8,
    s.simTime * 0.5,
  );
  for (const [kind, x, y, phase] of [
    ["ruby", 723, 255, 0],
    ["jade", 1019, 218, 2],
    ["sapphire", 1008, 478, 4],
  ] as const) {
    sprite(ctx, s, `${kind}-0`, x, y + Math.sin(s.simTime + phase) * 5, 80);
  }
  line(ctx, 932, 388, 1040, 558, "#697569");
  line(ctx, 1040, 558, 1158, 558, "#697569");
  tracked(ctx, "SPECIMEN  /  PRISM", 987, 582, 10, GOLD, 1.8);
  tracked(
    ctx,
    "SEVEN STONES. ENDLESS POSSIBILITIES.",
    cx,
    642,
    10,
    MUTED,
    2,
    "center",
  );
  ctx.restore();
}

function hud(ctx: Context, s: ReadState) {
  tracked(ctx, C.TITLE_TEXT, 60, 79, 32, INK, 6, "left", SERIF);
  tracked(ctx, "THE CUTTING ROOM", 62, 105, 10, MUTED, 2);
  tracked(ctx, C.HUD_SCORE_LABEL, 355, 53, 10, GOLD, 2);
  text(ctx, s.score.toLocaleString("en-US"), 355, 82, 29, INK, "left", SERIF);
  tracked(
    ctx,
    `${C.HUD_LEVEL_LABEL} ${String(s.level).padStart(2, "0")}  /  ${s.levelScore.toLocaleString("en-US")} OF ${(C.LEVEL_TARGET_STEP * s.level).toLocaleString("en-US")}`,
    567,
    54,
    11,
    MUTED,
    1.6,
  );
  ctx.fillStyle = "#283e43";
  ctx.fillRect(567, 71, 361, 5);
  ctx.fillStyle = GOLD;
  ctx.fillRect(
    567,
    71,
    361 * Math.min(1, s.levelScore / (C.LEVEL_TARGET_STEP * s.level)),
    5,
  );
  const pause = targets({ ...s, screen: "playing" })[0];
  button(ctx, s, pause, C.PAUSE_LABEL);
  tracked(ctx, C.HUD_LEVEL_LABEL, 62, 207, 11, GOLD, 2);
  text(ctx, String(s.level).padStart(2, "0"), 58, 274, 68, INK, "left", SERIF);
  line(ctx, 62, 299, 282, 299);
  tracked(ctx, "MAKE A LITTLE PRESSURE", 62, 334, 10, GOLD, 1.7);
  for (const [i, value] of [
    "Take hold of a stone.",
    "Offer it to a neighbor.",
    "Let go to make your cut.",
  ].entries())
    text(ctx, value, 62, 365 + i * 27, 16, MUTED);
  if (s.phase === "resolving") {
    tracked(ctx, C.HUD_CHAIN_LABEL, 62, 481, 12, TEAL, 3);
    text(
      ctx,
      `×${Math.min(s.chainStep, C.MAX_MULTIPLIER)}`,
      59,
      551,
      70,
      INK,
      "left",
      SERIF,
    );
    text(
      ctx,
      `+${s.lastPoints}  /  ${s.lastCleared} stones`,
      62,
      584,
      16,
      GOLD,
    );
  } else {
    tracked(ctx, "BEST CUT", 62, 494, 11, MUTED, 2);
    text(
      ctx,
      s.bestMove ? `${s.bestMove} pts` : "Your next move awaits.",
      62,
      526,
      20,
      INK,
      "left",
      SERIF,
    );
    if (s.moveScore)
      text(ctx, `Last move  +${s.moveScore}`, 62, 559, 14, MUTED);
  }
  tracked(ctx, "PRESSURE / STRAIN", 986, 204, 11, GOLD, 2);
  const labels = ["CLEAN", "STRESSED", "FRACTURED", "FLAWED  /  ×2"];
  for (let strain = 0; strain <= C.MAX_STRAIN; strain++) {
    sprite(ctx, s, `beryl-${strain}`, 1005, 249 + strain * 60, 48);
    tracked(
      ctx,
      labels[strain],
      1040,
      254 + strain * 60,
      10,
      strain === C.MAX_STRAIN ? GOLD : MUTED,
      1.4,
    );
  }
  line(ctx, 985, 468, 1210, 468);
  tracked(ctx, "EXCEPTIONAL CUTS", 986, 501, 11, GOLD, 2);
  for (const [i, cut] of ["brilliant", "star", "prism"].entries()) {
    sprite(
      ctx,
      s,
      cut === "prism" ? "prism-0" : "jade-0",
      1004,
      542 + i * 44,
      38,
    );
    if (cut !== "prism") sprite(ctx, s, cut, 1004, 542 + i * 44, 38);
    text(
      ctx,
      [
        "4 in a line · Brilliant",
        "Crossed lines · Star",
        "5 in a line · Prism",
      ][i],
      1032,
      547 + i * 44,
      13,
      MUTED,
    );
  }
}

const HOWTO = [
  {
    title: "01  /  MAKE YOUR CUT",
    lines: [
      "Seven kinds of stone, one field of possibilities.",
      "With a mouse, pen, or finger, hold a gem, carry it",
      "onto its neighbor, then let go. Carry it back to",
      "cancel. Only a release plays your move.",
      "Three or more of one kind in a line shatter.",
      "A swap that clears nothing is refused.",
    ],
  },
  {
    title: "02  /  WORK THE PRESSURE",
    lines: [
      "Every clear strains the stones beside it.",
      "Three hits leave a gem flawed: cracked through",
      "and ready to burst. A flawed stone joins any",
      "clear it touches, and scores double.",
      "Falling stones can match again. Every step",
      "of a chain raises your multiplier, up to ×8.",
    ],
  },
  {
    title: "03  /  EARN SOMETHING RARE",
    lines: [
      "Four in a line leaves a brilliant: it clears its ring.",
      "Crossed lines leave a star: row and column.",
      "Five or more leave a prism: swap it with a stone",
      "to clear every gem of that kind.",
      "Reach the target to open the next level.",
      "Your round ends when no legal move remains.",
    ],
  },
];
function howto(ctx: Context, s: ReadState) {
  tracked(ctx, "A FIELD GUIDE", 102, 103, 11, GOLD, 3);
  text(ctx, "The art of a chain reaction.", 98, 163, 48, INK, "left", SERIF);
  line(ctx, 102, 195, 1178, 195);
  HOWTO.forEach((section, i) => {
    const x = 102 + i * 369;
    tracked(ctx, section.title, x, 245, 11, GOLD, 1.6);
    ctx.font = `15px ${SANS}`;
    const lines: string[] = [];
    let current = "";
    for (const word of section.lines.join(" ").split(" ")) {
      if (current && ctx.measureText(`${current} ${word}`).width > 330) {
        lines.push(current);
        current = word;
      } else current += `${current ? " " : ""}${word}`;
    }
    if (current) lines.push(current);
    lines.forEach((value, j) => text(ctx, value, x, 283 + j * 24, 15, MUTED));
  });
  for (let strain = 0; strain <= C.MAX_STRAIN; strain++)
    sprite(ctx, s, `ruby-${strain}`, 535 + strain * 65, 507, 52);
  for (const [i, cut] of ["brilliant", "star", "prism"].entries()) {
    sprite(
      ctx,
      s,
      cut === "prism" ? "prism-0" : "jade-0",
      907 + i * 82,
      507,
      52,
    );
    if (cut !== "prism") sprite(ctx, s, cut, 907 + i * 82, 507, 52);
  }
  for (const [i, kind] of C.GEM_KINDS.entries())
    sprite(ctx, s, `${kind}-0`, 119 + i * 44, 507, 42);
  line(ctx, 102, 560, 1178, 560);
  button(ctx, s, targets(s)[0], C.BACK_LABEL);
  tracked(ctx, "THE KEYS TO THE BENCH", 336, 607, 10, GOLD, 2);
  text(
    ctx,
    "↑ / ↓  menu     Enter / Space  choose     Esc / P  pause     M  sound",
    336,
    637,
    16,
    MUTED,
  );
  text(ctx, "Esc  back to the title", 336, 664, 14, MUTED);
}
function overlay(ctx: Context, s: ReadState) {
  ctx.fillStyle = "#050f15d9";
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  ctx.fillStyle = "#10242bf5";
  ctx.fillRect(397, 140, 486, 490);
  ctx.strokeStyle = "#5d6658";
  ctx.strokeRect(397.5, 140.5, 485, 489);
  diamond(ctx, C.STAGE_CX, 186, 12);
  tracked(
    ctx,
    s.screen === "paused"
      ? "A MOMENT AT THE BENCH"
      : s.screen === "levelclear"
        ? "BEAUTIFULLY DONE"
        : "EVERY STONE HAS ITS LIMIT",
    C.STAGE_CX,
    227,
    10,
    GOLD,
    2,
    "center",
  );
  const heading =
    s.screen === "paused"
      ? C.PAUSED_TITLE_TEXT
      : s.screen === "levelclear"
        ? C.LEVELCLEAR_TITLE_TEXT
        : C.GAMEOVER_TITLE_TEXT;
  text(
    ctx,
    heading,
    C.STAGE_CX,
    282,
    s.screen === "gameover" ? 34 : 40,
    INK,
    "center",
    SERIF,
  );
  if (s.screen === "paused") {
    text(
      ctx,
      "Your next cut can wait.",
      C.STAGE_CX,
      329,
      19,
      MUTED,
      "center",
      SERIF,
    );
    tracked(
      ctx,
      `${C.HUD_LEVEL_LABEL} ${s.level}   ·   ${s.score.toLocaleString("en-US")} POINTS`,
      C.STAGE_CX,
      366,
      11,
      GOLD,
      2,
      "center",
    );
  } else if (s.screen === "levelclear") {
    tracked(
      ctx,
      `${C.HUD_LEVEL_LABEL} ${String(s.level).padStart(2, "0")} COMPLETE`,
      C.STAGE_CX,
      317,
      11,
      GOLD,
      2,
      "center",
    );
    text(
      ctx,
      `${C.BEST_CHAIN_LABEL}  ${s.bestChain}     ${C.BEST_MOVE_LABEL}  ${s.bestMove}`,
      C.STAGE_CX,
      362,
      13,
      MUTED,
      "center",
    );
  } else {
    tracked(
      ctx,
      `${C.HUD_LEVEL_LABEL} ${s.level}`,
      C.STAGE_CX,
      319,
      11,
      GOLD,
      2,
      "center",
    );
    text(
      ctx,
      `${C.HUD_SCORE_LABEL}   ${s.score.toLocaleString("en-US")}`,
      C.STAGE_CX,
      366,
      26,
      INK,
      "center",
      SERIF,
    );
  }
  targets(s).forEach((t, i) =>
    button(ctx, s, t, menuItems(s.screen)[i], s.menuIndex === i),
  );
}
export function drawGame(s: ReadState, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  field(ctx);
  if (s.screen === "title") title(ctx, s);
  else if (s.screen === "howto") howto(ctx, s);
  else {
    hud(ctx, s);
    if (s.board.cells.length) board(ctx, s);
    if (s.screen !== "playing") overlay(ctx, s);
  }
  footer(ctx, s);
  ctx.restore();
}
