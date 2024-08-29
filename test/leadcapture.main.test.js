// test/leadcapture.main.test.js

const clipboardy = require('node-clipboardy');
const { processLeadCapture, getChatGPTResponse } = require('../leadcapture');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASEURL, process.env.SUPABASEKEY);

// Mock clipboardy
jest.mock('node-clipboardy', () => ({
  readSync: jest.fn()
}));

// Mock getChatGPTResponse
jest.mock('../leadcapture', () => {
  const originalModule = jest.requireActual('../leadcapture');
  return {
    ...originalModule,
    getChatGPTResponse: jest.fn(),
    processLeadCapture: jest.fn().mockImplementation(originalModule.processLeadCapture)
  };
});

describe('leadcapture main flow with real services', () => {
  let testLeadId;

  beforeAll(() => {
    if (!process.env.SUPABASEURL || !process.env.SUPABASEKEY) {
      throw new Error('Supabase environment variables are not set');
    }
  });

  afterEach(async () => {
    if (testLeadId) {
      await supabase.from('Leads').delete().eq('id', testLeadId);
      testLeadId = null;
    }
  });

  it('should process clipboard content and upsert lead', async () => {
    const clipboardContent = `Magic show for John's birthday party on August 20th, 2023 from 2pm to 4pm at 123 Main St, Sydney. Contact: john@email.com, 0400123456`;
    clipboardy.readSync.mockReturnValue(clipboardContent);

    getChatGPTResponse.mockResolvedValue(JSON.stringify({
      customer_name: "John's birthday party",
      email_address: "john@email.com",
      phone_number: "0400123456",
      start_time: "2023-08-20T14:00:00",
      end_time: "2023-08-20T16:00:00",
      address: "123 Main St, Sydney NSW 2000"
    }));

    await processLeadCapture();

    // Check if a lead was created in Supabase
    const { data: leads, error } = await supabase
      .from('Leads')
      .select('*')
      .eq('customer_name', "John's birthday party");

    expect(error).toBeNull();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toHaveProperty('latitude');
    expect(leads[0]).toHaveProperty('longitude');
    
    testLeadId = leads[0].id;
  }, 30000);

  it('should handle errors gracefully', async () => {
    clipboardy.readSync.mockReturnValue('Invalid content');

    getChatGPTResponse.mockRejectedValue(new Error('API Error'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await processLeadCapture();

    expect(consoleSpy).toHaveBeenCalledWith('Error during processing:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});