export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. Handle GET requests for testing
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', agent: 'eveng2-edge-bridge' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Reject non-POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Security: Check G2_TOKEN if configured in Vercel
  const token = process.env.G2_TOKEN;
  const authHeader = req.headers.get('authorization');
  if (token && authHeader !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 4. Parse incoming Even app request and trim history
    const body = await req.json();
    // Only keep the last 4 messages to prevent the context window from bloating
    const incomingMessages = (body.messages || []).slice(-4);

// 5. Translate OpenAI format to Gemini Native format
    // Only keep the last 4 messages to prevent context bloat
    const trimmedMessages = (body.messages || []).slice(-4);
    const geminiContents = trimmedMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user', 
      parts: [{ text: msg.content }]
    }));

    // Construct native payload with the Google Search tool enabled
    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: "You are an AI on a tiny smart glasses display. Keep your answers extremely brief, strictly 1 or 2 sentences max. Use plain text only." }]
      },
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: 180
      },
      tools: [
        { google_search: {} } // This single line enables native web browsing
      ]
    };

    // 6. Forward directly to Google's Native Endpoint
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY // Native auth header
      },
      body: JSON.stringify(geminiPayload)
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("-> Gemini API Error:", data);
      return new Response(JSON.stringify(data), {
        status: geminiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 7. Intercept, strip markdown, and translate BACK to OpenAI format
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    let cleanText = rawText.replace(/[*#`~]/g, '');

    const openAiFormattedResponse = {
      choices: [
        {
          message: {
            role: "assistant",
            content: cleanText
          }
        }
      ]
    };

    return new Response(JSON.stringify(openAiFormattedResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
