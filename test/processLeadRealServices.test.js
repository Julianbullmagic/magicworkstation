const leadcapture = require('../leadcapture');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const {
  SUPABASEURL,
  SUPABASEKEY,
  MAPBOX_ACCESS_TOKEN
} = process.env;

// Initialize Supabase client
const supabase = createClient(SUPABASEURL, SUPABASEKEY);

async function createTestBooking(bookingData) {
  try {
    const bookingWithId = {
      ...bookingData,
      id: uuidv4(),
      latitude: bookingData.latitude || -33.8688, // Default Sydney latitude
      longitude: bookingData.longitude || 151.2093 // Default Sydney longitude
    };
    console.log('Inserting booking:', bookingWithId);
    const { data, error } = await supabase
      .from('Bookings')
      .insert([bookingWithId])
      .select();

    if (error) {
      console.error('Error inserting booking into Supabase:', error);
      return null;
    }

    console.log('Successfully inserted booking:', data[0]);
    return { supabaseData: data[0] };
  } catch (error) {
    console.error('Error creating test booking:', error);
    return null;
  }
}

async function createTestLead(leadData) {
  try {
    const leadWithId = {
      ...leadData,
      id: uuidv4()
    };
    console.log('Inserting lead:', leadWithId);
    const { data, error } = await supabase
      .from('Leads')
      .insert([leadWithId])
      .select();
    
    if (error) {
      console.error('Error inserting lead into Supabase:', error);
      return null;
    }
    
    console.log('Successfully inserted lead:', data[0]);
    return data[0];
  } catch (error) {
    console.error('Error creating test lead:', error);
    return null;
  }
}

async function deleteTestBooking(id) {
  if (id) {
    const { error } = await supabase.from('Bookings').delete().eq('id', id);
    if (error) {
      console.error('Error deleting test booking:', error);
    }
  }
}

async function deleteTestLead(id) {
  if (id) {
    const { error } = await supabase.from('Leads').delete().eq('id', id);
    if (error) {
      console.error('Error deleting test lead:', error);
    }
  }
}

// Mock data
const mockBooking1 = {
  customer_name: "Test Booking 1",
  start_time: new Date("2023-08-15T10:00:00+10:00").toISOString(),
  end_time: new Date("2023-08-15T12:00:00+10:00").toISOString(),
  address: "123 Pitt St, Sydney NSW 2000",
};

const mockOverlappingBooking = {
  customer_name: "Overlapping Booking",
  start_time: new Date("2023-08-20T14:30:00+10:00").toISOString(),
  end_time: new Date("2023-08-20T16:30:00+10:00").toISOString(),
  address: "456 George St, Sydney NSW 2000",
};

const mockInsufficientTravelTimeBooking = {
  customer_name: "Insufficient Travel Time Booking",
  start_time: new Date("2023-08-20T17:30:00+10:00").toISOString(),
  end_time: new Date("2023-08-20T19:30:00+10:00").toISOString(),
  address: "789 High St, Penrith NSW 2750",
};

const mockLead1 = {
  customer_name: "Test Lead",
  start_time: new Date("2023-08-20T15:00:00+10:00").toISOString(),
  end_time: new Date("2023-08-20T17:00:00+10:00").toISOString(),
  address: "321 Church St, Parramatta NSW 2150",
};

describe('processLead with real services', () => {
  let testBooking1, testBooking2, testBooking3, testLead;
  
  beforeAll(async () => {
    jest.setTimeout(30000); // Increase timeout for API calls
  
    console.log('Setting up test data...');
  
    testBooking1 = await createTestBooking(mockBooking1);
    testBooking2 = await createTestBooking(mockOverlappingBooking);
    testBooking3 = await createTestBooking(mockInsufficientTravelTimeBooking);
    testLead = await createTestLead(mockLead1);

  
    if (!testBooking1 || !testBooking2 || !testBooking3 || !testLead) {
      console.error('Failed to set up test data');
      throw new Error('Test data setup failed');
    }
  });

  afterAll(async () => {
    if (testBooking1) await deleteTestBooking(testBooking1.supabaseData.id);
    if (testBooking2) await deleteTestBooking(testBooking2.supabaseData.id);
    if (testBooking3) await deleteTestBooking(testBooking3.supabaseData.id);
    if (testLead) await deleteTestLead(testLead.id);
  
    // Close all axios connections
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (axios.defaults.httpAgent) axios.defaults.httpAgent.destroy();
    if (axios.defaults.httpsAgent) axios.defaults.httpsAgent.destroy();
  });
  
  // Add this at the end of your test file
  globalThis.afterAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it('should process a lead and identify overlapping and insufficient travel time bookings', async () => {
    const processedLead = await leadcapture.processLead(mockLead1, supabase);
  
  
    expect(processedLead).not.toBeNull();
    expect(processedLead).toHaveProperty('latitude');
    expect(processedLead).toHaveProperty('longitude');
    expect(processedLead).toHaveProperty('overlapping_booking_ids');
    expect(processedLead).toHaveProperty('insufficient_travel_time_booking_ids');
  
    if (processedLead.overlapping_booking_ids) {
      expect(processedLead.overlapping_booking_ids).toContain(testBooking2.supabaseData.id);
    } else {
      console.warn('No overlapping bookings found');
    }
  
    if (processedLead.insufficient_travel_time_booking_ids) {
      expect(processedLead.insufficient_travel_time_booking_ids).toContain(testBooking3.supabaseData.id);
    } else {
      console.warn('No insufficient travel time bookings found');
    }
  
    expect(processedLead.overlapping_booking_ids).not.toContain(testBooking1.supabaseData.id);
    expect(processedLead.insufficient_travel_time_booking_ids).not.toContain(testBooking1.supabaseData.id);
  });

  it('should handle a lead with no overlapping or insufficient travel time bookings', async () => {
    const nonConflictingLead = {
      ...mockLead1,
      start_time: new Date("2023-09-01T15:00:00+10:00").toISOString(),
      end_time: new Date("2023-09-01T17:00:00+10:00").toISOString(),
    };

    const processedLead = await leadcapture.processLead(nonConflictingLead, supabase);

    expect(processedLead).not.toBeNull();
    if (processedLead) {
      expect(processedLead).toHaveProperty('latitude');
      expect(processedLead).toHaveProperty('longitude');
      expect(processedLead.overlapping_booking_ids).toBe('');
      expect(processedLead.insufficient_travel_time_booking_ids).toBe('');
    }
  });

  it('should handle leads with invalid addresses', async () => {
    const invalidAddressLead = {
      ...mockLead1,
      address: 'Invalid Address, Nowhere Land',
    };
  
    const processedLead = await leadcapture.processLead(invalidAddressLead, supabase);
    expect(processedLead).toBeNull();
  });
});