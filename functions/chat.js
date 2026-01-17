// functions/chat.js
import { createClient } from "@supabase/supabase-js";

function sanitizeChunk(text) {
  return (text || "")
    .replace(/\\sin\s*ce\b/gi, "since")
    .replace(/u\\sin\s*g\b/gi, "using")
    .replace(/ins\\tan\s*ce\b/gi, "instance")
    .replace(/\bcontinuous function\s+1\b/gi, "continuous function f")
    .replace(/\bfunction\s+1\b/gi, "function f")
    .replace(/\binterval\s+1\b/gi, "interval [a,b]")
    .replace(/\bvalue\s+1\b/gi, "value c")
    .replace(/\bTheorem\s*1\b/gi, "Theorem")
    .replace(/\*\*/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/This OpenStax book is available for free at\s+https?:\/\/\S+/gi, "")
    .replace(/Download for free at\s+https?:\/\/\S+/gi, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let sessions = {}; // In-memory session storage (resets on redeploy)

// Create Supabase client (URL + key must be set in Netlify env vars)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// CORS helper (Canvas embedding often requires this)
function withCors(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(bodyObj)
  };
}

export async function handler(event, context) {
  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return withCors(200, { ok: true });
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch {
    return withCors(400, { error: "Invalid JSON body" });
  }

  const { message, sessionId, context: usageContext } = parsed;

  if (!message || typeof message !== "string") {
    return withCors(400, { error: "Missing or invalid 'message'" });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return withCors(400, { error: "Missing or invalid 'sessionId'" });
  }

  const ctxTag = (usageContext && typeof usageContext === "string")
    ? usageContext
    : "free_use";

  // Initialize a session if none exists
  if (!sessions[sessionId]) {
    sessions[sessionId] = [
      {
        role: "system",
        content: `
You are The Calculus Cougar, a Socratic calculus tutor for college students.

VERY IMPORTANT RULES:
- Always format mathematics using LaTeX with dollar delimiters:
    * Inline math must be written as $ ... $
    * Display math must be written as $$ ... $$
- Never use \\$begin:math:text$ ... \\\\$end:math:text$ or \\$begin:math:display$ ... \\\\$end:math:display$ unless the user types it that way.

Tutoring philosophy:
- Use the OpenStax Calculus I textbook as your primary reference.
- Do not just give answers; instead, ask guiding questions and encourage students to explain their reasoning.
- Scaffold solutions step by step, offering hints and suggestions.
- Keep tone patient, encouraging, supportive.
- If a student seems stuck, give them a gentle nudge rather than the full solution immediately.
- Share study strategies when useful.
        `.trim()
      }
    ];
  }

  // 1) Embed the student’s question
  let queryEmbedding;
  try {
    const embedResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: message
      })
    });
    const embedData = await embedResponse.json();
    queryEmbedding = embedData.data?.[0]?.embedding;
    if (!queryEmbedding) throw new Error("No embedding returned");
  } catch (err) {
    console.error("Error creating embedding:", err);
    return withCors(500, { error: "Failed to create embedding" });
  }

  // 2) Query Supabase for top textbook chunks
  let retrievedChunks = "";
  try {
    const { data, error } = await supabase.rpc("match_textbook_chunks_v2", {
      query_embedding: queryEmbedding,
      match_count: 3
    });

    if (error) {
      console.error("Supabase match error:", error);
    } else if (data) {
      retrievedChunks = data
        .map((row) => `From page ${row.page}:\n${sanitizeChunk(row.content)}`)
        .join("\n\n");
    }
  } catch (err) {
    console.error("Error querying Supabase:", err);
  }

  // 3) Add system message with reference material
  if (retrievedChunks) {
    sessions[sessionId].push({
      role: "system",
      content: `REFERENCE EXCERPTS (OpenStax Calculus Vol. 1):
- Use these excerpts ONLY as grounding.
- If notation looks corrupted, rewrite it into clean LaTeX before presenting it.
- Do not copy OCR artifacts (examples: "\\sin ce", "u\\sin g", "ins\\tan ce") into your response.

${retrievedChunks}`.trim()
    });
  }

  // 4) Add user message to history
  sessions[sessionId].push({ role: "user", content: message });

  // 4b) Log user message (don’t fail the chat if logging fails)
  try {
    const { error: logUserErr } = await supabase.from("chat_logs").insert({
      session_id: sessionId,
      context: ctxTag,
      role: "user",
      content: message
    });
    if (logUserErr) console.error("Error logging user message:", logUserErr);
  } catch (e) {
    console.error("Exception logging user message:", e);
  }

  try {
    // 5) Call OpenAI chat with context
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: sessions[sessionId],
        temperature: 0.6,
        max_tokens: 500
      })
    });

    const data = await response.json();
    const reply =
      data.choices?.[0]?.message?.content ||
      "Sorry, I could not generate a response.";

    // Save assistant reply in memory
    sessions[sessionId].push({ role: "assistant", content: reply });

    // Log assistant reply
    try {
      const { error: logAsstErr } = await supabase.from("chat_logs").insert({
        session_id: sessionId,
        context: ctxTag,
        role: "assistant",
        content: reply
      });
      if (logAsstErr) console.error("Error logging assistant reply:", logAsstErr);
    } catch (e) {
      console.error("Exception logging assistant reply:", e);
    }

    return withCors(200, { reply });
  } catch (err) {
    console.error("Error communicating with OpenAI:", err);
    return withCors(500, { error: "Error communicating with OpenAI" });
  }
}