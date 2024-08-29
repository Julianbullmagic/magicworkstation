// test/calculateTravelTime.test.js
const { calculateTravelTime } = require('../leadcapture');
const axios = require('axios');
const { mockBooking1, mockBooking2 } = require('./mockData');

jest.mock('axios');
jest.mock('node-clipboardy', () => ({
  readSync: jest.fn()
}));
describe('calculateTravelTime', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should calculate travel time between two locations', async () => {
    const mockResponse = {
      data: {
        durations: [[0, 28800]] // 8 hours in seconds
      }
    };
    await axios.get.mockResolvedValue(mockResponse);

    const origin = { latitude: mockBooking1.latitude, longitude: mockBooking1.longitude };
    const destination = { latitude: mockBooking2.latitude, longitude: mockBooking2.longitude };
    
    const travelTime = await calculateTravelTime(origin, destination);
    
    expect(travelTime).toBeCloseTo(8, 1);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(`${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`),
      expect.anything()
    );
  });

  it('should return null for invalid locations', async () => {
    await axios.get.mockRejectedValue(new Error('Invalid coordinates'));

    const origin = { latitude: 0, longitude: 0 };
    const destination = { latitude: mockBooking1.latitude, longitude: mockBooking1.longitude };
    
    const travelTime = await calculateTravelTime(origin, destination);
    
    expect(travelTime).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});