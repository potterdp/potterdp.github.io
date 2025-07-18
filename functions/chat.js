exports.handler = async (event, context) => {
  const { message } = JSON.parse(event.body);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are The Calculus Cougar, a patient calculus tutor for college students." },
          { role: "user", content: message }
        ],
        temperature: 0.5,
        max_tokens: 500
      })
    });

    const data = await response.json();
    console.log('OpenAI response:', JSON.stringify(data));

    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    console.error('Error communicating with OpenAI:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error communicating with OpenAI' })
    };
  }
};
