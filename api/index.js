export const config = {
  runtime: 'edge',
  regions: ['sin1'],
};

export default async function handler(req) {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', agent: 'eveng2-edge-bridge' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // 1. Security Check
  const token = process.env.G2_TOKEN;
  const authHeader = req.headers.get('authorization');
  if (token && authHeader !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await req.json();
    const incomingMessages = (body.messages || []).slice(-4);

    // 2. Dynamic Context Injection (Time & Location)
    const city = req.headers.get('x-vercel-ip-city') || 'your location';
    const timezone = req.headers.get('x-vercel-ip-timezone') || 'Asia/Singapore';
    const currentTime = new Date().toLocaleString('en-US', { 
      timeZone: timezone, 
      hour: 'numeric', 
      minute: 'numeric', 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });

    const geminiContents = incomingMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user', 
      parts: [{ text: msg.content }]
    }));

    // 3. Optimized System Prompt for Smart Glasses
    const systemPrompt = `You are an AI on a tiny smart glasses HUD. 
    Rules: 
    - Strictly 1 or 2 sentences max. 
    - Use plain text only (no markdown, asterisks, or hashes). 
    - Use digits (5) instead of words (five) to save space.
    Context: The user is in ${city}. The current local time is ${currentTime}.`;

    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiContents,
      generationConfig: { maxOutputTokens: 180 },
      tools: [{ googleSearch: {} }]
    };

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(geminiPayload)
    });

    const data = await geminiResponse.json();

    // 4. Glasses-Friendly Error Handling (API level)
    if (!geminiResponse.ok) {
      console.error("-> Gemini API Error:", data);
      return returnAsGlassesText(`API Error: ${data.error?.message?.substring(0, 40) || 'Google servers unavailable.'}`);
    }

    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response found.";
    let cleanText = rawText.replace(/[*#`~]/g, '');

    return returnAsGlassesText(cleanText);

  } catch (error) {
    // 5. Glasses-Friendly Error Handling (Execution level)
    console.error("-> Edge fetch error:", error.message);
    return returnAsGlassesText("Proxy error: Failed to connect.");
  }
}

// Helper function to format any text into the OpenAI format the Even app expects
function returnAsGlassesText(text) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: text } }]
  }), {
    status: 200, // Always return 200 so the glasses display the text instead of crashing
    headers: { 'Content-Type': 'application/json' },
  });
}
