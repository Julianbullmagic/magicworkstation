require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Initialize Google OAuth2 client
const oauth2Client = new google.auth.OAuth2();
oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function geocodeAddress(address) {
  const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
  
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
      const placeName = response.data.features[0].place_name;
      return { latitude, longitude, placeName };
    } else {
      console.log('No results found for the given address');
      return null;
    }
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
}

async function syncCalendarWithSupabase(calendarEvents) {
  // Fetch all existing bookings from Supabase
  const { data: existingBookings, error } = await supabase
    .from('Bookings')
    .select('*');

  if (error) {
    console.error('Error fetching existing bookings:', error);
    return;
  }

  // Create a map of existing bookings for easy lookup
  const bookingsMap = new Map(existingBookings.map(booking => [booking.id, booking]));

  // Process each calendar event
  for (const event of calendarEvents) {
    const bookingData = {
      id: event.id,
      summary: event.summary || null,
      event_name: event.summary || null,
      customer_name: event.extendedProperties?.private?.customerName || event.summary || null,
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      phone_number: event.extendedProperties?.private?.phoneNumber || null,
      address: event.location || null,
      email_address: event.extendedProperties?.private?.emailAddress || null,
      price: event.extendedProperties?.private?.price || 0,
    };

    if (bookingData.address) {
      let coords = await geocodeAddress(bookingData.address);
      if (coords) {
        bookingData.latitude = coords.latitude;
        bookingData.longitude = coords.longitude;
        bookingData.address = coords.placeName;
      }
    }

    if (bookingsMap.has(event.id)) {
      // Update existing booking
      const { error } = await supabase
        .from('Bookings')
        .update(bookingData)
        .eq('id', event.id);

      if (error) console.error('Error updating booking:', error);
      bookingsMap.delete(event.id);
    } else {
      // Add new booking
      const { error } = await supabase
        .from('Bookings')
        .insert([bookingData]);

      if (error) console.error('Error inserting new booking:', error);
    }
  }

  // Remove bookings that are no longer in the calendar or outside the time range
  const now = new Date();
  const twoMonthsAgo = new Date(now.setMonth(now.getMonth() - 2));
  const twoMonthsLater = new Date(now.setMonth(now.getMonth() + 4));

  for (const [id, booking] of bookingsMap) {
    const bookingDate = new Date(booking.start_time);
    if (bookingDate < twoMonthsAgo || bookingDate > twoMonthsLater) {
      const { error } = await supabase
        .from('Bookings')
        .delete()
        .eq('id', id);

      if (error) console.error('Error deleting outdated booking:', error);
    }
  }
}

async function fetchAndSyncEvents() {
  console.log('Fetching events...');

  const now = new Date();
  const timeMin = new Date(now.setMonth(now.getMonth() - 2)).toISOString();
  const timeMax = new Date(now.setMonth(now.getMonth() + 4)).toISOString();

  console.log('Fetching events between:', timeMin, 'and', timeMax);
  
  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    console.log('API Response:', res.data);

    const events = res.data.items;
    if (events.length) {
      await syncCalendarWithSupabase(events);
      console.log(`Synced ${events.length} events with Supabase.`);
    } else {
      console.log('No upcoming events found.');
    }
  } catch (error) {
    console.error('Error fetching calendar events:', error);
  }
}

async function main() {
  try {
    await fetchAndSyncEvents();
    console.log('Daily sync completed successfully.');
  } catch (error) {
    console.error('Error in daily sync:', error);
  }
}

// Run the script
main().catch(console.error);