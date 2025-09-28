// functions/chat.js
import { createClient } from "@supabase/supabase-js";
// 

let sessions = {}; // In-memory session storage (resets on redeploy)

// Create Supabase client (URL + key must be set in Netlify env vars)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event, context) {
  const { message, sessionId } = JSON.parse(event.body);

  // Initialize a session if none exists
  if (!sessions[sessionId]) {
    sessions[sessionId] = [
      {
        role: "system",
        content: `
          You are The Calculus Cougar, a Socratic calculus tutor for college students.
          
          VERY IMPORTANT RULE:
          - Always format mathematics using LaTeX with dollar delimiters:
              * Inline math must be written as $ ... $
              * Display math must be written as $$ ... $$
          - Never use $begin:math:text$ ... $end:math:text$ or \[ ... \) unless the user specifically types it that way.
          
          Tutoring philosophy:
          - Use the OpenStax Calculus I textbook as your primary reference.
          - Do not just give answers; instead, ask guiding questions and encourage students to explain their reasoning.
          - Scaffold solutions step by step, offering hints and suggestions.
          - Keep tone patient, encouraging, supportive.
          - If a student seems stuck, give them a gentle nudge rather than the full solution immediately.
          - Share study strategies when useful.
        `   
      }
    ];
  }

  // 1. Embed the student’s question
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
    queryEmbedding = embedData.data[0].embedding;
  } catch (err) {
    console.error("Error creating embedding:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create embedding" })
    };
  }

  // 2. Query Supabase for top textbook chunks
  let retrievedChunks = "";
  try {
    const { data, error } = await supabase.rpc("match_textbook_chunks", {
      query_embedding: queryEmbedding,
      match_count: 3 // number of chunks to retrieve
    });

    if (error) {
      console.error("Supabase match error:", error);
    } else if (data) {
      retrievedChunks = data.map((row) => row.content).join("\n\n");
    }
  } catch (err) {
    console.error("Error querying Supabase:", err);
  }

  // 3. Add system message with reference material
  if (retrievedChunks) {
    sessions[sessionId].push({
      role: "system",
      content: `Reference material from OpenStax:\n\n${retrievedChunks}`
    });
  }

  // Add user message to history
  sessions[sessionId].push({ role: "user", content: message });

  try {
    // Call OpenAI chat with context
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
    let reply =
      data.choices?.[0]?.message?.content ||
      "Sorry, I could not generate a response.";

    // Normalize math delimiters
    reply = reply
      .replace(/\\\((.*?)\\\)/gs, "\$$1\$")
      .replace(/\\\[(.*?)\\\]/gs, "\$\$$1\$\$");

    // Save assistant reply
    sessions[sessionId].push({ role: "assistant", content: reply });

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error("Error communicating with OpenAI:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error communicating with OpenAI" })
    };
  }
}
