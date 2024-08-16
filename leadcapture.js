require('dotenv').config();
const { OpenAI } = require("openai");
const axios = require('axios');
const clipboardy = require('node-clipboardy');
const { createClient } = require('@supabase/supabase-js');

let openai = new OpenAI({
  apiKey: process.env.OPENAIKEYTWO,
});

const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);


const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

async function geocodeAddress(address) {
  try {
    const response = await axios.get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_ACCESS_TOKEN}`);
    const [longitude, latitude] = response.data.features[0].center;
    return { latitude, longitude };
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
}

async function calculateTravelTime(origin, destination) {
  try {
    const response = await axios.get(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?access_token=${MAPBOX_ACCESS_TOKEN}`);
    const travelTimeHours = response.data.durations[0][1] / 3600;
    return travelTimeHours;
  } catch (error) {
    console.error('Error calculating travel time:', error);
    return null;
  }
}

function isPeakTrafficTime(dateTime) {
  const hour = dateTime.getHours();
  const minute = dateTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  const morningPeakStart = 7 * 60;
  const morningPeakEnd = 9 * 60;
  const eveningPeakStart = 16 * 60;
  const eveningPeakEnd = 18 * 60 + 30;

  return (timeInMinutes >= morningPeakStart && timeInMinutes <= morningPeakEnd) ||
         (timeInMinutes >= eveningPeakStart && timeInMinutes <= eveningPeakEnd);
}

function checkTimeOverlap(lead, booking) {
  const leadStart = new Date(lead.start_time);
  const leadEnd = new Date(lead.end_time);
  const bookingStart = new Date(booking.start_time);
  const bookingEnd = new Date(booking.end_time);

  return (leadStart < bookingEnd && leadEnd > bookingStart);
}
async function processLead(lead, bookings) {
  const leadCoords = await geocodeAddress(lead.address);
  if (!leadCoords) {
    console.error("Failed to geocode lead address");
    return null;
  }

  lead.latitude = leadCoords.latitude;
  lead.longitude = leadCoords.longitude;

  const nearbyBookings = filterBookingsThatAreCloseInTimeToLead(lead, bookings);

  const processedBookings = [];
  const overlappingBookingIds = [];
  const insufficientTravelTimeBookingIds = [];

  for (const booking of nearbyBookings) {
    const bookingCoords = await geocodeAddress(booking.address);
    if (!bookingCoords) {
      console.error(`Failed to geocode booking address for booking ${booking.id}`);
      continue;
    }

    booking.latitude = bookingCoords.latitude;
    booking.longitude = bookingCoords.longitude;

    const isOverlapping = checkTimeOverlap(lead, booking);
    if (isOverlapping) {
      overlappingBookingIds.push(booking.id);
    }
    
    let travelTime = await calculateTravelTime(leadCoords, bookingCoords);
    if (travelTime !== null) {
      if (isPeakTrafficTime(new Date(lead.start_time)) || isPeakTrafficTime(new Date(booking.start_time))) {
        travelTime *= 1.3;
      }
    }

    const timeBetweenEvents = Math.abs(new Date(lead.start_time) - new Date(booking.start_time)) / (1000 * 60 * 60);
    const insufficientTravelTime = travelTime !== null && timeBetweenEvents < travelTime;
    if (insufficientTravelTime) {
      insufficientTravelTimeBookingIds.push(booking.id);
    }

    processedBookings.push({
      ...booking,
      isOverlapping,
      travelTime,
      insufficientTravelTime
    });
  }

  return {
    ...lead,
    processedBookings,
    overlapping_booking_ids: overlappingBookingIds.join(','),
    insufficient_travel_time_booking_ids: insufficientTravelTimeBookingIds.join(',')
  };
}

async function upsertIntoSupabase(data) {
  console.log("Upserting data");
  try {
    const { data: existingLead, error: fetchError } = await supabase
      .from('Leads')
      .select('id')
      .eq('customer_name', data.customer_name)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const leadData = {
      ...data,
      processed_bookings: data.processedBookings,
      overlapping_booking_ids: data.overlapping_booking_ids,
      insufficient_travel_time_booking_ids: data.insufficient_travel_time_booking_ids
    };

    let result;
    if (existingLead) {
      const { data: updatedData, error: updateError } = await supabase
        .from('Leads')
        .update(leadData)
        .eq('id', existingLead.id)
        .select();

      if (updateError) throw updateError;
      result = updatedData;
      console.log("Lead updated successfully:", updatedData);
    } else {
      const { data: insertedData, error: insertError } = await supabase
        .from('Leads')
        .insert([leadData])
        .select();

      if (insertError) throw insertError;
      result = insertedData;
      console.log("New lead inserted successfully:", insertedData);
    }

    return result;
  } catch (error) {
    console.error("Error upserting data into Supabase:", error);
    throw error;
  }
}

async function getChatGPTResponse(prompt) {
  let response = await openai.chat.completions.create({
    messages: [{ role: "system", content: prompt }],
    max_tokens: 180,
    model: "gpt-4o-mini",
  }).catch(function(reason) {
    console.log("error", reason);
  });
  response = response.choices[0];
  response = response.message.content;
  return response;
}

function filterBookingsThatAreCloseInTimeToLead(lead, bookings) {
  const leadStart = new Date(lead.start_time);
  const leadEnd = new Date(lead.end_time);
  
  return bookings.filter(booking => {
    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);
    
    // Calculate time differences in hours
    const leadStartToBokingEnd = (bookingEnd - leadStart) / (1000 * 60 * 60);
    const bookingStartToLeadEnd = (leadEnd - bookingStart) / (1000 * 60 * 60);
    
    // Check if the booking is within 6 hours of the lead
    return Math.abs(leadStartToBokingEnd) <= 6 || Math.abs(bookingStartToLeadEnd) <= 6;
  });
}

(async () => {
  let bookings=[]
  try {
    const { data: bookingsData, error: bookingsError } = await supabase
      .from('Bookings')
      .select('*')
      .order('start_time', { ascending: true });

    if (bookingsError) throw bookingsError;
    bookings=bookingsData
    console.log("Bookings:", bookingsData);
  } catch (error) {
    console.error("Error fetching bookings:", error);
  }

  const input = clipboardy.readSync();
  const prompt = `Here is some information about an event, copied from a website "${input}".
  I would like you to respond with a JSON object containing properties for some crucial information you 
  might find in the event information. If you can find the person's name, give the object a customer_name property
  containing the customer name, if you can find an email address have an email_address property, same for a
  phone_number, price, address, start_time and end_time (in AEST), and also make a short summary stored in the summary property. The response should be a
  full, complete JSON object, starting with { and ending with } and nothing else outside this.
  It should be a JSON object, not a Javascript object. Include no special characters in the response, essentially it is minified.`;

  let chatGPTResponse = await getChatGPTResponse(prompt);
  chatGPTResponse = JSON.parse(chatGPTResponse);
  const id = Date.now().toString();

  // Add the id to the lead data
  chatGPTResponse = {
    id,
    ...chatGPTResponse,
    created_at: new Date().toISOString() // Add a timestamp if needed
  };
  console.log(chatGPTResponse);

  if (typeof chatGPTResponse === 'object' && chatGPTResponse.customer_name) {
    try {
      const processedLead = await processLead(chatGPTResponse, bookings);
      if (processedLead) {
        const result = await upsertIntoSupabase(processedLead);
        console.log("Operation completed successfully:", result);
      } else {
        console.log("Failed to process lead");
      }
    } catch (error) {
      console.error("Error during processing:", error);
    }
  } else {
    console.log("Parsed result is not a valid JavaScript object or missing customer_name.");
  }
})();
