// Game Studio — tiny server that gives the app a real AI brain.
//
// Your API key lives here on the server, never in the browser, so the page can
// be shared with anyone without handing out your key.
//
//   1. npm install
//   2. put your key in a .env file (copy .env.example)
//   3. npm start   ->   http://localhost:3000

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'claude-opus-5';

// Read .env without pulling in a dependency.
try {
  const env = fs.readFileSync(path.join(HERE, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — fall back to real environment variables */ }

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasKey ? new Anthropic() : null;

const SYSTEM = `You are the assistant inside "Game Studio", a small web app.

The app can already build these itself, instantly and offline — if the user asks
for one of them, reply with a short friendly sentence and NOTHING else, because
the app loads it for you: a drawing pad, a to-do list, a calculator, a beat
maker, a website, a 3D block world, snake, breakout, memory match, tic-tac-toe.

For anything else, just be genuinely helpful: answer questions, explain things,
write, plan, do maths, talk things through. Keep replies short and warm unless
the user clearly wants depth. Plain text, no markdown headers.`;

// The app's four model tiers. Epic is the full-strength one; each step down is
// deliberately terser and cheaper, which is what the tier picker is promising.
const TIERS = {
  4: { max_tokens: 4000, effort: 'medium', system: 'Tier: Epic. Give your fullest, most thoughtful answer. Explain properly, add the useful detail, and offer a next step.' },
  3: { max_tokens: 1200, effort: 'medium', system: 'Tier: Ballad. Give a solid, balanced answer in a few sentences. No padding.' },
  2: { max_tokens: 400,  effort: 'low',    system: 'Tier: Verse. Answer in one or two short sentences. Nothing extra.' },
  1: { max_tokens: 150,  effort: 'low',    system: 'Tier: Couplet. Answer in the fewest words possible — often a single line. Never elaborate.' },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

async function handleChat(req, res) {
  if (!client) {
    return send(res, 503, JSON.stringify({
      error: 'no_key',
      message: 'No API key set. Copy .env.example to .env and put your key in it, then restart.',
    }));
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200_000) return send(res, 413, JSON.stringify({ error: 'too_big' }));
  }

  let turns, tier;
  try {
    const body = JSON.parse(raw || '{}');
    turns = Array.isArray(body.messages) ? body.messages : null;
    tier = Number(body.tier) || 4;
  } catch {
    return send(res, 400, JSON.stringify({ error: 'bad_json' }));
  }
  if (!turns || !turns.length) return send(res, 400, JSON.stringify({ error: 'no_messages' }));

  // Keep only what we expect, and cap the history so costs stay predictable.
  const messages = turns
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[0].role !== 'user') {
    return send(res, 400, JSON.stringify({ error: 'bad_messages' }));
  }

  try {
    const style = TIERS[Math.min(4, Math.max(1, tier))];
    const request = {
      model: MODEL,
      max_tokens: style.max_tokens,
      output_config: { effort: style.effort },
      system: SYSTEM + '\n\n' + style.system,
      messages,
    };

    let response;
    try {
      response = await client.messages.create(request);
    } catch (err) {
      // A model that does not take an effort setting should still answer.
      if (err instanceof Anthropic.BadRequestError && /effort|output_config/i.test(err.message || '')) {
        delete request.output_config;
        response = await client.messages.create(request);
      } else {
        throw err;
      }
    }

    if (response.stop_reason === 'refusal') {
      return send(res, 200, JSON.stringify({ text: "I can't help with that one — try something else." }));
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    send(res, 200, JSON.stringify({ text: text || "I didn't catch that — could you rephrase?", usage: response.usage }));
  } catch (err) {
    console.error('[chat]', err?.status || '', err?.message || err);
    if (err instanceof Anthropic.AuthenticationError) {
      return send(res, 401, JSON.stringify({ error: 'bad_key', message: 'That API key was rejected. Check it in .env.' }));
    }
    if (err instanceof Anthropic.RateLimitError) {
      return send(res, 429, JSON.stringify({ error: 'rate_limited', message: 'Too many requests — give it a moment.' }));
    }
    if (err instanceof Anthropic.APIError) {
      return send(res, 502, JSON.stringify({ error: 'api_error', message: err.message }));
    }
    send(res, 500, JSON.stringify({ error: 'server_error', message: 'Something went wrong.' }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/status') {
    return send(res, 200, JSON.stringify({ ai: hasKey, model: hasKey ? MODEL : null }));
  }
  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'use_post' }));
    return handleChat(req, res);
  }

  // Static files, confined to this folder.
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(HERE, rel);
  if (!file.startsWith(HERE)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`\n  Game Studio -> http://localhost:${PORT}`);
  console.log(hasKey ? `  AI: on (${MODEL})` : '  AI: off — no ANTHROPIC_API_KEY found, the built-in bot will answer instead.');
  console.log('');
});
