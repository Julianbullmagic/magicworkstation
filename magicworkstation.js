require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const http = require('http');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const clipboardy = require('node-clipboardy');
const fs = require('fs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path');
const { processLead } = require('./leadcapture');
const stream = require('stream');
const { auth } = require('googleapis/build/src/apis/abusiveexperiencereport');
const { OpenAI } = require("openai");
const bodyParser = require('body-parser');
const { handleEventChange, handleEventDeletion } = require('./syncOverlaps');
const Queue = require('better-queue');
const cookieParser = require('cookie-parser');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

let syncInProgress = false;
let shouldPauseSyncForOtherOperations = false;

// Global variables
let openai;
let supabase;
let app;
let server;
let oauth2Client;
let calendar;
let transporter;


async function main(startServer = true) {
  try {
    // Initialize OpenAI
    openai = new OpenAI({
      apiKey: process.env.OPENAIKEYTWO,
    });

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASEURL;
    const supabaseAnonKey = process.env.SUPABASEKEY;
    supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Initialize Express app
    app = express();
    app.use(cookieParser());
    console.log("Express app created");
    server = http.createServer(app);
    app.use(express.json());
    const corsOptions = {
      origin: 'https://magicworkstation.onrender.com',
      optionsSuccessStatus: 200,
      credentials: true
    };
    app.use(cors(corsOptions));
    app.use(async (req, res, next) => {
      try {
        const sessionId = req.cookies.sessionId;
    
        if (!sessionId) {
          req.session = null;
        } else {
          const session = await getSession(sessionId);
          req.session = session ? { ...session.session_data } : null;
        }
    
        if (req.path.startsWith('/api/')) {
          if (!req.session || !req.session.isAuthenticated) {
            return res.status(401).json({ error: 'Unauthorized' });
          }
        } else if (req.path !== '/login' && req.path !== '/auth' && req.path !== '/callback') {
          if (!req.session || !req.session.isAuthenticated) {
            return res.redirect('/login');
          }
        }
    
        next();
      } catch (error) {
        console.error('Error in session middleware:', error);
        next(error);
      }
    });
    console.log('Session middleware configured');
    // In your main function or server setup area, add these lines if they're not already present
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
    // Initialize Google OAuth2 client
    const CLIENT_ID = process.env.GOOGLECLIENTID;
    const CLIENT_SECRET = process.env.GOOGLECLIENTSECRET;
    const REDIRECT_URI = 'https://magicworkstation.onrender.com/callback';
    oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    // Initialize nodemailer transporter
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'julianbullmagic@gmail.com',
        pass: process.env.GMAILAPPPASSWORD,
      }
    });

    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        updateTokensInDatabase(tokens).catch(console.error);
        console.log('New tokens stored to database');
      }
    });

    await initializeGoogleCalendar();
    generateRoutes();

    if (startServer) {
      const port = 3000;
      server = await new Promise((resolve) => {
        const s = app.listen(port, '0.0.0.0', () => {
          console.log(`Server listening on port ${port}`);
          resolve(s);
        });
      });
      console.log('Server start completed');
    }

    return { app, server, supabase, oauth2Client, openai, transporter };
  } catch (error) {
    console.error('Error in main function:', error);
    throw error;
  }
}

async function createSession(userId, sessionData) {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { data, error } = await supabase
      .from('Sessions')
      .insert([{ user_id: userId, session_data: sessionData, expires_at: expiresAt }])
      .select();

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No data returned from session creation');
    return data[0];
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

async function getSession(sessionId) {
  try {
    const { data, error } = await supabase
      .from('Sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) throw error;
    if (!data || new Date(data.expires_at) < new Date()) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error getting session:', error);
    throw error;
  }
}

async function updateSession(sessionId, newSessionData) {
  const { data, error } = await supabase
    .from('Sessions')
    .update({ session_data: newSessionData })
    .eq('id', sessionId);

  if (error) throw error;
  return data[0];
}

async function deleteSession(sessionId) {
  const { error } = await supabase
    .from('Sessions')
    .delete()
    .eq('id', sessionId);

  if (error) throw error;
}

async function getValidAccessToken() {
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('*')
      .limit(1)
      .single();

    if (error) throw error;

    if (!data) {
      console.log('No tokens found in the database');
      return null;
    }

    if (new Date() > new Date(data.expiry_date)) {
      // Token is expired, refresh it
      oauth2Client.setCredentials({
        refresh_token: data.refresh_token
      });
      const { credentials } = await oauth2Client.refreshAccessToken();
      await updateTokensInDatabase(credentials);
      return credentials.access_token;
    }

    return data.access_token;
  } catch (error) {
    console.error('Error in getValidAccessToken:', error);
    return null;
  }
}
async function updateTokensInDatabase(tokens) {
  try {
    const { error } = await supabase
      .from('oauth_tokens')
      .upsert({
        id: 1, // Assuming we're always using id 1
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || tokens.refresh_token,
        expiry_date: new Date(tokens.expiry_date).toISOString()
      });

    if (error) throw error;

    console.log('Tokens updated successfully in database');
  } catch (error) {
    console.error('Error updating tokens in database:', error);
    throw error;
  }
}

async function initializeGoogleCalendar() {
  try {
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      oauth2Client.setCredentials({ access_token: accessToken });
      console.log('Loaded saved tokens');
      calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      console.log('Calendar object initialized:', calendar ? 'Success' : 'Failed');
      await makeCalendarApiCall(async () => {
        // await fetchAndStoreCalendarEvents();
      });
    } else {
      throw new Error('No valid access token found');
    }
  } catch (error) {
    console.error('Error initializing Google Calendar:', error);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.file'],
      prompt: 'consent'
    });
    console.log('Authorize this app by visiting this URL:', authUrl);
  }
}

