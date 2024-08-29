const request = require('supertest');
const { app, main, supabase, oauth2Client, geocodeAddress } = require('../magicworkstation');
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Mock geocodeAddress function
jest.mock('../magicworkstation', () => {
  const originalModule = jest.requireActual('../magicworkstation');
  return {
    ...originalModule,
    geocodeAddress: jest.fn().mockResolvedValue({
      latitude: -33.8688,
      longitude: 151.2093,
      placeName: 'Sydney NSW 2000, Australia'
    })
  };
});

let server;
let testBookingId;
let testLeadId;

beforeAll(async () => {
  const result = await main(false);
  server = result.app;
});

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

describe('API Routes', () => {
  // Test /api/sync-calendar
  test('POST /api/sync-calendar', async () => {
    const response = await request(app).post('/api/sync-calendar');
    console.log('Response status:', response.status);
    console.log('Response body:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Calendar sync and cleanup completed successfully' });
  }, 30000);

  // Test /api/bookings GET
  test('GET /api/bookings', async () => {
    const response = await request(app).get('/api/bookings');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('type', 'Bookings');
    expect(response.body).toHaveProperty('data');
  });

  test('POST /api/bookings', async () => {
    const mockBooking = {
      summary: 'Test Booking',
      customer_name: 'John Doe',
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      address: '123 Test St, Sydney, NSW'
    };
    const response = await request(server).post('/api/bookings').send(mockBooking);
    console.log('POST /api/bookings response:', response.body);
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    testBookingId = response.body.id;
  }, 30000);

  test('POST /api/bookings/update', async () => {
    const mockUpdatedBooking = {
      id: testBookingId,
      summary: 'Updated Test Booking',
      address: '456 New St, Sydney, NSW',
      customer_name: 'John Doe Updated'
    };
    const response = await request(server).post('/api/bookings/update').send(mockUpdatedBooking);
    console.log('POST /api/bookings/update response:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('type', 'bookingUpdated');
    expect(response.body).toHaveProperty('data');
  }, 30000);

  test('DELETE /api/bookings/:id', async () => {
    const response = await request(server).delete(`/api/bookings/${testBookingId}`);
    console.log('DELETE /api/bookings/:id response:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Booking deleted successfully' });
  }, 30000);


  // Test /api/leads GET
  test('GET /api/leads', async () => {
    const response = await request(server).get('/api/leads');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('type', 'Leads');
    expect(response.body).toHaveProperty('data');
  });

  // Test /api/parse-event POST
  test('POST /api/parse-event', async () => {
    const mockDescription = 'Magic show for John Doe on July 1st, 2023 from 2 PM to 4 PM at 123 Main St, Sydney NSW 2000. Contact: john@example.com, 0412345678. Price: $500.';
    const response = await request(server).post('/api/parse-event').send({ description: mockDescription });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('customer_name');
    expect(response.body).toHaveProperty('email_address');
    expect(response.body).toHaveProperty('phone_number');
    expect(response.body).toHaveProperty('address');
    expect(response.body).toHaveProperty('start_time');
    expect(response.body).toHaveProperty('end_time');
    expect(response.body).toHaveProperty('price');
  }, 30000);

  // Test /api/leads POST
  test('POST /api/leads', async () => {
    const mockLead = {
      id:uuidv4(),
      customer_name: 'Jane Doe',
      email_address: 'jane@example.com',
      phone_number: '1234567890',
      address: '789 Lead St, Sydney, NSW'
    };
    const response = await request(server).post('/api/leads').send(mockLead);
    console.log('POST /api/leads response:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('type', 'Leads');
    expect(response.body).toHaveProperty('data');
    testLeadId = response.body.data[0].id;
  });

  test('PUT /api/leads/:id', async () => {
    const mockUpdatedLead = {
      id:uuidv4(),
      customer_name: 'Jane Updated',
      address: '101 Updated St, Sydney, NSW'
    };
    const response = await request(server).put(`/api/leads/${testLeadId}`).send(mockUpdatedLead);
    console.log('PUT /api/leads/:id response:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('customer_name', 'Jane Updated');
    expect(response.body).toHaveProperty('address', '101 Updated St, Sydney, NSW');
  });

  // Test /delete POST for lead
  test('POST /delete for lead', async () => {
    const mockDeleteRequest = {
      bookingid: global.createdLeadId,
      type: 'Leads'
    };
    const response = await request(server).post('/delete').send(mockDeleteRequest);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Leads item deleted successfully' });
  });

  // Test /auth-status GET
  test('GET /auth-status', async () => {
    const response = await request(server).get('/auth-status');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('isAuthenticated');
  });

  // Test /send-invoice-request POST
  test('POST /send-invoice-request', async () => {
    const mockInvoiceRequest = {
      to: 'test@example.com', // Use a test email address
      subject: 'Test Invoice for Magic Show',
      booking: {
        id: 'test-booking-id',
        customer_name: 'Test Customer',
        start_time: new Date().toISOString(),
        price: 100
      }
    };
    const response = await request(server).post('/send-invoice-request').send(mockInvoiceRequest);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Invoice sent successfully, uploaded to Drive, and database updated' });
  }, 60000); // Increase timeout for email sending and file upload

  // Test /send-email POST
  test('POST /send-email', async () => {
    const mockEmailRequest = {
      to: 'test@example.com',
      subject: 'Test Magic Show Information',
      text: 'This is a test email for your upcoming magic show.'
    };
    const response = await request(app).post('/send-email').send(mockEmailRequest);
    console.log('Response status:', response.status);
    console.log('Response body:', response.body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Information request sent successfully' });
  }, 30000);
});