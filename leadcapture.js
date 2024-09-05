const axios = require('axios');
require('dotenv').config();

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

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