async function generateInvoice(booking) {
  console.log('Starting invoice generation');
  return new Promise((resolve, reject) => {
    console.log('Initializing PDFDocument');
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => {
      chunks.push(chunk);
    });
    
    doc.on('end', () => {
      console.log('PDF generation completed');
      const pdfBuffer = Buffer.concat(chunks);
      resolve(pdfBuffer);
    });

    console.log('Starting to write PDF content');

    // Set up some basic document properties
    doc.font('Helvetica-Bold');
    doc.fontSize(24).text('INVOICE', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).font('Helvetica');

    // Add business details
    doc.text('Julian Bull Magic');
    doc.text('ABN=24515801728');
    doc.text('julianbullmagic@gmail.com');
    doc.moveDown();

    // Add customer details
    doc.text('Bill To:');
    doc.text(booking.customer_name || 'Customer');
    doc.text(booking.address || 'Address not provided');
    doc.text(booking.email_address || 'Email not provided');
    doc.text(booking.phone_number || 'Phone not provided');
    doc.moveDown();

    // Add invoice details
    const invoiceDate = new Date().toLocaleDateString();
    const dueDate = new Date(booking.start_time).toLocaleDateString();
    doc.text(`Invoice Date: ${invoiceDate}`);
    doc.text(`Event Date: ${new Date(booking.start_time).toLocaleDateString()}`);
    doc.moveDown();

    // Add table for services
    doc.font('Helvetica-Bold');
    doc.text('Description', 50, 300);
    doc.text('Amount', 400, 300);
    doc.moveTo(50, 320).lineTo(550, 320).stroke();
    doc.font('Helvetica');

    doc.text('Magic Show Performance', 50, 340);
    doc.text(`$${booking.price || 'Price not set'}`, 400, 340);

    doc.moveTo(50, 380).lineTo(550, 380).stroke();
    doc.font('Helvetica-Bold');
    doc.text('Total Due:', 50, 400);
    doc.text(`$${booking.price || 'Price not set'}`, 400, 400);

    doc.font('Helvetica');
    doc.moveDown(2);
    doc.text(`Payment Method: ${booking.cash ? 'Cash' : 'Bank Transfer'}`);

    if (!booking.cash) {
      doc.moveDown();
      doc.text('Bank Details:');
      doc.text('[Your Bank Details Here]');
    }

    // Add deposit and payment schedule information
    doc.moveDown(2);
    doc.font('Helvetica-Bold');
    doc.text('Deposit and Payment Schedule');
    doc.font('Helvetica');
    doc.moveDown();

    const depositAmount = booking.price * 0.25;
    const remainingAmount = booking.price - depositAmount;

    doc.text(`To secure your booking, we kindly request a deposit of $${depositAmount.toFixed(2)}, which is 25% of the total amount.`);
    doc.text(`The remaining balance of $${remainingAmount.toFixed(2)} can be paid at your convenience, either before the event or within two weeks after.`);
    doc.moveDown();
    doc.text(`Here's a breakdown of the payments:`);
    doc.text(`1. Deposit (due at your earliest convenience): $${depositAmount.toFixed(2)}`);
    doc.text(`2. Remaining Balance: $${remainingAmount.toFixed(2)}`);
    doc.moveDown();
    doc.text('We appreciate your flexibility with the final payment and are happy to accommodate your preferred timing within the mentioned timeframe.');

    doc.moveDown(2);
    doc.text('Notes:');
    doc.text('- For bank transfers, please use your name and event date as the reference.');
    doc.text('- If you have any questions about the payment schedule, please don\'t hesitate to reach out.');
    doc.moveDown();
    doc.text('Thank you for choosing Julian Bull Magic. We look forward to making your event magical!');

    // Finalize the PDF and end the stream
    console.log('Finished writing PDF content');
    doc.end();
    console.log('Document end called');
  });
}


async function sendEmail(recipient,subject,message,attachment){
  let allRecipients = ["zanthorthegreat@gmail.com","julianbullmagician@gmail.com","julianbullmagic@outlook.com","julianbullmagician@outlook.com", recipient];
  let mailOptions = {
    from: 'julianbullmagic@gmail.com',
    to: recipient,
    subject: subject,
    text: message
  };

  if (attachment) {
    mailOptions.to=allRecipients.join(', ')
    mailOptions.attachments = [{
      filename: 'invoice.pdf',
      content: attachment
    }];
  }
  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log('Error:', error);
        reject(error);
      } else {
        console.log('Email sent: ', info.response);
        resolve(info);
      }
    });
  });
}


