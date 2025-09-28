// functions/chat.js

let sessions = {}; // In-memory session storage (resets on redeploy)

exports.handler = async (event, context) => {
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

  // Add user message to history
  sessions[sessionId].push({ role: "user", content: message });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // better at reasoning than gpt-3.5
        messages: sessions[sessionId],
        temperature: 0.6,
        max_tokens: 500
      })
    });

    const data = await response.json();
    console.log("OpenAI response:", JSON.stringify(data));

    const reply = data.choices?.[0]?.message?.content || "Sorry, I could not generate a response.";

    // Normalize LaTeX delimiters
    reply = reply
      // Inline: \( ... \) → $ ... $
      .replace(/\\\((.*?)\\\)/gs, '\$$1\$')
      // Display: \[ ... \] → $$ ... $$
      .replace(/\\\[(.*?)\\\]/gs, '\$\$$1\$\$');
    
    // Save assistant reply into session
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
};

