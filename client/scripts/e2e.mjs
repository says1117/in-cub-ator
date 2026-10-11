// client/scripts/e2e.mjs: Plays real fights end to end in a headless browser. No hardware, no broker.
//
//   cd client && npm run build && npm run e2e
//
// Starts the real game server with --offline (an in-process stand-in for Mosquitto) and a static
// server for client/dist, opens the game in Chromium, summons demo bosses and plays each fight by
// reading the boss's sign and pressing its counter. It checks the things players notice:
//   - every press while the buttons are live is answered by a turn (no lost presses)
//   - the final turn is shown before the result, and the result panel tells the truth about water
//   - the battle screen hands back to the forest afterwards
//   - no errors in the page
// Screenshots go to client/e2e-out/. Exit code 0 = pass, 1 = fail, 2 = Playwright not installed.
//
// Playwright is not a dependency of this project. It is found through NODE_PATH, for example:
//   NODE_PATH=$(npm root -g) npm run e2e
// Options: --fights=N (default 2)  --headed  --keep (leave screenshots of every turn)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "..");
const serverDir = path.resolve(clientDir, "../server");
const distDir = path.join(clientDir, "dist");
const outDir = path.join(clientDir, "e2e-out");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const FIGHTS = Number(args.fights || 2);
const WS_PORT = Number(args["ws-port"] || 8799);
const HTTP_PORT = Number(args["http-port"] || 5299);

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("SKIP: Playwright not found. Run with NODE_PATH pointing at a global install: NODE_PATH=$(npm root -g) npm run e2e");
  process.exit(2);
}
if (!existsSync(path.join(distDir, "index.html"))) {
  console.log("FAIL: client/dist is missing. Run `npm run build` first.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  FAIL ${msg}`); };
const ok = (msg) => console.log(`  ok   ${msg}`);

// ---------------------------------------------------------------- servers
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".svg": "image/svg+xml" };
const http = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(distDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(distDir) || url.pathname === "/") file = path.join(distDir, "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => http.listen(HTTP_PORT, r));

const game = spawn("python3", ["main.py", "--offline", "--seed=7", `--ws-port=${WS_PORT}`], { cwd: serverDir, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
game.stdout.on("data", (d) => { serverLog += d; });
game.stderr.on("data", (d) => { serverLog += d; });
const pumps = () => (serverLog.match(/command incube\/cmd\/pump\/\w \d+/g) || []);

async function cleanup() {
  game.kill();
  http.close();
}
process.on("SIGINT", async () => { await cleanup(); process.exit(1); });

for (let i = 0; i < 50 && !serverLog.includes("server listening"); i++) await sleep(100);
if (!serverLog.includes("server listening")) { console.log(serverLog); fail("game server did not start"); await cleanup(); process.exit(1); }

// ---------------------------------------------------------------- browser
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: !args.headed,
  executablePath: existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const state = () => page.evaluate(() => window.__game && window.__game.registry.get("serverState"));
const sceneActive = (key) => page.evaluate((k) => Boolean(window.__game && window.__game.scene.isActive(k)), key);
const COUNTER = { attack: "guard", guard: "special", special: "attack" };
const KEY = { attack: "Digit1", guard: "Digit2", special: "Digit3", skill: "Digit4" };

try {
  console.log("boot");
  await page.goto(`http://localhost:${HTTP_PORT}/?ws=${WS_PORT}`);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive("AdventureScene"), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__game.registry.get("serverState"), null, { timeout: 15000 });
  ok("forest is up and the server state arrived");
  await sleep(1500);
  await shot("01_forest");

  for (let f = 1; f <= FIGHTS; f++) {
    console.log(`fight ${f}`);
    // wait until a demo boss can be summoned, then summon it from the page's own connection
    await page.waitForFunction(() => { const s = window.__game.registry.get("serverState"); return s && (s.demo_available ?? ["walking", "cooldown"].includes(s.mode)); }, null, { timeout: 60000 });
    await page.evaluate((port) => {
      const viaPage = window.__game.registry.get("sendDemo");
      if (typeof viaPage === "function") return viaPage();
      const ws = new WebSocket(`ws://${location.hostname}:${port}`);   // older pages: ask the server directly
      ws.onopen = () => { ws.send(JSON.stringify({ action: "demo_boss" })); setTimeout(() => ws.close(), 300); };
    }, WS_PORT);
    await page.waitForFunction(() => window.__game.registry.get("serverState").mode === "boss", null, { timeout: 10000 });
    await sleep(2000);
    if (f === 1) await shot("02_entrance");
    await page.waitForFunction(() => window.__game.scene.isActive("BossScene"), null, { timeout: 45000 });
    ok("entrance played and the battle screen opened");
    const fightId = (await state()).battle.id;

    let pressed = 0, answered = 0, waited = 0;
    for (let i = 0; i < 60; i++) {
      const s = await state();
      if (!s.battle || s.battle.id !== fightId || s.battle.over) break;
      // buttons live? (the screen decides: server accepting AND the last turn finished playing)
      const live = await page.evaluate(() => {
        const sc = window.__game.scene.getScene("BossScene");
        return Boolean(sc && sc.hud && Object.values(sc.hud.buttons).some((b) => b.enabled));
      });
      if (!live) { await sleep(120); waited++; continue; }
      const b = s.battle;
      const shown = b.intent && b.intent.move;
      let move = shown ? COUNTER[shown] : ["attack", "guard", "special"][i % 3];
      if (!shown && b.skill && b.skill.ready && b.blooms >= 1) move = "skill";
      const turn = b.turn;
      await page.keyboard.press(KEY[move]);
      pressed++;
      try {
        await page.waitForFunction((t) => { const st = window.__game.registry.get("serverState"); return !st.battle || st.battle.turn > t; }, turn, { timeout: 4000 });
        answered++;
      } catch {
        fail(`press ${move} on turn ${turn} was not answered within 4 s`);
      }
      if (f === 1 && pressed === 2) { await sleep(700); await shot("03_turn_impact"); }
      if (args.keep) await shot(`turn_${f}_${turn}`);
    }
    if (pressed > 0 && answered === pressed) ok(`all ${pressed} presses were answered`);
    else if (pressed === 0) fail("never got live buttons to press");

    // the result: the final turn plays first, then the panel; it must match the pump log
    await page.waitForFunction((id) => { const s = window.__game.registry.get("serverState"); return s.result && s.result.fight === id; }, fightId, { timeout: 15000 });
    const result = (await state()).result;
    await page.waitForFunction(() => { const sc = window.__game.scene.getScene("BossScene"); return sc && sc.resultQueued && !sc.queue.length; }, null, { timeout: 15000 });
    await sleep(1400);
    await shot(`04_result_${f}`);
    const pumped = pumps();
    if (result.outcome === "won" && result.water_ms > 0) {
      const last = pumped[pumped.length - 1] || "";
      if (last.endsWith(` ${result.water_ms}`)) ok(`won, and the screen's ${result.water_ms} ms matches the pump command`);
      else fail(`result says ${result.water_ms} ms but the last pump command was "${last}"`);
    } else {
      ok(`result: ${result.outcome}, water ${result.water_ms} ms, blocked=${result.blocked}`);
    }
    await page.waitForFunction(() => window.__game.scene.isActive("AdventureScene") && !window.__game.scene.isActive("BossScene"), null, { timeout: 15000 });
    ok("back in the forest");
    await sleep(800);
    if (f === 1) await shot("05_forest_after");
  }

  if (pageErrors.length) fail(`page errors: ${pageErrors.slice(0, 5).join(" | ")}`);
  else ok("no page errors");
} catch (e) {
  fail(`crashed: ${e.message}${pageErrors.length ? ` (page errors: ${pageErrors.slice(0, 3).join(" | ")})` : ""}`);
  await shot("crash").catch(() => {});
  const where = await page.evaluate(() => {
    const s = window.__game && window.__game.registry.get("serverState");
    const scenes = window.__game ? window.__game.scene.getScenes(true).map((x) => x.scene.key) : [];
    return { mode: s && s.mode, battle: s && s.battle && { id: s.battle.id, turn: s.battle.turn, over: s.battle.over }, result: s && s.result, scenes };
  }).catch(() => null);
  console.log("  at the crash:", JSON.stringify(where));
  console.log(serverLog.split("\n").filter((l) => / mode |command|demo/.test(l)).slice(-12).join("\n"));
} finally {
  await browser.close();
  await cleanup();
}

console.log(failures.length ? `\nE2E FAILED (${failures.length})` : "\nE2E PASSED");
process.exit(failures.length ? 1 : 0);