async function sendEmailWithInvoice(recipient, subject, booking, auth) {
  try {
    // Generate the invoice
    let invoiceBuffer = await generateInvoice(booking);

    // Upload to Google Drive
    const fileName = `Invoice_${booking.customer_name}_${new Date(booking.start_time).toISOString().split('T')[0]}.pdf`;
    let fileId = await uploadToDrive(auth, invoiceBuffer, fileName, 'application/pdf');

    // Send email with invoice
    let message = `Hi ${booking.customer_name},

    I have attached the invoice for my services to this email. I have a 25% deposit to confirm the booking, details for a bank 
    transfer are inside but if you prefer another method, that is also fine, except I'm not set up to take credit or debit cards.`;

    await sendEmail(recipient, subject, message, invoiceBuffer);

    // Update the booking in Supabase
    const { error } = await supabase
      .from('Bookings')
      .update({ 
        sent_invoice: true,
        invoice_file_id: fileId  // Store the Google Drive file ID
      })
      .eq('id', booking.id);

    if (error) throw error;

    console.log('Invoice sent successfully and uploaded to Google Drive');

    // Return the file ID for potential future use
    return fileId;
  } catch (error) {
    console.error('Error generating, sending, or uploading invoice:', error);
    throw error;
  }
}


async function uploadToDrive(auth, fileBuffer, fileName, mimeType) {
  const drive = google.drive({ version: 'v3', auth });
  const fileMetadata = {
    name: fileName,
    parents: ['1Gc4DCCbiU31-miU0oc1ALLw2L4HFPFd8'] // Your Google Drive folder ID
  };

  // Convert buffer to readable stream
  const bufferStream = new stream.PassThrough();
  bufferStream.end(fileBuffer);

  const media = {
    mimeType: mimeType,
    body: bufferStream
  };

  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
    console.log('File Id:', file.data.id);
    return file.data.id;
  } catch (err) {
    console.error('Error uploading file to Drive:', err);
    throw err;
  }
}


async function updateBookingInGoogleCalendar(booking) {
  return await makeCalendarApiCall(async () => {
  let event = {
    summary: booking.customer_name || 'Untitled Event',
    description: booking.summary || '',
    start: {
      dateTime: toUTC(booking.start_time),
      timeZone: 'Australia/Sydney',
    },
    end: {
      dateTime: toUTC(booking.end_time),
      timeZone: 'Australia/Sydney',
    },
    location: booking.address || '',
    extendedProperties: {
      private: {
        customerName: booking.customer_name || '',
        phoneNumber: booking.phone_number || '',
        address: booking.address || '',
        emailAddress: booking.email_address || '',
        price: (booking.price || '0').toString(),
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
    return res.data;
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
})
}


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

async function fetchAndStoreCalendarEventsWithPauses() {
  return await makeCalendarApiCall(async () => {
    const now = new Date();
    const twoMonthsAgo = new Date(now.setMonth(now.getMonth() - 2));
    const fourMonthsLater = new Date(now.setMonth(now.getMonth() + 6)); // 4 months from the original date

    try {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: twoMonthsAgo.toISOString(),
        timeMax: fourMonthsLater.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = res.data.items;
      console.log(`Fetched ${events.length} events from Google Calendar`);

      // Fetch all existing bookings from Supabase
      const { data: existingBookings, error: supabaseError } = await supabase
        .from('Bookings')
        .select('*');

      if (supabaseError) throw supabaseError;

      const bookingsMap = new Map(existingBookings.map(booking => [booking.id, booking]));

      for (const event of events) {
        if (shouldPauseSyncForOtherOperations) {
          await sleep(100); // Small delay to allow other operations
          shouldPauseSyncForOtherOperations = false;
        }

        await processEvent(event, bookingsMap);
        await sleep(0); // Yield to event loop
      }

      // Remove bookings that are no longer in the calendar or outside the time range
      await removeOutdatedBookings(bookingsMap, twoMonthsAgo, fourMonthsLater);

      console.log('Calendar sync completed');
    } catch (error) {
      console.error('Error fetching or storing calendar events:', error);
    }
  });
}

async function processEvent(event, bookingsMap) {
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

    if (error) {
      console.error('Error updating booking:', error);
    } else {
      console.log('Updated booking:', event.id);
    }
    bookingsMap.delete(event.id);
  } else {
    // Add new booking
    const { error } = await supabase
      .from('Bookings')
      .insert([bookingData]);

    if (error) {
      console.error('Error inserting new booking:', error);
    } else {
      console.log('New booking added:', event.id);
    }
  }
}

async function removeOutdatedBookings(bookingsMap, twoMonthsAgo, fourMonthsLater) {
  for (const [id, booking] of bookingsMap) {
    if (shouldPauseSyncForOtherOperations) {
      await sleep(100); // Small delay to allow other operations
      shouldPauseSyncForOtherOperations = false;
    }

    const bookingDate = new Date(booking.start_time);
    if (bookingDate < twoMonthsAgo || bookingDate > fourMonthsLater) {
      const { error } = await supabase
        .from('Bookings')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting outdated booking:', error);
      } else {
        console.log(`Deleted outdated booking: ${id}`);
      }
    }
    await sleep(0); // Yield to event loop
  }
}


async function makeCalendarApiCall(apiCall) {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error('No valid access token available');
    }
    oauth2Client.setCredentials({ access_token: accessToken });
    return await apiCall();
  } catch (error) {
    if (error.code === 401) {
      // Token might be invalid, try to refresh
      const newToken = await getValidAccessToken(); // This will refresh the token
      if (!newToken) {
        throw new Error('Failed to refresh token');
      }
      oauth2Client.setCredentials({ access_token: newToken });
      // Retry the API call
      return await apiCall();
    } else {
      throw error;
    }
  }
}

