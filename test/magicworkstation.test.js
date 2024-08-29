// test/magicworkstation.test.js

const {
    getValidAccessToken,
    updateTokensInDatabase,
    initializeGoogleCalendar,
    generateInvoice,
    sendEmail,
    sendEmailWithInvoice,
    uploadToDrive,
    updateBookingInGoogleCalendar,
    removeOldPaidBookings,
    fetchAndStoreCalendarEvents,
    makeCalendarApiCall,
    syncCalendarWithSupabase,
    fetchEvents,
    toUTC,
    fromUTC,
    addBookingToGoogleCalendar,
    deleteBookingFromGoogleCalendar,
    parseDateTime,
    validateBooking,
    toAustralianTime,
    displayBookingTimes,
    geocodeAddress,
    getChatGPTResponse
  } = require('../magicworkstation');
  
  const { createClient } = require('@supabase/supabase-js');
  const { google } = require('googleapis');
  const nodemailer = require('nodemailer');
  const { v4: uuidv4 } = require('uuid');
  const MockAdapter = require("axios-mock-adapter");

  // Initialize Supabase client
  const supabase = createClient(process.env.SUPABASEURL, process.env.SUPABASEKEY);
  
  // Initialize Google OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLECLIENTID,
    process.env.GOOGLECLIENTSECRET,
    'http://localhost:3000/callback'
  );
  
  jest.setTimeout(30000); // Increase timeout for API calls
  
  describe('Magic Workstation Functions', () => {
    let testBooking;
    let testEvent;
  
    beforeAll(async () => {
      // Set up test data
      testBooking = {
        id: uuidv4(),
        customer_name: 'Test Customer',
        email_address: 'test@example.com',
        phone_number: '0400000000',
        address: '123 Test St, Sydney NSW 2000',
        start_time: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        end_time: new Date(Date.now() + 90000000).toISOString(), // Tomorrow + 1 hour
        price: 500
      };
  
      // Insert test booking into Supabase
      await supabase.from('Bookings').insert([testBooking]);
  
      // Set up Google Calendar auth
      const accessToken = await getValidAccessToken();
      oauth2Client.setCredentials({ access_token: accessToken });
      await initializeGoogleCalendar();
    });
  
    afterAll(async () => {
      // Clean up test data
      await supabase.from('Bookings').delete().eq('id', testBooking.id);
      await new Promise(resolve => setTimeout(resolve, 500));
      if (global.gc) {
        global.gc();
      }
    });
  
    test('sendEmail should send an email', async () => {
        const result = await sendEmail('test@example.com', 'Test Subject', 'Test Message');
        expect(result).toBeDefined();
        expect(result.response).toContain('250'); // SMTP OK response
      }, 10000); 

    test('sendEmailWithInvoice should send an email with attachment', async () => {
      const fileId = await sendEmailWithInvoice('test@example.com', 'Invoice', testBooking, oauth2Client);
      expect(fileId).toBeTruthy();
      
      // Verify the booking was updated in Supabase
      const { data, error } = await supabase
        .from('Bookings')
        .select('sent_invoice, invoice_file_id')
        .eq('id', testBooking.id)
        .single();
      
      expect(error).toBeNull();
      expect(data.sent_invoice).toBe(true);
      expect(data.invoice_file_id).toBe(fileId);
    });
  
    test('uploadToDrive should upload a file to Google Drive', async () => {
      const fileBuffer = Buffer.from('Test file content');
      const fileName = 'test-file.txt';
      const mimeType = 'text/plain';
      
      const fileId = await uploadToDrive(oauth2Client, fileBuffer, fileName, mimeType);
      expect(fileId).toBeTruthy();
      
      // Clean up: delete the file from Google Drive
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      await drive.files.delete({ fileId: fileId });
    });
  
    test('updateBookingInGoogleCalendar should update an event', async () => {
        // First, create an event
        const newEvent = await addBookingToGoogleCalendar(testBooking);
        console.log(newEvent,"NEW EVENT")
        // Now update the event
        const updatedBooking = {
          ...testBooking,
          id: newEvent,  // Use the ID returned from Google Calendar
          customer_name: 'Updated Customer'
        };
        const updatedEvent = await updateBookingInGoogleCalendar(updatedBooking);
        console.log(newEvent,"Updated EVENT")

        expect(updatedEvent).toBeDefined();
        expect(updatedEvent.summary).toBe('Updated Customer');
        
        // Clean up: delete the event
        await deleteBookingFromGoogleCalendar(newEvent);
      });
  
      test('removeOldPaidBookings should remove old paid bookings', async () => {
        let oldBooking = {
          ...testBooking,
          start_time: new Date(Date.now() - 6184000000).toISOString(), // 60 days ago
          end_time: new Date(Date.now() - 6180400000).toISOString(), // 60 days ago + 1 hour
          full_payment_made: true
        };
        oldBooking.id = uuidv4();
      
        // Insert the old booking
        const { error: insertError } = await supabase
          .from('Bookings')
          .insert([oldBooking]);
        
        expect(insertError).toBeNull();
      
        // Verify the booking was inserted
        const { data: beforeData, error: beforeError } = await supabase
          .from('Bookings')
          .select('*')
          .eq('id', oldBooking.id);
      
        expect(beforeError).toBeNull();
        expect(beforeData.length).toBe(1);
      
        // Call the function to remove old paid bookings
        await removeOldPaidBookings();
        
        // Check that the booking was removed
        const { data: afterData, error: afterError } = await supabase
          .from('Bookings')
          .select('*')
          .eq('id', oldBooking.id);
      
        expect(afterError).toBeNull();
        expect(afterData.length).toBe(0);
      });
      
      test('fetchAndStoreCalendarEvents should sync events with Supabase', async () => {
        await fetchAndStoreCalendarEvents();
      
        const { data, error } = await supabase
          .from('Bookings')
          .select('*')
          .gte('start_time', new Date(Date.now() - 5184000000).toISOString()); // Bookings from the last 60 days
      
        expect(error).toBeNull();
        expect(data.length).toBeGreaterThan(0);
      });

  
    test('toUTC and fromUTC should convert times correctly', () => {
      const sydneyTime = '2023-08-26T10:00:00+10:00';
      const utcTime = toUTC(sydneyTime);
      expect(utcTime).toBe('2023-08-26T00:00:00.000Z');
      
      const backToSydney = fromUTC(utcTime);
      expect(backToSydney).toContain('10:00:00');
    });
  
    test('parseDateTime should parse date strings correctly', () => {
      const dateString = '2023-08-26T10:00:00+10:00';
      const parsed = parseDateTime(dateString);
      expect(parsed).toBe('2023-08-26T00:00:00.000Z');
    });
  
    test('validateBooking should validate booking objects', () => {
      const validBooking = {
        summary: 'Test Booking',
        start_time: '2023-08-26T10:00:00+10:00',
        end_time: '2023-08-26T11:00:00+10:00'
      };
      expect(() => validateBooking(validBooking)).not.toThrow();
      
      const invalidBooking = { ...validBooking, start_time: undefined };
      expect(() => validateBooking(invalidBooking)).toThrow();
    });
  
    test('toAustralianTime should convert to Australian time', () => {
      const utcTime = '2023-08-26T00:00:00.000Z';
      const ausTime = toAustralianTime(utcTime);
      expect(ausTime).toContain('10:00:00');
    });
  
    test('geocodeAddress should return coordinates for a valid address', async () => {
      const address = '123 Pitt Street, Sydney NSW 2000, Australia';
      const result = await geocodeAddress(address);
      expect(result).toHaveProperty('latitude');
      expect(result).toHaveProperty('longitude');
      expect(result.latitude).toBeCloseTo(-33.8675, 1);
      expect(result.longitude).toBeCloseTo(151.2077, 1);
    });
  
    test('getChatGPTResponse should return a response from ChatGPT', async () => {
      const prompt = 'What is the capital of Australia?';
      const response = await getChatGPTResponse(prompt);
      expect(response).toContain('Canberra');
    });
  });