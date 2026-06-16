/**
 * Even Realities G2 — custom Even AI agent PoC.
 *
 * The Even app's "Add Agent" feature treats your URL as an OpenAI
 * Chat Completions endpoint (non-streaming). It POSTs the transcribed
 * voice text and renders `choices[0].message.content` on the glasses.
 *
 * This server does two jobs:
 *   1. Logs the full incoming request (method, path, headers, body) so we
 *      can confirm exactly what *this* app/firmware version sends.
 *   2. Returns a valid chat-completion so the glasses actually display
 *      something (here: it just echoes you back).
 *
 * Swap the `reply` line for a real LLM call once the shape is confirmed.
 */
import express from "express"

const app = express()
app.use(express.json({ limit: "1mb" }))

const PORT = process.env.PORT || 3000
// Set to the token you typed into the Even app to enforce auth. Leave unset
// while poking so you can see unauthenticated probes too.
const TOKEN = process.env.G2_TOKEN

// Single catch-all handler — works on any path/method and avoids Express 5's
// wildcard-route syntax change. The app POSTs to the URL you enter verbatim,
// so whatever path it uses lands here.
app.use((req, res) => {
  console.log(
    `\n=== ${req.method} ${req.originalUrl}  ${new Date().toISOString()} ===`
  )
  console.log("headers:", JSON.stringify(req.headers, null, 2))
  console.log("body:   ", JSON.stringify(req.body, null, 2))

  if (req.method === "GET")
    return res.json({ status: "ok", agent: "eveng2-agent-poc" })
  if (req.method !== "POST")
    return res.status(405).json({ error: "method not allowed" })

  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    console.log("-> rejected: bad/missing token")
    return res.status(401).json({ error: "unauthorized" })
  }

  const userMsg = (req.body?.messages || [])
    .filter((m) => m.role === "user")
    .pop()
  const text = userMsg?.content ?? "(no user message)"

  // Keep it short + plain: G2 is 576x136 mono, ~48 chars wide, no markdown/links.
  const reply = `You said: ${text}`.slice(0, 400)
  console.log("-> reply:", reply)

  res.json({
    id: `g2-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "eveng2-agent-poc",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: reply },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: reply.length,
      total_tokens: reply.length,
    },
  })
})

app.listen(PORT, () => {
  console.log(`G2 agent PoC listening on :${PORT}`)
  console.log(
    TOKEN ? "Auth: enforcing G2_TOKEN" : "Auth: open (set G2_TOKEN to enforce)"
  )
})