function generateRoutes(){
  console.log('Generating routes...');
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/login', async (req, res) => {
    try {
      const { password } = req.body;
  
      if (password === process.env.APP_PASSWORD) {
        const userId = uuidv4();
  
        const sessionData = { isAuthenticated: true };
        const session = await createSession(userId, sessionData);
  
        res.cookie('sessionId', session.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 24 * 60 * 60 * 1000
        });
  
        res.redirect('/');
      } else {
        res.status(401).send('Invalid password');
      }
    } catch (error) {
      console.error('Error in login route:', error);
      res.status(500).send('Internal Server Error');
    }
  });
  
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });


  // Logout route
  app.get('/logout', async (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
      await deleteSession(sessionId);
      res.clearCookie('sessionId');
    }
    res.redirect('/login');
  });

  // Protect API routes  
  app.get('/api/auth-status', (req, res) => {
    console.log('Auth status checked, isAuthenticated:', !!req.session.isAuthenticated);
    res.json({ isAuthenticated: !!req.session.isAuthenticated });
  });
  
  // Modify the main route handler
  app.get('/', (req, res) => {
    if (req.session.isAuthenticated) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      res.redirect('/login');
    }
  });
  
app.use('/api', async (req, res, next) => {
  if (!req.session || !req.session.isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

  
  app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.file'],
      prompt: 'consent'
    });
    res.redirect(authUrl);
  });

  app.post('/api/sync-calendar', async (req, res) => {
    console.log('Sync calendar route accessed');
    console.log('Session authenticated:', !!req.session.isAuthenticated);
    if (syncInProgress) {
      console.log('Sync already in progress');
      return res.status(200).json({ message: 'Calendar sync already in progress' });
    }
  
    syncInProgress = true;
    try {
      console.log('Starting calendar sync');
      await fetchAndStoreCalendarEventsWithPauses();
      console.log('Calendar sync completed successfully');
      res.status(200).json({ message: 'Calendar sync completed successfully' });
    } catch (error) {
      console.error('Detailed error syncing calendar:', error);
      res.status(500).json({ error: 'Failed to sync calendar', details: error.message });
    } finally {
      syncInProgress = false;
    }
  });
  
  // Middleware to set pause flag
  app.use((req, res, next) => {
    if (syncInProgress) {
      shouldPauseSyncForOtherOperations = true;
    }
    next();
  });
  

// Replace WebSocket routes with HTTP endpoints
app.get('/api/bookings', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Bookings')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) throw error;
    const formattedData = data.map(booking => ({
      ...booking,
      start_time: new Date(booking.start_time).toISOString(),
      end_time: new Date(booking.end_time).toISOString()
    }));
    console.log(formattedData,"bookings")
    res.json({ type: 'Bookings', data: formattedData }); // Changed 'formattedData' to 'data'
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ type: 'error', message: 'Error fetching bookings' });
  }
});


