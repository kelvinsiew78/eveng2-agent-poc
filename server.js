/**
 * Even Realities G2 — custom Even AI agent PoC with Gemini integration.
 *
 * The Even app's "Add Agent" feature treats your URL as an OpenAI
 * Chat Completions endpoint (non-streaming). It POSTs the transcribed
 * voice text and renders `choices[0].message.content` on the glasses.
 *
 * This server does two jobs:
 *   1. Logs the full incoming request (method, path, headers, body).
 *   2. Forwards the request to Google's Gemini OpenAI-compatible endpoint
 *      and returns the real LLM response to the glasses.
 */
import express from "express"

const app = express()
app.use(express.json({ limit: "1mb" }))

const PORT = process.env.PORT || 3000
// Optional: Set to the token you typed into the Even app to enforce auth. 
// Leave unset if you just want to rely on Vercel's environment variables for API keys.
const TOKEN = process.env.G2_TOKEN

// Single catch-all handler — works on any path/method
app.use(async (req, res) => {
  console.log(
    `\n=== ${req.method} ${req.originalUrl}  ${new Date().toISOString()} ===`
  )
  console.log("headers:", JSON.stringify(req.headers, null, 2))
  console.log("body:   ", JSON.stringify(req.body, null, 2))

  if (req.method === "GET")
    return res.json({ status: "ok", agent: "eveng2-gemini-bridge" })
  if (req.method !== "POST")
    return res.status(405).json({ error: "method not allowed" })

  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    console.log("-> rejected: bad/missing token")
    return res.status(401).json({ error: "unauthorized" })
  }

// 1. Extract the messages the Even app sent
  const incomingMessages = req.body.messages || [];

  // 2. Inject a system prompt and enforce strict limits
 const geminiPayload = {
    ...req.body,
    model: "gemini-3.8-flash",
    reasoning_effort: "low", // Add this line to force instant replies
    messages: [
      { 
        role: "system", 
        content: "You are an AI on a tiny smart glasses display. Keep your answers extremely brief, strictly 1 or 2 sentences max. Use plain text only—no markdown, asterisks, or lists." 
      },
      ...incomingMessages
    ],
    max_tokens: 80
  };

  try {
    // 2. Send the request to Google's OpenAI-compatible endpoint
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`
      },
      body: JSON.stringify(geminiPayload)
    });

    const data = await geminiResponse.json();

    // 3. Handle any Google API errors
    if (!geminiResponse.ok) {
      console.error("-> Gemini API Error:", data);
      return res.status(geminiResponse.status).json(data);
    }

    // 4. Log the AI's reply and pass the valid JSON straight to the glasses
    console.log("-> reply:", data.choices?.[0]?.message?.content);
    return res.json(data);

  } catch (error) {
    console.error("-> Fetch error:", error);
    return res.status(500).json({ error: "Failed to connect to Gemini" });
  }
})

app.listen(PORT, () => {
  console.log(`G2 agent PoC listening on :${PORT}`)
  console.log(
    TOKEN ? "Auth: enforcing G2_TOKEN" : "Auth: open (set G2_TOKEN to enforce)"
  )
})
