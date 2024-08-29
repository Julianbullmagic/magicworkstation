require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create a transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // use TLS
  auth: {
    user: 'julianbullmagic@gmail.com',
    pass: process.env.GMAILAPPPASSWORD,
  }
});

async function getTomorrowsBookings() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  const { data, error } = await supabase
    .from('Bookings')
    .select('*')
    .gte('start_time', tomorrow.toISOString())
    .lt('start_time', dayAfterTomorrow.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching tomorrow\'s bookings:', error);
    return [];
  }

  return data;
}

function formatBookingDetails(booking) {
  return `
    Event: ${booking.event_name || 'N/A'}
    Customer: ${booking.customer_name || 'N/A'}
    Start Time: ${new Date(booking.start_time).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
    End Time: ${new Date(booking.end_time).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
    Address: ${booking.address || 'N/A'}
    Phone: ${booking.phone_number || 'N/A'}
    Email: ${booking.email_address || 'N/A'}
    Price: $${booking.price || 'N/A'}
    Deposit Paid: ${booking.deposit_paid ? 'Yes' : 'No'}
    Full Payment Made: ${booking.full_payment_made ? 'Yes' : 'No'}
    Microphone Needed: ${booking.microphone_needed ? 'Yes' : 'No'}
    Seen Me Before: ${booking.seen_me_before ? 'Yes' : 'No'}
    Performance Type: ${booking.roving_or_show_or_both || 'N/A'}
    Additional Notes: ${booking.summary || 'N/A'}
  `;
}

async function sendDailyReminder() {
  const bookings = await getTomorrowsBookings();

  if (bookings.length === 0) {
    console.log('No bookings for tomorrow. No email sent.');
    return;
  }

  const summary = `You have ${bookings.length} booking${bookings.length > 1 ? 's' : ''} scheduled for tomorrow.`;
  
  let emailBody = `${summary}\n\nHere are the details:\n`;
  
  bookings.forEach((booking, index) => {
    emailBody += `\nBooking ${index + 1}:${formatBookingDetails(booking)}\n`;
  });

  const mailOptions = {
    from: 'julianbullmagic@gmail.com',
    to: 'julianbullmagic@gmail.com',
    subject: 'Daily Reminder: Tomorrow\'s Bookings',
    text: emailBody,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Reminder email sent successfully:', info.response);
  } catch (error) {
    console.error('Error sending reminder email:', error);
  }
}

// Execute the script
sendDailyReminder().catch(console.error);