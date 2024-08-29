// test/isPeakTrafficTime.test.js

const { isPeakTrafficTime } = require('../leadcapture');

describe('isPeakTrafficTime', () => {
  it('should return true for morning peak hours', () => {
    const morningPeak = new Date('2023-08-20T08:30:00+10:00');
    expect(isPeakTrafficTime(morningPeak)).toBe(true);
  });

  it('should return true for evening peak hours', () => {
    const eveningPeak = new Date('2023-08-20T17:30:00+10:00');
    expect(isPeakTrafficTime(eveningPeak)).toBe(true);
  });

  it('should return false for off-peak hours', () => {
    const offPeak = new Date('2023-08-20T14:00:00+10:00');
    expect(isPeakTrafficTime(offPeak)).toBe(false);
  });

  it('should return false for very early morning', () => {
    const earlyMorning = new Date('2023-08-20T05:00:00+10:00');
    expect(isPeakTrafficTime(earlyMorning)).toBe(false);
  });

  it('should return false for late night', () => {
    const lateNight = new Date('2023-08-20T23:00:00+10:00');
    expect(isPeakTrafficTime(lateNight)).toBe(false);
  });
});