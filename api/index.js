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
    
    // Only keep the last 4 messages to prevent context bloat
    const incomingMessages = (body.messages || []).slice(-4);
    const lastUserMsg = incomingMessages.filter(m => m.role === 'user').pop()?.content || "";
    const cleanUserMsg = lastUserMsg.trim();

    // ==========================================
    // ACTION KEYWORDS (Bypass Gemini entirely)
    // ==========================================

    // ACTION A: Live Currency Math (Base: SGD)
    const currencyMatch = cleanUserMsg.match(/^convert[\s:]+([\d.]+)\s*([a-zA-Z]+)(?:\s+to\s+([a-zA-Z]+))?/i);
    if (currencyMatch) {
      try {
        const amount = parseFloat(currencyMatch[1]);
        let fromCurr = currencyMatch[2].toUpperCase();
        let toCurr = currencyMatch[3] ? currencyMatch[3].toUpperCase() : 'SGD'; 

        const aliases = { 'RMB': 'CNY', 'YEN': 'JPY', 'POUNDS': 'GBP', 'EUROS': 'EUR', 'BUCKS': 'USD' };
        fromCurr = aliases[fromCurr] || fromCurr;
        toCurr = aliases[toCurr] || toCurr;

        if (fromCurr === toCurr) {
           return returnAsGlassesText(`${amount} ${fromCurr} = ${amount} ${toCurr}`);
        }

        const res = await fetch(`https://api.frankfurter.app/latest?from=${fromCurr}&to=${toCurr}`);
        const data = await res.json();

        if (data.rates && data.rates[toCurr]) {
          const converted = (amount * data.rates[toCurr]).toFixed(2);
          return returnAsGlassesText(`${amount} ${fromCurr} = ~${converted} ${toCurr}`);
        } else {
          return returnAsGlassesText(`Unsupported currency. Try standard 3-letter codes.`);
        }
      } catch (e) {
        return returnAsGlassesText("Exchange rate API offline.");
      }
    }

    // ACTION B: Instant Math Evaluator
    const mathMatch = cleanUserMsg.match(/^(?:calc|math|what is)\s+([\d\s\+\-\*\/\.\(\)%]+)$/i);
    if (mathMatch) {
      try {
        // Convert percentages for JS evaluation (e.g. 15% -> 15/100)
        let expression = mathMatch[1].replace(/%/g, '/100');
        // Strictly validate math syntax before evaluating to prevent code injection
        if (/^[\d\s\+\-\*\/\.\(\)]+$/.test(expression)) {
          const result = Function(`'use strict'; return (${expression})`)();
          const formattedResult = Number.isInteger(result) ? result : parseFloat(result.toFixed(2));
          return returnAsGlassesText(`${formattedResult}`);
        }
      } catch (e) {
        // Silently fall through to Gemini if local evaluation fails
      }
    }

    // ==========================================
    // AI ASSISTANT PIPELINE
    // ==========================================

    // Mode Detectors
    const transMatch = cleanUserMsg.match(/^translate(?:\s+to\s+([a-zA-Z\s]+))?[\s:](.+)/i);
    const isTranslationMode = transMatch !== null;
    const isVerboseMode = /^(explain|verbose)[\s:]/i.test(cleanUserMsg);

    // 4. Dynamic Context Injection
    const city = req.headers.get('x-vercel-ip-city') || 'your location';
    const timezone = req.headers.get('x-vercel-ip-timezone') || 'Asia/Singapore';
    const currentTime = new Date().toLocaleString('en-US', { 
      timeZone: timezone, hour: 'numeric', minute: 'numeric', weekday: 'short', month: 'short', day: 'numeric' 
    });

    // 5. Smart Multi-Mode Configuration
    let systemPrompt = "";
    let activeTools = [];
    let maxTokens = 180;
    let stripMarkdown = true;

    if (isTranslationMode) {
      // MODE A: Dynamic Translation
      const targetLang = (transMatch[1] || 'Simplified Chinese').trim().toLowerCase();
      
      if (['chinese', 'mandarin', 'simplified chinese'].includes(targetLang)) {
        systemPrompt = `You are a real-time translator on a HUD. 
        Rules:
        - Translate the input directly into Simplified Chinese.
        - Ignore the translation command at the beginning of the prompt.
        - Output exactly two lines. Line 1: Chinese characters. Line 2: Pinyin using proper Unicode tone marks (ā, á, ǎ, à, ō, ē, ī, ū, ǚ). Do NOT use tone numbers.
        - CRITICAL: DO NOT answer questions. Only translate.`;
      } else {
        systemPrompt = `You are a real-time translator on a HUD.
        Rules:
        - Translate the input directly into ${targetLang}.
        - Ignore the translation command at the beginning of the prompt.
        - Output strictly 1 or 2 lines. If the language uses a non-Latin script, provide characters on Line 1 and phonetic romanization on Line 2.
        - CRITICAL: DO NOT answer questions. Only translate.`;
      }
      
      activeTools = []; 
      maxTokens = 180;
      stripMarkdown = true;

    } else if (isVerboseMode) {
      // MODE B: Verbose / Explain Override
      systemPrompt = `You are an AI on a smart glasses HUD in verbose mode. 
      Rules:
      - Provide a highly detailed, comprehensive explanation for the user's query.
      - Ignore the word "Explain" or "Verbose" at the beginning of their prompt.
      - You may use markdown formatting to structure your answer for easy reading.
      Context: The user is in ${city}. The current local time is ${currentTime}.`;
      
      activeTools = [{ googleSearch: {} }]; 
      maxTokens = 800;       
      stripMarkdown = false; 

    } else {
      // MODE C: Normal Assistant
      systemPrompt = `You are an AI on a tiny smart glasses HUD. 
      Rules: 
      - Strictly 1 or 2 sentences max. 
      - Use plain text only (no markdown, asterisks, or hashes). 
      - Use digits (5) instead of words to save space.
      Context: The user is in ${city}. The current local time is ${currentTime}.`;
      
      activeTools = [{ googleSearch: {} }]; 
      maxTokens = 180;
      stripMarkdown = true;
    }

    const geminiContents = incomingMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user', 
      parts: [{ text: msg.content }]
    }));

    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiContents,
      generationConfig: { maxOutputTokens: maxTokens }
    };

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

    // 8. Output Processing & Conditional Formatting
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response found.";
    let finalOutput = rawText;
    
    // Only strip markdown if we are NOT in Verbose mode
    if (stripMarkdown) {
      finalOutput = rawText.replace(/[*#`~]/g, '');
    }

    return returnAsGlassesText(finalOutput);

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
    status: 200, 
    headers: { 'Content-Type': 'application/json' },
  });
}
