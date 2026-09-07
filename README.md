# Game Studio

A browser app you can build things in. Ask it for a website, a 3D block world, or a
game, and it appears — playable — right in the page.

It runs two ways:

- **Just open the file.** Everything works offline — every game, every tool, maths,
  timers, notes. No sign-in, no server, nothing leaves your device.
- **Run it with your own API key** (below). Then it also has a real AI behind it, so
  it can answer anything, not just the things it was taught. Your key, your account —
  it never asks anyone to sign in to Claude.

## Files

| File | What it is |
|---|---|
| `index.html` | The landing page, with a live model-tier demo and a playable game |
| `app.html` | The app itself |
| `server.js` | The optional little server that gives it a real AI brain |
| `.env.example` | Where your API key goes (copy it to `.env`) |

Open either HTML file in a browser — double-click it, or host it anywhere.

## Turning on the real AI

You need [Node.js](https://nodejs.org) and an API key from
[console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**.

```bash
npm install
cp .env.example .env      # then open .env and paste your key in
npm start
```

Open **http://localhost:3000**. A green **● live AI** badge appears next to Send when
it's working.

Three things worth knowing:

- **Your key stays on the server.** It is read from `.env`, which is git-ignored, and
  is never sent to the browser — so you can share the page without sharing the key.
- **Games are still instant and offline.** Only questions the app can't answer itself
  get sent onward, so you're not paying for "play snake" or "12 × 8".
- **The tiers are real.** Epic gets the fullest answer; Couplet gets one line. Lower
  tiers cost less.

If the server isn't running, the page quietly falls back to the built-in bot — nothing
breaks, it just gets simpler.

## Publishing it so anyone can use it

These are plain static files, so any static host works. With GitHub Pages:

1. Go to **Settings → Pages** in this repository.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick this branch and the `/ (root)` folder, then **Save**.

Your public address will be:

```
https://<your-username>.github.io/TestProjectJandsOn/
```

Anyone can open that — no account, no sign-in.

## What's inside the app

- **Models** — Epic, Ballad, Verse, Couplet, best to most basic. They change how it
  writes, how hard it thinks, *and* how detailed the thing it builds comes out.
- **Chats** — several open at once as tabs, each with its own conversation and game, saved between visits.
- **Code** — a live editor with Run, plus an assistant that edits for you
  ("make it faster", "make it green", "explain this code").
- **Notes** — jot notes with a mood, kept on your device.
- **Builds** — a website, a 3D block world, Snake, Breakout, Memory Match, Tic-Tac-Toe.
- **Also does** — maths, percentages, unit conversions, dates, counting, dice, timers and jokes.