// Updated route to create a booking
app.post('/api/bookings', async (req, res) => {
  let newBooking = req.body;
  try {
    if (!newBooking.summary) {
      newBooking.summary = newBooking.customer_name;
    }
    if (newBooking.address) {
      let geoResult = await geocodeAddress(newBooking.address);
      if (geoResult) {
        newBooking.latitude = geoResult.latitude;
        newBooking.longitude = geoResult.longitude;
        newBooking.address = geoResult.placeName;
        newBooking.is_sydney = geoResult.placeName.toLowerCase().includes('sydney');
      }
    }
    // Add to Google Calendar first
    newBooking.start_time = new Date(newBooking.start_time).toISOString();
    newBooking.end_time = new Date(newBooking.end_time).toISOString();

    let validatedBooking = validateBooking(newBooking);
    console.log(validatedBooking,"validated booking")
    const googleEventId = await addBookingToGoogleCalendar(validatedBooking);
    console.log(googleEventId,"googleEventId")
    // Use the Google Calendar event ID as the Supabase booking ID
    newBooking.id = googleEventId;
    delete newBooking.sent_follow_up_email
    // Add to Supabase
    const { data, error } = await supabase
      .from('Bookings')
      .insert([newBooking])
      .select()
      console.log(data)
    if (error) {
      console.log("error",error)
      // If Supabase insert fails, delete the Google Calendar event
      await deleteBookingFromGoogleCalendar(googleEventId);
      throw error;
    }
    await handleEventChange('Bookings', data[0].id);

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});


// Updated route to delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Delete from Google Calendar
    await handleEventDeletion('Bookings', id);
    await deleteBookingFromGoogleCalendar(id);

    // Delete from Supabase
    const { error } = await supabase
      .from('Bookings')
      .delete()
      .eq('id', id);

    if (error){
      console.log(error)
    }else{
      await handleEventDeletion('Bookings', id);
    }

    res.json({ message: 'Booking deleted successfully' });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

app.put('/api/bookings/update', async (req, res) => {
  const updatedBooking = req.body;
  try {
    console.log('Updating booking:', updatedBooking.id);

    const { data: oldBooking, error: fetchError } = await supabase
      .from('Bookings')
      .select('*')
      .eq('id', updatedBooking.id)
      .single();

    if (fetchError) {
      console.error('Error fetching old booking:', fetchError);
      throw fetchError;
    }

    // Check if the address has changed
    if (updatedBooking.address && updatedBooking.address !== oldBooking.address) {
      const coords = await geocodeAddress(updatedBooking.address);
      if (coords) {
        updatedBooking.latitude = coords.latitude;
        updatedBooking.longitude = coords.longitude;
      } else {
        console.warn('Failed to geocode new address');
      }
    }
console.log(updatedBooking)
    const { data: updated, error: updateError } = await supabase
      .from('Bookings')
      .update(updatedBooking)
      .eq('id', updatedBooking.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating booking in Supabase:', updateError);
      throw updateError;
    }

    try {
      await handleEventDeletion('Bookings', updatedBooking.id);
      await updateBookingInGoogleCalendar(updated);
    } catch (calendarError) {
      console.error('Error updating Google Calendar:', calendarError);
      // Decide if you want to throw this error or continue
    }

    if (updated.sent_invoice !== oldBooking.sent_invoice && updated.sent_invoice === true) {
      try {
        const pdfBuffer = await generateInvoice(updated);
        const fileName = `Invoice_${updated.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`;
        const fileId = await uploadToDrive(oauth2Client, pdfBuffer, fileName, 'application/pdf');
      
        await sendEmail(
          updated.email_address, 
          'Invoice for Your Upcoming Magic Show', 
          'Please find attached the invoice for your upcoming magic show.',
          pdfBuffer
        );
        
        await supabase
          .from('Bookings')
          .update({ invoice_file_id: fileId })
          .eq('id', updated.id);
      } catch (invoiceError) {
        console.error('Error processing invoice:', invoiceError);
        // Decide if you want to throw this error or continue
      }
    }

    if (updated.few_days_before !== oldBooking.few_days_before && updated.few_days_before === true) {
      try {
        await sendEmail(
          updated.email_address, 
          'Upcoming Magic Show Booking Reminder', 
          `Hi ${updated.customer_name},\n\nYour event is coming up in a few days. This is just a reminder message to double check everything is still going ahead according to the same plan.`
        );
      } catch (emailError) {
        console.error('Error sending reminder email:', emailError);
        // Decide if you want to throw this error or continue
      }
    }

    res.json({ type: 'bookingUpdated', data: updated });
  } catch (error) {
    console.error('Detailed error updating booking:', error);
    res.status(500).json({ 
      type: 'error', 
      message: 'Error updating booking', 
      details: error.message 
    });
  }
});

// Replace WebSocket routes with HTTP endpoints
app.get('/api/leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Leads')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) throw error;
    const formattedData = data.map(lead => ({
      ...lead,
      start_time: lead.start_time ? new Date(lead.start_time).toISOString() : null,
      end_time: lead.end_time ? new Date(lead.end_time).toISOString() : null
    }));
    console.log(formattedData,"leads")
    res.json({ type: 'Leads', data:formattedData });
  } catch (error) {
    console.error('Error fetching Leads:', error);
    res.status(500).json({ type: 'error', message: 'Error fetching Leads' });
  }
});

app.post('/api/parse-event', async (req, res) => {
  const { description } = req.body;
 console.log(description)
  try {
    let year=new Date().getFullYear();
    const prompt = `Here is some information about an event, copied from a website "${description}".
    I would like you to respond with a JSON object containing properties for some crucial information you 
    might find in the event information. If you can find the person's name, give the object a customer_name property
    containing the customer name, if you can find an email address have an email_address property, same for a
    phone_number, price, address, start_time and end_time (in AEST), and also make a short summary stored in the summary property. 
    The addresses are all within New South Wales Australia, if this is not mentioned, append this to the end of the address.
    If the year of the booking is not explicitly mentioned in the start and/or end time, assume it is taking place in ${year}.
    There might be a conversation included in which the customer gives updated or more specific details about the event, in that
    case you should use this more recent or specific information in your response.
    The response should be a full, complete JSON object, starting with { and ending with } and nothing else outside this.
    It should be a JSON object, not a Javascript object. Include no special characters in the response, essentially it is minified.`;
  
    let chatGPTResponse = await getChatGPTResponse(prompt);
    chatGPTResponse = JSON.parse(chatGPTResponse);
    console.log(chatGPTResponse)
    res.json(chatGPTResponse);
  } catch (error) {
    console.error('Error parsing event description:', error);
    res.status(500).json({ error: 'Failed to parse event description' });
  }
});

