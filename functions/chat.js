const fetch = require('node-fetch'); //include fetch, since not native in Netlify 

exports.handler = async (event, context) => {
  const { message } = JSON.parse(event.body);//reads the POSTed body from the frontend and extracts the message field

  try {//Makes a POST request to OpenAI’s Chat Completion endpoint with required secret API Key
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

    //Receives response from chatbot.
    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: data.choices[0].message.content })
    };

  } catch (err) {//error handling
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error communicating with OpenAI' })
    };
  }
};
