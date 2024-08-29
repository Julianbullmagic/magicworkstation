const { upsertIntoSupabase, supabase } = require('../leadcapture');
const { v4: uuidv4 } = require('uuid');

const mockLead1 = {
  id: uuidv4(),
  customer_name: "Test Lead",
  start_time: new Date("2023-08-20T15:00:00+10:00").toISOString(),
  end_time: new Date("2023-08-20T17:00:00+10:00").toISOString(),
  address: "321 Test St, Testville NSW 2000",
};

describe('upsertIntoSupabase with real Supabase', () => {
  let testLeadId;

  afterEach(async () => {
    if (testLeadId) {
      await deleteTestLead(testLeadId);
      testLeadId = null;
    }
  });

  it('should insert a new lead into Supabase', async () => {
    const result = await upsertIntoSupabase(mockLead1);

    expect(result).toBeDefined();
    expect(result[0].customer_name).toBe(mockLead1.customer_name);
    expect(result[0].id).toBeDefined();
    testLeadId = result[0].id;
  });

  it('should update an existing lead in Supabase', async () => {
    const initialLead = await upsertIntoSupabase(mockLead1);
    testLeadId = initialLead[0].id;

    const updatedLead = { ...mockLead1, id: testLeadId, price: 600 };
    const result = await upsertIntoSupabase(updatedLead);

    expect(result).toBeDefined();
    expect(result[0].id).toBe(testLeadId);
    expect(result[0].customer_name).toBe(mockLead1.customer_name);
    expect(result[0].price).toBe(600);
  });

  it('should handle errors when upserting invalid data', async () => {
    const invalidLead = { customer_name: 'Test Customer' }; // Missing required fields

    await expect(upsertIntoSupabase(invalidLead)).rejects.toThrow();
  });
});

async function deleteTestLead(id) {
  const { error } = await supabase.from('Leads').delete().eq('id', id);
  if (error) {
    console.error('Error deleting test lead:', error);
  }
}