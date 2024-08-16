require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const http = require('http');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const clipboardy = require('node-clipboardy');
const fs = require('fs');
const TOKEN_PATH = 'token.json';
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const stream = require('stream');
const {
  addBookingToGoogleCalendar,
  updateBookingInGoogleCalendar,
  deleteBookingFromGoogleCalendar,
  findGoogleEventByBookingId,
} = require('./googlecalendarfunctions'); 
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use(cors());

const port = 3000;
const CLIENT_ID = process.env.GOOGLECLIENTID;
const CLIENT_SECRET = process.env.GOOGLECLIENTSECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    // Store the new tokens
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(oauth2Client.credentials));
    console.log('New tokens stored to', TOKEN_PATH);
  }
});



async function generateInvoice(booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    const bufferStream = new stream.PassThrough();

    bufferStream.on('data', chunk => buffers.push(chunk));
    bufferStream.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });

    doc.pipe(bufferStream);

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
    doc.text(`Due Date: ${dueDate}`);
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

    doc.moveDown(2);
    doc.text('Notes:');
    doc.text('- For bank transfers, please use your name and event date as the reference.');
    doc.moveDown();
    doc.text('Thank you for your business!');

    // Finalize the PDF and end the stream
    doc.end();
  });
}


// Create a transporter object
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // use false for STARTTLS; true for SSL on port 465
  auth: {
    user: 'julianbullmagic@gmail.com',
    pass: process.env.GMAILAPPPASSWORD,
  }
});


async function sendEmail(recipient,subject,message,attachment){
  let mailOptions = {
    from: 'julianbullmagic@gmail.com',
    to: recipient,
    subject: subject,
    text: message
  };

  if (attachment) {
    mailOptions.attachments = [{
      filename: 'invoice.pdf',
      content: attachment
    }];
  }
  // Send the email
  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log('Error:', error);
    } else {
      console.log('Email sent: ', info.response);
    }
  });
}

async function sendEmailWithInvoice(recipient, subject, booking, auth) {
  try {
    // Generate the invoice
    let invoiceBuffer = await generateInvoice(booking);

    // Upload to Google Drive
    const fileName = `Invoice_${booking.customer_name}_${new Date(booking.start_time).toISOString().split('T')[0]}.pdf`;
    const fileId = await uploadToDrive(auth, invoiceBuffer, fileName, 'application/pdf');

    // Send email with invoice
    let message = `Hi ${booking.customer_name},

    I have attached the invoice for my services to this email.
    The invoice has also been saved to Google Drive for my records.`;

    await sendEmail(recipient, subject, message, invoiceBuffer);

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

async function fetchAndStoreCalendarEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const twoMonthsAgo = new Date(now.setMonth(now.getMonth() - 2));
  const twoMonthsLater = new Date(now.setMonth(now.getMonth() + 4));

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: twoMonthsAgo.toISOString(),
      timeMax: twoMonthsLater.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items;
    console.log(`Fetched ${events.length} events from Google Calendar`);

    for (const event of events) {
      // Check if event already exists in Supabase
      const { data: existingEvent } = await supabase
        .from('Bookings')
        .select('id')
        .eq('id', event.id)
        .single();

      if (!existingEvent) {
        // Event doesn't exist, so add it to Supabase
        const newBooking = {
          id: event.id,
          summary: event.summary || null,
          event_name: event.summary || null,
          customer_name: event.summary || null,
          start_time: event.start.dateTime || event.start.date,
          end_time: event.end.dateTime || event.end.date,
        };

        const { error } = await supabase
          .from('Bookings')
          .insert([newBooking]);

        if (error) {
          console.error('Error inserting new booking:', error);
        } else {
          console.log('New booking added:', newBooking.id);
        }
      }
    }

    console.log('Calendar sync completed');
  } catch (error) {
    console.error('Error fetching or storing calendar events:', error);
  }
}

app.post('/api/sync-calendar', async (req, res) => {
  try {
    await fetchAndStoreCalendarEvents(oauth2Client);
    res.status(200).json({ message: 'Calendar sync completed successfully' });
  } catch (error) {
    console.error('Error syncing calendar:', error);
    res.status(500).json({ error: 'Failed to sync calendar' });
  }
});