app.post('/api/leads', async (req, res) => {
  console.log("Processing new lead",req.body);
  try {
    let newLead = req.body;
    if (newLead.start_time) {
      newLead.start_time = new Date(newLead.start_time).toISOString();
    }
    if (newLead.end_time) {
      newLead.end_time = new Date(newLead.end_time).toISOString();
    }
    if (newLead.address) {
      let geoResult = await geocodeAddress(newLead.address);
      if (geoResult) {
        newLead.latitude = geoResult.latitude;
        newLead.longitude = geoResult.longitude;
        newLead.address = geoResult.placeName;
        newLead.is_sydney = geoResult.placeName.toLowerCase().includes('sydney');
      }
    }
    // Process the lead using the imported function
     let processedLead = await processLead(newLead, supabase);

    if (!processedLead) {
      processedLead=newLead
    }
    // Insert the processed lead into the database
    const { data, error } = await supabase
      .from('Leads')
      .insert([{
        ...processedLead,
        id:uuidv4(),
        latitude: processedLead.latitude,
        longitude: processedLead.longitude,
      }])
      .select();

    if (error){
      console.log(error)
    }
    
    await handleEventChange('Leads', data[0].id);
    console.log(data,"leads")
    res.json({ type: 'Leads', data });
  } catch (error) {
    console.error('Error processing and inserting lead:', error);
    res.status(500).json({ type: 'error', message: 'Error processing and inserting lead' });
  }
});

app.put('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const updatedLead = req.body;
  
  try {
    // Fetch the current lead data
    const { data: currentLead, error: fetchError } = await supabase
      .from('Leads')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError){
      console.log(fetchError)
    }
    if (updatedLead.start_time) {
      updatedLead.start_time = new Date(updatedLead.start_time).toISOString();
    }
    if (updatedLead.end_time) {
      updatedLead.end_time = new Date(updatedLead.end_time).toISOString();
    }
    // Check if the address has changed
    if (updatedLead.address && updatedLead.address !== currentLead.address) {
      const coords = await geocodeAddress(updatedLead.address);
      if (coords) {
        updatedLead.latitude = coords.latitude;
        updatedLead.longitude = coords.longitude;
      } else {
        console.error('Failed to geocode new address for lead');
        // You might want to handle this error case according to your needs
      }
    }

    // Update in Supabase
    const { data, error } = await supabase
      .from('Leads')
      .update(updatedLead)
      .eq('id', id)
      .select()
      .single();

    if (error){
      console.log(error)
    }
    await handleEventChange('Leads', data[0].id);

    res.json(data);
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Call handleEventDeletion before deleting the lead
    await handleEventDeletion('Leads', id);

    const { error } = await supabase
      .from('Leads')
      .delete()
      .eq('id', id);

    if (error) {
      console.log(error);
      throw error;
    }

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

app.post('/delete', async (req, res) => {
  const { bookingid, type } = req.body;
  
  try {
    let tableName;
    if (type === 'Bookings') {
      tableName = 'Bookings';
      
      // Delete from Google Calendar
      try {
        await deleteBookingFromGoogleCalendar(bookingid);
      } catch (calendarError) {
        console.error('Error deleting from Google Calendar:', calendarError);
        // Decide how to handle this error. You might want to:
        // - Continue with the database deletion anyway
        // - Send a warning to the client
        // - Or, if calendar sync is critical, you might want to abort the whole operation
      }
    } else if (type === 'Leads') {
      tableName = 'Leads';
    } else {
      throw new Error('Invalid type specified');
    }

    // Delete from Supabase
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('id', bookingid);

    if (error) throw error;

    res.status(200).json({ message: `${type} item deleted successfully` });
  } catch (error) {
    console.error(`Error deleting ${type} item:`, error);
    res.status(500).json({ error: `Failed to delete ${type} item` });
  }
});

app.post('/remove-lead', async (req, res) => {
  const { leadId } = req.body;
  
  try {
    // Fetch the lead
    const { data: lead, error: fetchError } = await supabase
      .from('Leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (fetchError) throw fetchError;
    if (!lead) throw new Error('Lead not found');

    // Delete the lead
    const { error: deleteError } = await supabase
      .from('Leads')
      .delete()
      .eq('id', leadId);

    if (deleteError) throw deleteError;

    res.status(200).json({ message: 'Lead successfully converted to booking'});
  } catch (error) {
    console.error('Error converting lead to booking:', error);
    res.status(500).json({ error: 'Failed to convert lead to booking' });
  }
});

app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.file'],
      prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/auth-status', (req, res) => {
  const isAuthenticated = !!oauth2Client.credentials.access_token;
  res.json({ isAuthenticated });
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      await updateTokensInDatabase(tokens);
      res.redirect('./auth-success.html');
  } catch (error) {
      console.error('Error retrieving access token:', error);
      res.redirect('./auth-error.html');
  }
});

