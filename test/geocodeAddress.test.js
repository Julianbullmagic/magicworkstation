// test/geocodeAddress.test.js

const { geocodeAddress } = require('../leadcapture');
const { mockBooking1, mockLead1 } = require('./mockData');
const axios = require('axios');

jest.mock('axios');

describe('geocodeAddress', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return latitude and longitude for a valid address', async () => {
    const mockResponse = {
      data: {
        features: [{
          center: [mockBooking1.longitude, mockBooking1.latitude],
          place_name: mockBooking1.address
        }]
      }
    };
    axios.get.mockResolvedValue(mockResponse);

    const result = await geocodeAddress(mockBooking1.address);
    expect(result).toHaveProperty('latitude');
    expect(result).toHaveProperty('longitude');
    expect(result.latitude).toBeCloseTo(mockBooking1.latitude, 1);
    expect(result.longitude).toBeCloseTo(mockBooking1.longitude, 1);
  });

  it('should return null for an invalid address', async () => {
    const mockResponse = {
      data: {
        features: []
      }
    };
    axios.get.mockResolvedValue(mockResponse);

    const result = await geocodeAddress('Invalid Address, Nowhere Land');
    expect(result).toBeNull();
  });

  it('should handle addresses in different parts of NSW', async () => {
    const mockResponse = {
      data: {
        features: [{
          center: [mockLead1.longitude, mockLead1.latitude],
          place_name: mockLead1.address
        }]
      }
    };
    axios.get.mockResolvedValue(mockResponse);

    const result = await geocodeAddress(mockLead1.address);
    expect(result).toHaveProperty('latitude');
    expect(result).toHaveProperty('longitude');
    expect(result.latitude).toBeCloseTo(mockLead1.latitude, 1);
    expect(result.longitude).toBeCloseTo(mockLead1.longitude, 1);
  });

  it('should handle API errors gracefully', async () => {
    axios.get.mockRejectedValue(new Error('API Error'));

    const result = await geocodeAddress('123 Error St, Sydney NSW 2000');
    expect(result).toBeNull();
  });
});