// Replace WebSocket routes with HTTP endpoints
app.get('/api/bookings', async (req, res) => {
  console.log(req,"GETTING BOOKINGS")
  try {
    const { data, error } = await supabase
      .from('Bookings')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) throw error;

    res.json({ type: 'Bookings', data });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ type: 'error', message: 'Error fetching bookings' });
  }
});

// Updated route to create a booking
app.post('/api/bookings', async (req, res) => {
  const newBooking = req.body;
  
  try {
    // Add to Google Calendar first
    const googleEventId = await addBookingToGoogleCalendar(newBooking);

    // Use the Google Calendar event ID as the Supabase booking ID
    newBooking.id = googleEventId;

    // Add to Supabase
    const { data, error } = await supabase
      .from('Bookings')
      .insert([newBooking])
      .select()
      .single();

    if (error) {
      // If Supabase insert fails, delete the Google Calendar event
      await deleteBookingFromGoogleCalendar(googleEventId);
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Updated route to update a booking
app.put('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const updatedBooking = req.body;
  
  try {
    // Update in Google Calendar
    await updateBookingInGoogleCalendar({ ...updatedBooking, id });

    // Update in Supabase
    const { data, error } = await supabase
      .from('Bookings')
      .update(updatedBooking)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Updated route to delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Delete from Google Calendar
    await deleteBookingFromGoogleCalendar(id);

    // Delete from Supabase
    const { error } = await supabase
      .from('Bookings')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Booking deleted successfully' });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

app.post('/api/bookings/update', async (req, res) => {
  const updatedBooking = req.body;
  try {
    const { data: oldBooking } = await supabase
      .from('Bookings')
      .select('*')
      .eq('id', updatedBooking.id)
      .single();

    const { data: updated, error } = await supabase
      .from('Bookings')
      .update(updatedBooking)
      .eq('id', updatedBooking.id)
      .select()
      .single();
    
    if (error) throw error;

    if (updated.sent_invoice !== oldBooking.sent_invoice && updated.sent_invoice === true) {
      const pdfBuffer = await generateInvoice(updated);
      const fileName = `Invoice_${updated.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`;
      const fileId = await uploadToDrive(oauth2Client, pdfBuffer, fileName, 'application/pdf');
    
      await sendEmailWithAttachment(
        updated.email_address, 
        'Invoice for Your Upcoming Magic Show', 
        'Please find attached the invoice for your upcoming magic show.',
        [{
          filename: 'invoice.pdf',
          content: pdfBuffer
        }]
      );
      
      await supabase
        .from('Bookings')
        .update({ invoice_file_id: fileId })
        .eq('id', updated.id);
    }

    if (updated.few_days_before !== oldBooking.few_days_before && updated.few_days_before === true) {
      await sendEmail(updated.email_address, 'Upcoming Magic Show Booking Reminder', `Hi ${updated.customer_name},
      
      Your event is coming up in a few days. This is just a reminder message to double check everything is still going ahead 
      according to the same plan.`);
    }

    res.json({ type: 'bookingUpdated', data: updated });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ type: 'error', message: 'Error updating booking' });
  }
});


// Replace WebSocket routes with HTTP endpoints
app.get('/api/leads', async (req, res) => {
  console.log(req,"GETTING Leads")
  try {
    const { data, error } = await supabase
      .from('Leads')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) throw error;

    res.json({ type: 'Leads', data });
  } catch (error) {
    console.error('Error fetching Leads:', error);
    res.status(500).json({ type: 'error', message: 'Error fetching Leads' });
  }
});

app.post('/api/leads/update', async (req, res) => {
  const updatedLead = req.body;
  console.log(updatedLead)
  try {
    const { data: updated, error } = await supabase
      .from('Leads')
      .update(updatedLead)
      .eq('id', updatedLead.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ type: 'leadUpdated', data: updated });
  } catch (error) {
    console.error(error,'Error updating lead:');
    res.status(500).json({ type: 'error', message: 'Error updating lead' });
  }
});

// Add this route to your Express app

app.post('/delete', async (req, res) => {
  const { bookingid, type } = req.body;
  
  try {
    let tableName;
    if (type === 'Bookings') {
      tableName = 'Bookings';
    } else if (type === 'Leads') {
      tableName = 'Leads';
    } else {
      throw new Error('Invalid type specified');
    }

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

app.post('/convert-lead-to-booking', async (req, res) => {
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

    // Insert the lead into the Bookings table
    const { data: newBooking, error: insertError } = await supabase
      .from('Bookings')
      .insert([{
        summary: lead.summary,
        event_name: lead.event_name,
        customer_name: lead.customer_name,
        start_time: lead.start_time,
        end_time: lead.end_time,
        phone_number: lead.phone_number,
        address: lead.address,
        email_address: lead.email_address,
        price: lead.price
        // Add any other fields that need to be transferred
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Delete the lead
    const { error: deleteError } = await supabase
      .from('Leads')
      .delete()
      .eq('id', leadId);

    if (deleteError) throw deleteError;

    res.status(200).json({ message: 'Lead successfully converted to booking', newBookingId: newBooking.id });
  } catch (error) {
    console.error('Error converting lead to booking:', error);
    res.status(500).json({ error: 'Failed to convert lead to booking' });
  }
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save the tokens to file
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Token stored to', TOKEN_PATH);

    res.send('Authentication successful! You can close this tab.');

    await fetchEvents(oauth2Client);
  } catch (error) {
    console.error('Error retrieving access token:', error);
    res.send('Authentication failed.');
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


function loadSavedTokensIfExist() {
  try {
    const token = fs.readFileSync(TOKEN_PATH);
    oauth2Client.setCredentials(JSON.parse(token));
    return true;
  } catch (error) {
    return false;
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
      summary:event.summary||null,
      event_name:event.event_name||event.summary||null,
      customer_name: event.customer_name||event.summary||null,
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      phone_number: event.phone_number||null, 
      address:event.address||event.location||null,
      invoice_file_id:event.invoice_file_id||null,
      cash:event.cash||null,
      price: event.price || 0,
      customer_happy:null,
      deposit_paid:null,
      email_address:event.email_address||null,
      few_days_before:null,
      microphone_needed:null,
      review_requested:null,
      sent_invoice:null,
      full_payment_made:null,
    };


if ('cash' in event) bookingData.cash = event.cash;
if ('customer_happy' in event) bookingData.customer_happy = event.customer_happy;
if ('deposit_paid' in event) bookingData.deposit_paid = event.deposit_paid;
if ('few_days_before' in event) bookingData.few_days_before = event.few_days_before;
if ('microphone_needed' in event) bookingData.microphone_needed = event.microphone_needed;
if ('review_requested' in event) bookingData.review_requested = event.review_requested;
if ('sent_invoice' in event) bookingData.sent_invoice = event.sent_invoice;
if ('full_payment_made' in event) bookingData.full_payment_made = event.full_payment_made;

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

async function fetchEvents(auth) {
    console.log('Fetching events...');
    const calendar = google.calendar({ version: 'v3', auth });
  
    const now = new Date();
    const timeMin = new Date(now.setMonth(now.getMonth() - 2)).toISOString();
    const timeMax = new Date(now.setMonth(now.getMonth() + 4)).toISOString();
  
    console.log('Fetching events between:', timeMin, 'and', timeMax); // Log the time range
    
  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    console.log('API Response:', res.data); // Log the full API response

    const events = res.data.items;
    if (events.length) {
      await syncCalendarWithSupabase(events);
    } else {
      console.log('No upcoming events found.');
    }
  } catch (error) {
    console.error('Error fetching calendar events:', error);
  }
  }
  

  if (loadSavedTokensIfExist()) {
    console.log('Loaded saved tokens');
    // Fetch and store calendar events on server start
    fetchAndStoreCalendarEvents(oauth2Client);
  } else {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive.file'
      ]
    })
    console.log('Authorize this app by visiting this URL:', authUrl);
  }
  
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
  });