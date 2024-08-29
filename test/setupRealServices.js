// test/setupRealServices.js

require('dotenv').config({ path: '.env.test' });
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const { OpenAI } = require("openai");

// Initialize Supabase client for testing
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Initialize Google Calendar client for testing
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth });

// Initialize OpenAI client for testing
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper function to create a test booking in both Supabase and Google Calendar
async function createTestBooking(bookingData) {
  // Create in Supabase
  const { data: supabaseData, error: supabaseError } = await supabase
    .from('Bookings')
    .insert([bookingData])
    .select();
  
  if (supabaseError) throw supabaseError;

  // Create in Google Calendar
  const event = {
    summary: bookingData.customer_name,
    description: bookingData.summary,
    start: {
      dateTime: bookingData.start_time,
      timeZone: 'Australia/Sydney',
    },
    end: {
      dateTime: bookingData.end_time,
      timeZone: 'Australia/Sydney',
    },
    location: bookingData.address,
  };

  const googleEvent = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });

  return { supabaseData: supabaseData[0], googleEventId: googleEvent.data.id };
}

// Helper function to delete a test booking from both Supabase and Google Calendar
async function deleteTestBooking(bookingId, googleEventId) {
  // Delete from Supabase
  const { error: supabaseError } = await supabase
    .from('Bookings')
    .delete()
    .eq('id', bookingId);
  
  if (supabaseError) throw supabaseError;

  // Delete from Google Calendar
  await calendar.events.delete({
    calendarId: 'primary',
    eventId: googleEventId,
  });
}

// Helper function to create a test lead
async function createTestLead(leadData) {
  const { data, error } = await supabase
    .from('Leads')
    .insert([leadData])
    .select();
  
  if (error) throw error;
  return data[0];
}

// Helper function to delete a test lead
async function deleteTestLead(leadId) {
  const { error } = await supabase
    .from('Leads')
    .delete()
    .eq('id', leadId);
  
  if (error) throw error;
}

module.exports = {
  supabase,
  calendar,
  openai,
  createTestBooking,
  deleteTestBooking,
  createTestLead,
  deleteTestLead,
};