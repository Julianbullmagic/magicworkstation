// test/checkTimeOverlap.test.js

const { checkTimeOverlap } = require('../leadcapture');
const { mockBooking1, mockOverlappingBooking, mockBooking2 } = require('./mockData');

describe('checkTimeOverlap', () => {
  it('should return true for overlapping events', () => {
    expect(checkTimeOverlap(mockBooking1, mockOverlappingBooking)).toBe(true);
  });

  it('should return false for non-overlapping events', () => {
    expect(checkTimeOverlap(mockBooking1, mockBooking2)).toBe(false);
  });

  it('should return true when one event starts exactly when another ends', () => {
    const event1 = { ...mockBooking1, end_time: new Date("2023-08-20T18:00:00+10:00").toISOString() };
    const event2 = { ...mockBooking2, start_time: new Date("2023-08-20T18:00:00+10:00").toISOString() };
    expect(checkTimeOverlap(event1, event2)).toBe(true);
  });
});