app.post('/send-invoice-request', async (req, res) => {
  const { to, subject, booking } = req.body;

  try {
    const fileId = await sendEmailWithInvoice(to, subject, booking, oauth2Client);

    // Update the booking in Supabase
    const { error } = await supabase
      .from('Bookings')
      .update({ 
        sent_invoice: true,
        invoice_file_id: fileId  // Store the Google Drive file ID
      })
      .eq('id', booking.id);

    if (error) throw error;

    res.status(200).json({ message: 'Invoice sent successfully, uploaded to Drive, and database updated' });
  } catch (error) {
    console.error('Error in invoice process:', error);
    res.status(500).json({ error: 'Failed to process invoice' });
  }
});


app.post('/send-email', async (req, res) => {
  const { to, subject, text } = req.body;

  try {
    await sendEmail(to, subject, text);
    res.status(200).json({ message: 'Information request sent successfully' });
  } catch (error) {
    console.error('Error sending information request:', error);
    res.status(500).json({ error: 'Failed to send information request' });
  }
});
console.log("Finished route definitions");
}
async function removeOldPaidBookings() {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  
  try {
    const { data, error } = await supabase
      .from('Bookings')
      .delete()
      .lt('end_time', twoMonthsAgo.toISOString())
      .eq('full_payment_made', true)
      .select();

    if (error) {
      console.error('Error removing old paid bookings:', error);
    } else {
      console.log(`Removed ${data ? data.length : 0} old paid bookings`);
    }
  } catch (error) {
    console.error('Error in removeOldPaidBookings:', error);
  }
}

async function syncCalendarWithSupabase(calendarEvents) {
  await makeCalendarApiCall(async () => {
    // Define the time range
    const now = new Date();
    const twoMonthsAgo = new Date(now.setMonth(now.getMonth() - 2));
    const fourMonthsLater = new Date(now.setMonth(now.getMonth() + 6)); // 4 months from the original date

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

    // Process each calendar event within the specified time range
    for (const event of calendarEvents) {
      const eventStartTime = new Date(event.start.dateTime || event.start.date);
      const eventEndTime = new Date(event.end.dateTime || event.end.date);

      if (eventStartTime >= twoMonthsAgo && eventEndTime <= fourMonthsLater) {
        const bookingData = {
          id: event.id,
          summary: event.summary || null,
          event_name: event.event_name || event.summary || null,
          customer_name: event.customer_name || event.summary || null,
          start_time: event.start.dateTime || event.start.date,
          end_time: event.end.dateTime || event.end.date,
          phone_number: event.phone_number || null,
          address: event.address || event.location || null,
          invoice_file_id: event.invoice_file_id || null,
          cash: event.cash || null,
          price: event.price || 0,
          email_address: event.email_address || null,
          // Other fields...
        };

        if (bookingsMap.has(event.id)) {
          // Update existing booking
          const { error } = await supabase
            .from('Bookings')
            .update(bookingData)
            .eq('id', event.id);

          if (error) console.error('Error updating booking:', error);
        } else {
          // Add new booking
          const { error } = await supabase
            .from('Bookings')
            .insert([bookingData]);

          if (error) console.error('Error inserting new booking:', error);
        }

        // Remove this event from the map as it's been processed
        bookingsMap.delete(event.id);
      }
    }

    // Remove Supabase bookings that are no longer in the calendar or outside the time range
    for (const [id, booking] of bookingsMap) {
      const bookingStartTime = new Date(booking.start_time);
      const bookingEndTime = new Date(booking.end_time);

      if (bookingEndTime < twoMonthsAgo || bookingStartTime > fourMonthsLater || booking.full_payment_made) {
        const { error } = await supabase
          .from('Bookings')
          .delete()
          .eq('id', id);

        if (error) console.error('Error deleting outdated booking:', error);
      }
    }
  });
}
  
  function toUTC(dateString) {
    return new Date(dateString).toISOString();
  }
  
  function fromUTC(dateString, timeZone = 'Australia/Sydney') {
    return new Date(dateString).toLocaleString('en-AU', { timeZone: timeZone });
  }
  
  async function addBookingToGoogleCalendar(booking) {
    return await makeCalendarApiCall(async () => {
    // Validate and format date-time
    const formatDateTime = (dateTimeString) => {
      if (!dateTimeString) return null;
      const date = new Date(dateTimeString);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    };

    const startDateTime = formatDateTime(booking.start_time);
    const endDateTime = formatDateTime(booking.end_time);
  
    if (!startDateTime || !endDateTime) {
      throw new Error('Invalid start or end time provided');
    }
  
    const event = {
      summary: booking.customer_name || "summary",
      description: booking.summary || 'No description provided',
      start: {
        dateTime: startDateTime,
        timeZone: 'Australia/Sydney',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Australia/Sydney',
      },
      location: booking.address || 'No location provided',
      visibility: 'public',
      extendedProperties: {
        private: {
          customerName: booking.customer_name || 'No name provided',
          phoneNumber: booking.phone_number || 'No phone provided',
          address: booking.address || 'No address provided',
          emailAddress: booking.email_address || 'No email provided',
          price: (booking.price || 0).toString(),
        }
    }
  }
  
    console.log('Creating event:', JSON.stringify(event, null, 2));
  
    try {
      if (!oauth2Client.credentials || !oauth2Client.credentials.access_token) {
        throw new Error('Google Calendar is not properly authenticated');
      }
  
      const res = await calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event,
      });
  
      console.log('Event created: %s', res.data.htmlLink);
      return res.data.id;
    } catch (error) {
      console.error('Error creating Google Calendar event:', error.message);
      if (error.response) {
        console.error('Error response:', error.response.data);
      }
      throw error;
    }
  })
}
  
  // Function to delete a booking from Google Calendar
