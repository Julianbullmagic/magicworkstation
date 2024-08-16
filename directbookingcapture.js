require('dotenv').config();
const { OpenAI } = require("openai");
const clipboardy = require('node-clipboardy');
const { createClient } = require('@supabase/supabase-js');

let openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function getChatGPTResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      max_tokens: 180,
      model: "gpt-4o-mini",
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error getting ChatGPT response:", error);
    throw error;
  }
}

async function insertBooking(bookingData) {
  console.log("Checking for existing booking...");
  try {
    // Check for existing booking with the same customer name
    const { data: existingBookings, error: fetchError } = await supabase
      .from('Bookings')
      .select('*')
      .eq('customer_name', bookingData.customer_name);

    if (fetchError) throw fetchError;

    if (existingBookings && existingBookings.length > 0) {
      console.log("A booking for this customer already exists:", existingBookings[0]);
      return null; // Return null to indicate no insertion was made
    }

    // If no existing booking, proceed with insertion
    console.log("No existing booking found. Inserting new booking...");
    const { data, error } = await supabase
      .from('Bookings')
      .insert([bookingData])
      .select();

    if (error) throw error;
    console.log("New booking inserted successfully:", data);
    return data;
  } catch (error) {
    console.error("Error in booking process:", error);
    throw error;
  }
}

(async () => {
  try {
    const input = clipboardy.readSync();
    console.log("Clipboard content:", input);

    const prompt = `Here is some information about a confirmed booking, copied from a conversation or website "${input}".
    I would like you to respond with a JSON object containing properties for crucial booking information.
    Include properties for customer_name, email_address, phone_number, price, address, start_time, and end_time (in AEST).
    Also include a short summary in the summary property.
      There might be a conversation included in which the customer gives updated or more specific details about the event, in that
  case you should use this more recent or specific information in your response.
    The response should be a full, complete JSON object, starting with { and ending with } and nothing else outside this.
    It should be a JSON object, not a Javascript object. Include no special characters in the response, essentially it is minified.`;

    let chatGPTResponse = await getChatGPTResponse(prompt);
    console.log("ChatGPT response:", chatGPTResponse);

    let bookingData;
    try {
      bookingData = JSON.parse(chatGPTResponse);
    } catch (parseError) {
      console.error("Error parsing ChatGPT response:", parseError);
      console.log("Raw response:", chatGPTResponse);
      return;
    }

    bookingData.id = Date.now().toString();
    bookingData.created_at = new Date().toISOString();

    console.log("Parsed booking data:", bookingData);

    if (typeof bookingData === 'object' && bookingData.customer_name) {
      const result = await insertBooking(bookingData);
      if (result) {
        console.log("Booking inserted successfully:", result);
      } else {
        console.log("Booking was not inserted due to existing booking for this customer.");
      }
    } else {
      console.log("Parsed result is not a valid JavaScript object or missing customer_name.");
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();