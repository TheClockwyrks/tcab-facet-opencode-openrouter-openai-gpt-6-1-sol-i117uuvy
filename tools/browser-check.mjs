/* global document, console */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const mount = "/nested/facet/";
const mime = {
  html: "text/html",
  js: "text/javascript",
  png: "image/png",
  json: "application/json",
  wav: "audio/wav",
  mid: "audio/midi",
};
const server = createServer(async (request, response) => {
  try {
    assert(request.url.startsWith(mount));
    const path =
      decodeURIComponent(request.url.split("?")[0].slice(mount.length)) ||
      "index.html";
    assert(!path.includes(".."));
    const bytes = await readFile(`dist/${path}`);
    response.writeHead(200, {
      "Content-Type": mime[path.split(".").pop()] || "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(4174, resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const size of [
    { width: 1280, height: 720, dpr: 1, touch: false },
    { width: 390, height: 844, dpr: 2, touch: true },
    { width: 1600, height: 900, dpr: 2, touch: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.dpr,
      hasTouch: size.touch,
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`http://localhost:4174${mount}`);
    await page.waitForFunction(() => {
      const canvas = document.getElementById("stage");
      const ctx = canvas.getContext("2d");
      const scale = Math.min(canvas.width / 1280, canvas.height / 720);
      return (
        ctx.getImageData(
          (canvas.width - scale * 1280) / 2 + 151 * scale,
          (canvas.height - scale * 720) / 2 + 414 * scale,
          1,
          1,
        ).data[0] > 100
      );
    });
    const tap = async (x, y) => {
      const scale = Math.min(size.width / 1280, size.height / 720);
      const px = (size.width - scale * 1280) / 2 + x * scale;
      const py = (size.height - scale * 720) / 2 + y * scale;
      if (size.touch) await page.touchscreen.tap(px, py);
      else await page.mouse.click(px, py);
      await page.waitForTimeout(100);
    };
    await tap(300, 538);
    await page.screenshot({ path: `/tmp/opencode/guide-${size.width}.png` });
    await tap(190, 630);
    await tap(300, 448);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `/tmp/opencode/play-${size.width}.png` });
    await tap(1120, 65);
    await page.waitForTimeout(100);
    await page.screenshot({ path: `/tmp/opencode/paused-${size.width}.png` });
    await tap(640, 439);
    await page.keyboard.press("KeyM");
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(50);
    await tap(640, 529);
    assert.equal(errors.length, 0, errors.join("\n"));
    assert(
      requests.every((url) => url.startsWith(`http://localhost:4174${mount}`)),
      "All requests must stay within the mounted static build",
    );
    console.log(
      `Passed ${size.width}×${size.height}, DPR ${size.dpr}, ${size.touch ? "touch" : "mouse"}; ${requests.length} local requests.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
