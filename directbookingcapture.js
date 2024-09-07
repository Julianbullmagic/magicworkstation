require('dotenv').config();
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const axios = require("axios");
const { OpenAI } = require("openai");
const clipboardy = require('node-clipboardy');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

let openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function insertLead(leadData) {
  console.log("Checking for existing lead...",leadData);
  await sleep(4000)
  try {
    const { data: existingLeads, error: fetchError } = await supabase
      .from('Bookings')
      .select('*')
      .eq('customer_name', leadData.customer_name)
      .eq('num', leadData.num);

    if (fetchError) throw fetchError;

    if (existingLeads && existingLeads.length > 0) {
      console.log("A lead for this customer with the same num already exists:", existingLeads[0]);
      await sleep(20000);
      return null; // Return null to indicate no insertion was made
    }

    // If no existing booking, proceed with insertion
    console.log("No existing booking found. Inserting new lead...");
    const { data, error } = await supabase
      .from('Bookings')
      .insert([leadData])
      .select();

    if (error) throw error;
    console.log("New lead inserted successfully:", data);
    await sleep(20000)
    return data;
  } catch (error) {
    console.error("Error in lead process:", error);
    await sleep(20000)
    throw error;
  }
}

(async () => {
  try {
    const input = clipboardy.readSync();
    console.log("Clipboard content:", input);
    const prompt = `Here is some information about an event copied from a conversation or website "${input}".
    I would like you to respond with a JSON array containing an object or objects that each contain properties for crucial booking information.
    Each object in the array should include properties for customer_name, email_address, phone_number, website, price, address, start_time, and end_time (in AEST).
    Also include a short summary in the summary property. If no price is mentioned, the default should be 0. The price should only be a number, without any
    dollar sign. The start_time and end_time should be converted to timestamptz format. There may be a url appended at the end of the information I give you,
    I would like this to be the website property of the object you return. The information I give you may request several bookings.
      There might be a conversation included in which the customer gives updated or more specific details about the event or events, in that
  case you should use this more recent or specific information in your response. In other words, we need the most recent and specific details about
  the booking or bookings. The response should be an array of javascript objects, 
   nothing else outside this, no apostrophes, quotation marks or other characters. Include no special characters in the response, essentially it is minified.`;


    let leadData;
    try {
      const maxRetries = 5; // Maximum number of retries
      let retries = 0;
  
      while (retries < maxRetries) {
        sleep(5000)
        try {
          let chatGPTResponse = await getChatGPTResponse(prompt);
          console.log("ChatGPT response:", chatGPTResponse);
          sleep(5000)
          try{
            leadData = JSON.parse(chatGPTResponse);
            console.log("Parsed lead data:", leadData);
            sleep(5000)
          }catch(err){console.log(err)}

          if (Array.isArray(leadData)) {
            break; // Exit the loop if leadData is a valid array of objects
          } else {
            console.error("Parsed result is not a valid array of objects or contains invalid data.");
          }
        } catch (parseError) {
          console.error("Error parsing ChatGPT response:", parseError);
          console.log("Raw response:", chatGPTResponse);
        }
  
        retries++;
        console.log(`Retrying (${retries}/${maxRetries})...`);
        await sleep(5000); // Wait before retrying
      }
  
      if (!Array.isArray(leadData) || !leadData.every(item => typeof item === 'object')) {
        console.error("Failed to obtain valid lead data after maximum retries.");
        return;
      }
  
      // clipboardy.writeSync(chatGPTResponse);
      await sleep(5000)
      console.log(leadData,Array.isArray(leadData))
      await sleep(5000)
    } catch (parseError) {
      console.error("Error parsing ChatGPT response:", parseError);
      console.log("Raw response:", chatGPTResponse);
      return;
    }

    if (Array.isArray(leadData)) {
      let x=1
      for (let lead of leadData){
        console.log(lead,"Looping through leads")
        await sleep(5000)
        if(lead.customer_name){
          lead.id = uuidv4();
          lead.created_at = new Date().toISOString();
          lead.num=x
          console.log("Parsed lead data:", lead);
          await sleep(5000)
          try{
          let processedLead = await processLead(lead,supabase);
          let result = await insertLead(processedLead);
        }catch(err){console.log(err)}
          await sleep(5000)
          x=x+1
          if (result) {
            console.log("lead inserted successfully:", result);
            sleep(10000)
          } else {
            console.log("lead was not inserted due to existing lead for this customer.");
          }
        }
      }
    } else {
      console.log("Parsed result is not a valid JavaScript object or missing customer_name.");
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();

async function processLead(lead, supabase) {
  console.log('Starting to process lead:', JSON.stringify(lead, null, 2));

  try {
    // Geocode the lead address
    const leadCoords = await geocodeAddress(lead.address);
    if (!leadCoords) {
      console.error("Failed to geocode lead address:", lead.address);
      return null;
    }
    console.log('Geocoded lead coordinates:', leadCoords);

    // Fetch existing bookings
    console.log('Fetching existing bookings from Supabase');
    const { data: bookings, error } = await supabase
      .from('Bookings')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) {
      console.error("Error fetching bookings:", error);
      return null;
    }
    console.log(`Fetched ${bookings.length} bookings`);

    // Filter bookings that are close in time to the lead
    const nearbyBookings = filterBookingsThatAreCloseInTimeToLead(lead, bookings);
    console.log(`Found ${nearbyBookings.length} nearby bookings`);

    const overlappingBookingIds = [];
    const insufficientTravelTimeBookings = [];

    for (const booking of nearbyBookings) {
      console.log(`Processing nearby booking: ${JSON.stringify(booking, null, 2)}`);

      if (!booking.latitude || !booking.longitude) {
        console.warn(`Missing coordinates for booking ${booking.id}. Skipping travel time check.`);
        // Still check for time overlap even if coordinates are missing
        if (checkTimeOverlap(lead, booking)) {
          console.log(`Time overlap detected with booking ${booking.id}`);
          overlappingBookingIds.push(booking.id);
        }
        continue;
      }

      const bookingCoords = {
        latitude: booking.latitude,
        longitude: booking.longitude
      };

      // Check for time overlap
      const isOverlapping = checkTimeOverlap(lead, booking);
      console.log(`Time overlap check result for booking ${booking.id}: ${isOverlapping}`);
      if (isOverlapping) {
        console.log(`Time overlap detected with booking ${booking.id}`);
        overlappingBookingIds.push(booking.id);
      }

      // Calculate travel time
      console.log(`Calculating travel time between lead and booking ${booking.id}`);
      let travelTime = await calculateTravelTime(leadCoords, bookingCoords);
      console.log(`Initial travel time calculation for booking ${booking.id}: ${travelTime} hours`);

      if (travelTime !== null) {
        // Check for peak traffic times
        const isLeadPeakTime = isPeakTrafficTime(new Date(lead.start_time));
        const isBookingPeakTime = isPeakTrafficTime(new Date(booking.start_time));
        console.log(`Lead start time is peak traffic time: ${isLeadPeakTime}`);
        console.log(`Booking ${booking.id} start time is peak traffic time: ${isBookingPeakTime}`);

        if (isLeadPeakTime || isBookingPeakTime) {
          travelTime *= 1.3; // Increase travel time by 30% during peak hours
          console.log(`Adjusted travel time for peak hours: ${travelTime} hours`);
        }

        // Calculate time between events
        const timeBetweenEvents = Math.abs(new Date(lead.start_time) - new Date(booking.start_time)) / (1000 * 60 * 60);
        console.log(`Time between lead and booking ${booking.id}: ${timeBetweenEvents} hours`);

        // Check if travel time is insufficient
        if (timeBetweenEvents < travelTime) {
          console.log(`Insufficient travel time detected for booking ${booking.id}`);
          insufficientTravelTimeBookings.push(`${booking.id},${Math.round(travelTime * 60)}`);
        } else {
          console.log(`Sufficient travel time for booking ${booking.id}`);
        }
      } else {
        console.log(`Failed to calculate travel time for booking ${booking.id}`);
      }
    }

    console.log('Overlapping booking IDs:', overlappingBookingIds);
    console.log('Insufficient travel time bookings:', insufficientTravelTimeBookings);

    // Prepare the processed lead data
    const processedLead = {
      ...lead,
      latitude: leadCoords.latitude,
      longitude: leadCoords.longitude,
      overlapping_booking_ids: overlappingBookingIds.join(','),
      insufficient_travel_time_booking_ids: insufficientTravelTimeBookings.join(',')
    };

    console.log('Processed lead data:', JSON.stringify(processedLead, null, 2));

    return processedLead;
  } catch (error) {
    console.error('Error in processLead function:', error);
    return null;
  }
}

async function geocodeAddress(address) {
  console.log('Geocoding address:', address);
  try {
    const response = await axios.get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`, {
      params: {
        access_token: MAPBOX_ACCESS_TOKEN,
        country: 'AU',
        types: 'address'
      }
    });

    if (response.data.features && response.data.features.length > 0) {
      const [longitude, latitude] = response.data.features[0].center;
      console.log(`Geocoded coordinates: ${latitude}, ${longitude}`);
      return { latitude, longitude };
    } else {
      console.log('No results found for the given address');
      return null;
    }
  } catch (error) {
    console.error('Error geocoding address:', error.response ? error.response.data : error.message);
    return null;
  }
}

function filterBookingsThatAreCloseInTimeToLead(lead, bookings) {
  const leadStart = new Date(lead.start_time);
  const leadEnd = new Date(lead.end_time);
  
  return bookings.filter(booking => {
    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);
    
    // Calculate time differences in hours
    const leadStartToBookingEnd = (bookingEnd - leadStart) / (1000 * 60 * 60);
    const bookingStartToLeadEnd = (leadEnd - bookingStart) / (1000 * 60 * 60);
    
    // Check if the booking is within 6 hours of the lead
    return Math.abs(leadStartToBookingEnd) <= 6 || Math.abs(bookingStartToLeadEnd) <= 6;
  });
}

async function calculateTravelTime(origin, destination) {
  try {
    const response = await axios.get(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`, {
      params: {
        access_token: MAPBOX_ACCESS_TOKEN
      },
      timeout: 5000 // 5 seconds timeout
    });
    const travelTimeHours = response.data.durations[0][1] / 3600;
    return travelTimeHours;
  } catch (error) {
    console.error('Error calculating travel time:', error.response ? error.response.data : error.message);
    return null;
  }
}

function checkTimeOverlap(event1, event2) {
  const start1 = new Date(event1.start_time);
  const end1 = new Date(event1.end_time);
  const start2 = new Date(event2.start_time);
  const end2 = new Date(event2.end_time);

  console.log('Checking time overlap between:');
  console.log(`Event 1: ${event1.event_name}, Start: ${start1.toISOString()}, End: ${end1.toISOString()}`);
  console.log(`Event 2: ${event2.event_name}, Start: ${start2.toISOString()}, End: ${end2.toISOString()}`);

  // Check if one event starts exactly when the other ends
  if (start1.getTime() === end2.getTime() || start2.getTime() === end1.getTime()) {
    console.log('Overlap detected: One event starts exactly when the other ends');
    return true;
  }

  // Check for any overlap
  const hasOverlap = (start1 < end2 && end1 > start2);
  console.log(`Overlap result: ${hasOverlap}`);
  return hasOverlap;
}

function isPeakTrafficTime(dateTime) {
  const hour = dateTime.getHours();
  const minute = dateTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  const morningPeakStart = 7 * 60;
  const morningPeakEnd = 9 * 60;
  const eveningPeakStart = 16 * 60;
  const eveningPeakEnd = 18 * 60 + 30;

  const isPeak = (timeInMinutes >= morningPeakStart && timeInMinutes <= morningPeakEnd) ||
                 (timeInMinutes >= eveningPeakStart && timeInMinutes <= eveningPeakEnd);
  
  console.log(`Checking peak traffic time for ${dateTime.toISOString()}: ${isPeak}`);
  return isPeak;
}

module.exports = {
  processLead,
  geocodeAddress,
  filterBookingsThatAreCloseInTimeToLead,
  calculateTravelTime,
  checkTimeOverlap,
  isPeakTrafficTime
};