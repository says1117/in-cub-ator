<!-- client/CLAUDE.md: Instructions for Claude working on the client. Owner: Role 3 (client, art, demo). -->

# CLAUDE.md

The game screen: a Phaser 4 game (800 x 450, Vite). `../PROJECT.md` explains every rule and
every part; section 11 is the screen and section 15 the file map. Read it first.

## Rules of the house

- **The server decides everything.** The screen never works out who won, what a move does or
  whether to water. It shows the server's state message (protocol v2, PROJECT.md section 2)
  and sends moves tagged with `turn`. If you need a number, ask the server to send it.
- **The battle screen plays events, not snapshots.** `state/battleTurns.js` turns two
  messages into "new fight / one turn / catch up / result"; `scenes/BossScene.js` plays them
  from a queue. Health bars move when a blow lands, VICTORY/DEFEAT only after the last blow.
  Keep it that way.
- **Moves and looks live in data files.** A plant's move names, body actions and effects are
  in `data/plants.js`; a boss tier's move names and colours in `data/bosses.js`. Effects are
  small functions in `render/battleFx.js` / `render/bossFx.js` built on `render/fxKit.js`.
- **One font**: Tiny5 via `ui/font.js` (`textStyle`, `outline`). No bold: it has one weight.
  On the battle stage, make text with `BattleHud.text()` so it stays pixel-crisp.
- **Sound** goes through `registry.get("audio")` (`audio/index.js`); a missing module must
  never break a scene.
- Respect `prefers-reduced-motion` and `?calm` for flashes and shakes.

## Checking your work

```bash
npm test                                   # pure client logic (node --test)
npm run build                              # must pass
NODE_PATH=$(npm root -g) npm run e2e       # needs `npm run build` first and Playwright installed globally
```

`npm run e2e` starts `server/main.py --offline` itself, plays two fights in headless
Chromium and saves screenshots in `e2e-out/`. To look at the game by hand without hardware:
`cd ../server && python3 main.py --offline` and `npm run dev`, then press D.
