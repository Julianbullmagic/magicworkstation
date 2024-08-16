const { google } = require('googleapis');
require('dotenv').config();
const CLIENT_ID = process.env.GOOGLECLIENTID;
const CLIENT_SECRET = process.env.GOOGLECLIENTSECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Function to add a booking to Google Calendar and return the event ID
async function addBookingToGoogleCalendar(booking) {
  const event = {
    summary: booking.summary,
    description: booking.event_name,
    start: {
      dateTime: booking.start_time,
      timeZone: 'YOUR_TIMEZONE',
    },
    end: {
      dateTime: booking.end_time,
      timeZone: 'YOUR_TIMEZONE',
    },
    extendedProperties: {
      private: {
        customerName: booking.customer_name,
        phoneNumber: booking.phone_number,
        address: booking.address,
        emailAddress: booking.email_address,
        price: booking.price.toString(),
        // Add any other properties you want to store
      }
    }
  };

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log('Event created: %s', res.data.htmlLink);
    return res.data.id;
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    throw error;
  }
}

// Function to update a booking in Google Calendar
async function updateBookingInGoogleCalendar(booking) {
  const event = {
    summary: booking.summary,
    description: booking.event_name,
    start: {
      dateTime: booking.start_time,
      timeZone: 'YOUR_TIMEZONE',
    },
    end: {
      dateTime: booking.end_time,
      timeZone: 'YOUR_TIMEZONE',
    },
    extendedProperties: {
      private: {
        customerName: booking.customer_name,
        phoneNumber: booking.phone_number,
        address: booking.address,
        emailAddress: booking.email_address,
        price: booking.price.toString(),
        // Add any other properties you want to update
      }
    }
  };

  try {
    const res = await calendar.events.update({
      calendarId: 'primary',
      eventId: booking.id,
      resource: event,
    });
    console.log('Event updated: %s', res.data.htmlLink);
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    throw error;
  }
}

// Function to delete a booking from Google Calendar
async function deleteBookingFromGoogleCalendar(eventId) {
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
    console.log('Event deleted');
  } catch (error) {
    console.error('Error deleting Google Calendar event:', error);
    throw error;
  }
}

module.exports = {
  addBookingToGoogleCalendar,
  updateBookingInGoogleCalendar,
  deleteBookingFromGoogleCalendar,
};