async function deleteBookingFromGoogleCalendar(eventId) {
  return await makeCalendarApiCall(async () => {
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
})
}


  // Helper function to parse and validate date-time strings
  function parseDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date-time string: ${dateTimeString}`);
    }
    return date.toISOString();
  }
  
  // Function to validate booking object before creating event
  function validateBooking(booking) {
    if (!booking.summary) throw new Error('Booking summary is required');
    if (!booking.start_time) throw new Error('Booking start time is required');
    if (!booking.end_time) throw new Error('Booking end time is required');
    
    // Ensure dates are in ISO format
    booking.start_time = new Date(booking.start_time).toISOString();
    booking.end_time = new Date(booking.end_time).toISOString();
    
    return booking;
  }
  
  function toAustralianTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  }
  function displayBookingTimes(booking) {
    const localStartTime = fromUTC(booking.start_time);
    const localEndTime = fromUTC(booking.end_time);
    console.log(`Event starts at ${localStartTime} and ends at ${localEndTime} (Australia/Sydney time)`);
  }

  async function geocodeAddress(address) {
    const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
    
    // Default to Australia
    let country = 'AU';
    let bbox = '112.9211,-43.7429,153.6386,-10.5672'; // Bounding box for Australia
  
    // Check if the address explicitly mentions a state or country
    const lowercaseAddress = address.toLowerCase();
    if (lowercaseAddress.includes('victoria') || lowercaseAddress.includes('vic')) {
      bbox = '140.9621,-39.1596,150.0260,-33.9806'; // Victoria bounding box
    } else if (lowercaseAddress.includes('new south wales') || lowercaseAddress.includes('nsw')) {
      bbox = '141.0,-37.5,153.6,-28.5'; // NSW bounding box
    } else if (lowercaseAddress.includes('queensland') || lowercaseAddress.includes('qld')) {
      bbox = '137.9959,-29.1781,153.5516,-9.1422'; // Queensland bounding box
    } else if (lowercaseAddress.match(/\b(usa|united states|america)\b/)) {
      country = 'US';
      bbox = '-171.791110603,18.91619,-66.96466,71.3577635769'; // USA bounding box
    }
    // Add more conditions for other states or countries as needed
  
    try {
      const response = await axios.get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`, {
        params: {
          access_token: MAPBOX_ACCESS_TOKEN,
          country: country,
          bbox: bbox,
          types: 'address,place',
          limit: 1
        }
      });
  
      if (response.data.features && response.data.features.length > 0) {
        const [longitude, latitude] = response.data.features[0].center;
        const placeName = response.data.features[0].place_name;
        return { latitude, longitude, placeName };
      } else {
        console.warn('No results found for the given address:', address);
        return null;
      }
    } catch (error) {
      console.error('Error geocoding address:', address, error.message);
      return null;
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



if (require.main === module) {
  // This block will only run if the script is executed directly
  (async () => {
    await main();
  })();
}


module.exports = {
  // Export all functions from the current file
  getValidAccessToken,
  updateTokensInDatabase,
  initializeGoogleCalendar,
  generateInvoice,
  sendEmail,
  sendEmailWithInvoice,
  uploadToDrive,
  updateBookingInGoogleCalendar,
  removeOldPaidBookings,
  fetchAndStoreCalendarEventsWithPauses,
  makeCalendarApiCall,
  generateRoutes,
  geocodeAddress,
  getChatGPTResponse,
  processLead,
  validateBooking,
  addBookingToGoogleCalendar,
  deleteBookingFromGoogleCalendar,
  syncCalendarWithSupabase,
  toUTC,
  fromUTC,
  parseDateTime,
  toAustralianTime,
  main,  
  app,
  supabase,
  oauth2Client,
  updateTokensInDatabase 
};

console.log("magicworkstation.js fully loaded");