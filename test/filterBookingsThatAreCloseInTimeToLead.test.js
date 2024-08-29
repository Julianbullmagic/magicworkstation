// test/filterBookingsThatAreCloseInTimeToLead.test.js

const { filterBookingsThatAreCloseInTimeToLead } = require('../leadcapture');
const { mockLead1, mockBooking1, mockBooking2 } = require('./mockData');

describe('filterBookingsThatAreCloseInTimeToLead', () => {
  it('should filter bookings that are close in time to the lead', () => {
    const closeBooking = {
      ...mockBooking1,
      start_time: new Date("2023-08-22T14:00:00+10:00").toISOString(),
      end_time: new Date("2023-08-22T16:00:00+10:00").toISOString(),
    };
    const farBooking = {
      ...mockBooking2,
      start_time: new Date("2023-08-23T14:00:00+10:00").toISOString(),
      end_time: new Date("2023-08-23T16:00:00+10:00").toISOString(),
    };
    const bookings = [closeBooking, farBooking];

    const filteredBookings = filterBookingsThatAreCloseInTimeToLead(mockLead1, bookings);

    expect(filteredBookings).toHaveLength(1);
    expect(filteredBookings[0]).toEqual(closeBooking);
  });

  it('should return an empty array if no bookings are close in time', () => {
    const farBooking1 = {
      ...mockBooking1,
      start_time: new Date("2023-08-25T14:00:00+10:00").toISOString(),
      end_time: new Date("2023-08-25T16:00:00+10:00").toISOString(),
    };
    const farBooking2 = {
      ...mockBooking2,
      start_time: new Date("2023-08-26T14:00:00+10:00").toISOString(),
      end_time: new Date("2023-08-26T16:00:00+10:00").toISOString(),
    };
    const bookings = [farBooking1, farBooking2];

    const filteredBookings = filterBookingsThatAreCloseInTimeToLead(mockLead1, bookings);

    expect(filteredBookings).toHaveLength(0);
  });
});