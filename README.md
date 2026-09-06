# Game Studio

A self-contained browser app. Ask it for a website, a 3D block world, or a game,
and it appears — playable — right in the page. No sign-in, no server, no AI service:
everything runs in your browser and your data stays on your device.

## Files

| File | What it is |
|---|---|
| `index.html` | The landing page, with a live model-tier demo and a playable game |
| `app.html` | The app itself |

Open either file in a browser — double-click it, or host it anywhere.

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
  writes *and* how detailed the thing it builds comes out.
- **Chats** — several open at once as tabs, each with its own conversation and game, saved between visits.
- **Code** — a live editor with Run, plus an assistant that edits for you
  ("make it faster", "make it green", "explain this code").
- **Notes** — jot notes with a mood, kept on your device.
- **Builds** — a website, a 3D block world, Snake, Breakout, Memory Match, Tic-Tac-Toe.
- **Also does** — maths, percentages, unit conversions, dates, counting, dice, timers and jokes.
