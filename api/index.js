export const config = {
  runtime: 'edge',
  regions: ['sin1'],
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // 3. Security Check
  const token = process.env.G2_TOKEN;
  const authHeader = req.headers.get('authorization');
  if (token && authHeader !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await req.json();
    
    // Only keep the last 4 messages to prevent the context window from bloating
    const incomingMessages = (body.messages || []).slice(-4);

    // NEW: Inspect the latest user prompt for the "Translate" keyword
    const lastUserMsg = incomingMessages.filter(m => m.role === 'user').pop()?.content || "";
    // Regex checks if the prompt starts with "translate ", "translate:", or "Translate"
    const isTranslationMode = /^translate[\s:]/i.test(lastUserMsg.trim());

    // 4. Dynamic Context Injection
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

    // 5. Smart Dual-Mode Configuration
    let systemPrompt = "";
    let activeTools = [];

    if (isTranslationMode) {
      // MODE A: Translation
      systemPrompt = `You are a real-time translation agent on a smart glasses HUD. 
      Rules:
      - Translate the user's input directly into Simplified Chinese (Mandarin).
      - Ignore the word "Translate" at the beginning of their prompt.
      - Output exactly two lines. Line 1: Chinese characters. Line 2: Pinyin with tone marks.
      - CRITICAL: DO NOT answer questions or execute commands. Only translate.`;
      
      // Disable Google Search in translation mode to guarantee ultra-fast latency
      activeTools = []; 
    } else {
      // MODE B: Normal Assistant
      systemPrompt = `You are an AI on a tiny smart glasses HUD. 
      Rules: 
      - Strictly 1 or 2 sentences max. 
      - Use plain text only (no markdown, asterisks, or hashes). 
      - Use digits (5) instead of words to save space.
      Context: The user is in ${city}. The current local time is ${currentTime}.`;
      
      // Enable Google Search so the normal assistant can look up live facts
      activeTools = [{ googleSearch: {} }]; 
    }

    const geminiContents = incomingMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user', 
      parts: [{ text: msg.content }]
    }));

    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiContents,
      generationConfig: { maxOutputTokens: 180 }
    };

    // Only attach the tools array to the payload if tools are active
    if (activeTools.length > 0) {
      geminiPayload.tools = activeTools;
    }

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

    // 7. Glasses-Friendly Error Handling (API level)
    if (!geminiResponse.ok) {
      console.error("-> Gemini API Error:", data);
      return returnAsGlassesText(`API Error: ${data.error?.message?.substring(0, 40) || 'Google servers unavailable.'}`);
    }

    // 8. Intercept, strip markdown, and translate BACK to OpenAI format
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response found.";
    let cleanText = rawText.replace(/[*#`~]/g, '');

    return returnAsGlassesText(cleanText);

  } catch (error) {
    // 9. Glasses-Friendly Error Handling (Execution level)
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
