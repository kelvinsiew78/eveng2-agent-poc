# eveng2-agent-poc

A tiny, dependency-light server that lets you point the **Even Realities G2**
smart glasses at **your own LLM** — and a way to *replicate from scratch* the
reverse-engineered "Add Agent" protocol the glasses use.

It does two jobs:

1. **Logs the full incoming request** (method, path, headers, body) so you can
   see exactly what the Even app sends.
2. **Returns a valid OpenAI chat-completion** so the glasses actually display a
   reply (out of the box it just echoes you back).

It's deliberately ~60 lines of Express with no SDK and no framework magic — so
nothing can quietly "fix" a malformed request and hide a discrepancy. Swap one
line and it becomes a real custom agent.

> Background / write-up: **[Peer-Reviewing the Even G2: Turns Out the Glasses Really Do Speak Plain OpenAI](https://fuscripts.com/fuschronicles/peer-reviewing-the-even-g2-turns-out-the-glasses-really-do-speak-plain-openai/)**

## The protocol (reverse-engineered — no official docs)

The G2's "Add Agent" URL is treated as an **OpenAI Chat Completions endpoint**,
non-streaming. The request originates from the **phone app** (Flutter/Dart), and
voice is transcribed **device-side**, so your server receives plain text.

**Request the app sends** — to the URL you enter, *verbatim* (no path appended):

```http
POST <your URL>
Authorization: Bearer <your Token>
Content-Type: application/json
User-Agent: Dart/3.8 (dart:io)

{ "model": "openclaw", "messages": [ { "role": "user", "content": "transcribed voice text" } ] }
```

The app also stamps an `x-openclaw-agent-id: main` header — OpenClaw awareness is
baked into Even Hub itself, so you'll see it even when your backend has nothing
to do with OpenClaw. Your server can ignore it.

**Response your server must return** — the glasses render `choices[0].message.content`:

```json
{
  "id": "g2-123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "your-agent",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "your reply" }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 10, "total_tokens": 10 }
}
```

## Replicate the test

### Prerequisites

- **Node 18+**
- A tunnel tool to expose localhost over HTTPS — the glasses call out over the
  public internet, so localhost alone won't work.
  [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  (free, no account) or [`ngrok`](https://ngrok.com/) both work.
- Even Realities G2 glasses + the Even app (v0.0.7+, with "Add Agent" support).

### 1. Install & run

```bash
git clone https://github.com/fuschini/eveng2-agent-poc.git
cd eveng2-agent-poc
npm install
G2_TOKEN=whatever npm start          # http://localhost:3000
```

`G2_TOKEN` is optional. Set it to enforce auth (the value must match the Token
you enter in the app); leave it unset to log unauthenticated probes too.

### 2. Expose it over HTTPS

```bash
npm run tunnel                       # cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

Copy the printed `https://<something>.trycloudflare.com` URL. (A fresh URL is
generated each run, so re-paste it into the app whenever you restart the tunnel.)

### 3. Point the glasses at it

In the **Even app → Settings → Add Agent**:

- **Name** — anything
- **URL** — your tunnel URL
- **Token** — the same value you passed as `G2_TOKEN` (or anything, if unset)

### 4. Talk to it

Trigger Even AI and speak. You'll see:

- the full request logged in your terminal (headers + body), and
- `You said: <your words>` rendered on the glasses display.

That's the round-trip confirmed end-to-end on real hardware.

### Test without glasses

You can exercise the endpoint with the exact shape the app sends:

```bash
curl -s -X POST http://localhost:3000 \
  -H "Authorization: Bearer whatever" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Dart/3.8 (dart:io)" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"what time is it"}]}'
```

## Make it a real agent

Replace the `reply` line in [`server.js`](./server.js) with a call to your LLM:

```js
const reply = await myLLM(text)   // keep it short + plain for the display
```

Two constraints from the hardware are worth respecting:

- **Display:** 576×136, 1-bit green, ~48 chars wide, ~8 lines. Plain text only —
  no markdown, images, or links. Strip code fences/URLs and keep replies short.
- **Timeout:** the app gives up around **~30s**. A slow model returns *nothing*.
  For long work, reply instantly ("working on it…") and deliver the real result
  out-of-band (Telegram, push, etc.).

This is the HTTP "Add Agent" path — distinct from the on-glasses **Even Hub SDK**.

## Prior work

This PoC independently reproduces protocol details first surfaced by:

- JU CHUN KO — *Even Realities G2 × OpenClaw Bridge*
- [`dAAAb/openclaw-even-g2-bridge-skill`](https://github.com/dAAAb/openclaw-even-g2-bridge-skill) (Cloudflare Worker reference implementation)
- [`even-realities/EvenDemoApp`](https://github.com/even-realities/EvenDemoApp) · [`i-soxi/even-g2-protocol`](https://github.com/i-soxi/even-g2-protocol) (BLE protocol)

## License

MIT — see [LICENSE](./LICENSE).
