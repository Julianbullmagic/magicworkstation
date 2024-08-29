require('dotenv').config();
const { OpenAI } = require("openai");
const axios = require('axios');
const clipboardy = require('node-clipboardy');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

let openai = new OpenAI({
  apiKey: process.env.OPENAIKEYTWO,
});

const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

// Log the token (first few characters) to verify it's being read
console.log('MAPBOX_ACCESS_TOKEN:', MAPBOX_ACCESS_TOKEN ? MAPBOX_ACCESS_TOKEN.substring(0, 5) + '...' : 'Not set');

// NSW coordinates (approximate center)
const NSW_LAT = -32.163333;
const NSW_LON = 147.016667;

// NSW bounding box (approximate)
const NSW_BBOX = '141.0,-37.5,153.6,-28.5';

async function geocodeAddress(address) {
  console.log('Geocoding address:', address);
  try {
    if (!MAPBOX_ACCESS_TOKEN) {
      throw new Error('Mapbox access token is not set');
    }

    const response = await axios.get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`, {
      params: {
        access_token: MAPBOX_ACCESS_TOKEN,
        country: 'AU',
        proximity: `${NSW_LON},${NSW_LAT}`,
        bbox: NSW_BBOX,
        types: 'address'
      }
    });

    if (response.data.features && response.data.features.length > 0) {
      const feature = response.data.features[0];
      const [longitude, latitude] = feature.center;
      
      // Check if the result is in Australia and has a high relevance score
      if (feature.context.some(ctx => ctx.id.startsWith('country.')) &&
          feature.relevance > 0.8 &&
          latitude >= -37.5 && latitude <= -28.5 && 
          longitude >= 141.0 && longitude <= 153.6) {
        return { latitude, longitude };
      } else {
        console.log('Address found, but not considered valid for this application');
        return null;
      }
    } else {
      console.log('No results found for the given address');
      return null;
    }
  } catch (error) {
    console.error('Error geocoding address:', error.response ? error.response.data : error.message);
    return null;
  }
}

async function processLead(lead, supabase) {
  console.log('Processing lead:', lead);
  const leadCoords = await geocodeAddress(lead.address);
  if (!leadCoords) {
    console.error("Failed to geocode lead address");
    return null;
  }
  console.log('Geocoded lead coordinates:', leadCoords);

  // Fetch existing bookings
  const { data: bookings, error } = await supabase
    .from('Bookings')
    .select('*')
    .order('start_time', { ascending: true });

  if (error) {
    console.error("Error fetching bookings:", error);
    return null;
  }

  const nearbyBookings = filterBookingsThatAreCloseInTimeToLead(lead, bookings);

  const overlappingBookingIds = [];
  const insufficientTravelTimeBookings = [];

  for (const booking of nearbyBookings) {
    if (!booking.latitude || !booking.longitude) {
      console.warn(`Missing coordinates for booking ${booking.id}`);
      continue;
    }

    const bookingCoords = {
      latitude: booking.latitude,
      longitude: booking.longitude
    };

    const isOverlapping = checkTimeOverlap(lead, booking);
    if (isOverlapping) {
      overlappingBookingIds.push(booking.id);
    }

    let travelTime = await calculateTravelTime(leadCoords, bookingCoords);
    if (travelTime !== null) {
      if (isPeakTrafficTime(new Date(lead.start_time)) || isPeakTrafficTime(new Date(booking.start_time))) {
        travelTime *= 1.3; // Increase travel time by 30% during peak hours
      }

      const timeBetweenEvents = Math.abs(new Date(lead.start_time) - new Date(booking.start_time)) / (1000 * 60 * 60);
      if (timeBetweenEvents < travelTime) {
        insufficientTravelTimeBookings.push(`${booking.id},${Math.round(travelTime * 60)}`);
      }
    }
  }

  console.log('Overlapping booking IDs:', overlappingBookingIds);
  console.log('Insufficient travel time bookings:', insufficientTravelTimeBookings);

  return {
    ...lead,
    latitude: leadCoords.latitude,
    longitude: leadCoords.longitude,
    overlapping_booking_ids: overlappingBookingIds.join(','),
    insufficient_travel_time_booking_ids: insufficientTravelTimeBookings.join(',')
  };
}

async function calculateTravelTime(origin, destination) {
  try {
    const response = await axios.get(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?access_token=${MAPBOX_ACCESS_TOKEN}`, {
      timeout: 5000 // 5 seconds timeout
    });
    const travelTimeHours = response.data.durations[0][1] / 3600;
    return travelTimeHours;
  } catch (error) {
    console.error('Error calculating travel time:', error.response ? error.response.data : error.message);
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

function checkTimeOverlap(event1, event2) {
  const start1 = new Date(event1.start_time);
  const end1 = new Date(event1.end_time);
  const start2 = new Date(event2.start_time);
  const end2 = new Date(event2.end_time);

  // Check if one event starts exactly when the other ends
  if (start1.getTime() === end2.getTime() || start2.getTime() === end1.getTime()) {
    return true;
  }

  // Check for any overlap
  return (start1 < end2 && end1 > start2);
}

async function upsertIntoSupabase(data) {
  console.log("Upserting data");
  try {
    // Basic validation
    if (!data.customer_name || !data.start_time || !data.end_time) {
      throw new Error("Invalid lead data: missing required fields");
    }

    const { data: existingLead, error: fetchError } = await supabase
      .from('Leads')
      .select('id')
      .eq('customer_name', data.customer_name)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const leadData = {
      id: data.id || uuidv4(),
      ...data,
      overlapping_booking_ids: data.overlapping_booking_ids || '',
      insufficient_travel_time_booking_ids: data.insufficient_travel_time_booking_ids || ''
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
async function processLeadCapture() {
  try {
    const input = clipboardy.readSync();
    console.log("Clipboard content:", input);

    const year = new Date().getFullYear();
    console.log(year, "YEAR");

    const prompt = `Here is some information about an event, copied from a conversation or website "${input}"...`; // Rest of the prompt

    let chatGPTResponse = await getChatGPTResponse(prompt);
    chatGPTResponse = JSON.parse(chatGPTResponse);
    console.log(chatGPTResponse);

    if (typeof chatGPTResponse === 'object' && chatGPTResponse.customer_name) {
      const processedLead = await processLead(chatGPTResponse, supabase);
      console.log(processedLead);
      if (processedLead) {
        const result = await upsertIntoSupabase(processedLead);
        console.log("Operation completed successfully:", result);
      } else {
        console.error("Failed to process lead");
      }
    } else {
      throw new Error("Invalid ChatGPT response: not a valid JavaScript object or missing customer_name");
    }
  } catch (error) {
    console.error("Error during processing:", error);
  }
}

if (require.main === module) {
  // This block will only run if the script is executed directly
  (async () => {
    await processLeadCapture();
  })();
}

module.exports = {
  processLeadCapture,
  geocodeAddress,
  calculateTravelTime,
  isPeakTrafficTime,
  checkTimeOverlap,
  processLead,
  filterBookingsThatAreCloseInTimeToLead,
  upsertIntoSupabase,
  supabase
};

