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
    // 4. Parse incoming Even app request
    const body = await req.json();
    const incomingMessages = body.messages || [];

// 5. Construct payload for Gemini 3.5 Flash-Lite (Ultra-Fast)
    const geminiPayload = {
      ...body,
      model: "gemini-3.5-flash-lite", 
      messages: [
        { 
          role: "system", 
          content: "You are an AI on a tiny smart glasses display. Keep your answers extremely brief, strictly 1 or 2 sentences max. Use plain text only—no markdown, asterisks, or lists." 
        },
        ...incomingMessages
      ],
      max_tokens: 80
    };

    // 6. Forward directly to Google
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`
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

    // 7. Return the response back to the glasses
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("-> Edge fetch error:", error.message);
    return new Response(JSON.stringify({ error: "Failed to connect to Gemini" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
