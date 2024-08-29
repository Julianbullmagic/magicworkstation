// test/invoiceGenerationAndUpload.test.js

const { generateInvoice, sendEmailWithInvoice, uploadToDrive, getValidAccessToken } = require('../magicworkstation');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

// Load environment variables
require('dotenv').config();

const {
  GOOGLECLIENTID,
  GOOGLECLIENTSECRET,
  SUPABASEURL,
  SUPABASEKEY,
} = process.env;

// Initialize Supabase client
const supabase = createClient(SUPABASEURL, SUPABASEKEY);

// Initialize Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  GOOGLECLIENTID,
  GOOGLECLIENTSECRET,
  'http://localhost:3000/callback'
);

// Initialize Google Drive
let drive;

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ response: 'Email sent' })
  })
}));

describe('Invoice Generation, Upload, and Cleanup', () => {
  let testBooking;
  let uploadedFileId;
  const testOutputDir = path.join(__dirname, 'test-invoices');

  beforeAll(async () => {
    console.log('IMPORTANT: Ensure you have manually authenticated by running magicworkstation.js before running these tests.');
    
    await fs.mkdir(testOutputDir, { recursive: true });

    // Set up Google API authentication
    try {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        throw new Error('No valid access token found. Please authenticate manually first.');
      }
      oauth2Client.setCredentials({ access_token: accessToken });
      drive = google.drive({ version: 'v3', auth: oauth2Client });
    } catch (error) {
      console.error('Failed to set up Google API authentication:', error);
      throw error;
    }

    // Create a test booking
    testBooking = {
      id: 'test-booking-' + Date.now(),
      customer_name: 'Test Customer',
      email_address: 'test@example.com',
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600000).toISOString(),
      price: 100,
      address: '123 Test St, Test City, NSW 2000'
    };
    const { data, error } = await supabase.from('Bookings').insert([testBooking]).select();
    if (error) throw error;
    testBooking = data[0];
  });

  afterAll(async () => {
    if (testBooking) {
      await supabase.from('Bookings').delete().eq('id', testBooking.id);
    }
    const files = await fs.readdir(testOutputDir);
    for (const file of files) {
      await fs.unlink(path.join(testOutputDir, file));
    }
    await fs.rmdir(testOutputDir);
  });

  afterEach(async () => {
    if (uploadedFileId) {
      try {
        await drive.files.delete({ fileId: uploadedFileId });
      } catch (error) {
        console.error('Failed to delete file from Google Drive:', error);
      }
      uploadedFileId = null;
    }
  });

  it('should generate an invoice, upload it to Google Drive, update the booking, and then clean up', async () => {
    const recipient = 'test@example.com';
    const subject = 'Test Invoice';

    // Generate invoice
    const pdfBuffer = await generateInvoice(testBooking);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Save invoice locally for verification
    const filePath = path.join(testOutputDir, `invoice_${testBooking.id}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    // Upload to Google Drive and send email
    uploadedFileId = await sendEmailWithInvoice(recipient, subject, testBooking, oauth2Client);
    expect(uploadedFileId).toBeTruthy();

    // Verify file exists in Google Drive
    const file = await drive.files.get({ fileId: uploadedFileId });
    expect(file.data.id).toBe(uploadedFileId);

    // Check if the booking was updated in Supabase
    const { data: updatedBooking, error } = await supabase
      .from('Bookings')
      .select('*')
      .eq('id', testBooking.id)
      .single();

    expect(error).toBeNull();
    expect(updatedBooking.sent_invoice).toBe(true);
    expect(updatedBooking.invoice_file_id).toBe(uploadedFileId);

    // Clean up is handled in afterEach
  }, 120000);

  it('should handle errors gracefully and not leave files in Google Drive', async () => {
    const invalidBooking = { ...testBooking, customer_name: undefined };
    const recipient = 'test@example.com';
    const subject = 'Test Invoice';

    try {
      await sendEmailWithInvoice(recipient, subject, invalidBooking, oauth2Client);
      fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeDefined();
    }

    // Verify no file was left in Google Drive
    const response = await drive.files.list({
      q: `name contains 'Invoice_${invalidBooking.id}'`,
      fields: 'files(id, name)',
    });

    expect(response.data.files.length).toBe(0);
  }, 120000);
});