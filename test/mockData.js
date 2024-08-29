// test/mockData.js

const mockBooking1 = {
    customer_name: "Test Customer 1",
    email_address: "test1@example.com",
    phone_number: "0400000001",
    price: 500,
    address: "123 Test St, Sydney NSW 2000",
    start_time: new Date("2023-08-20T14:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-20T16:00:00+10:00").toISOString(),
    summary: "Test booking 1",
    latitude: -33.8688,
    longitude: 151.2093
  };
  
  const mockBooking2 = {
    customer_name: "Test Customer 2",
    email_address: "test2@example.com",
    phone_number: "0400000002",
    price: 600,
    address: "456 Test Ave, Newcastle NSW 2300",
    start_time: new Date("2023-08-21T10:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-21T12:00:00+10:00").toISOString(),
    summary: "Test booking 2",
    latitude: -32.9283,
    longitude: 151.7817
  };
  
  const mockLead1 = {
    customer_name: "Test Lead 1",
    email_address: "lead1@example.com",
    phone_number: "0400000003",
    price: 550,
    address: "789 Test Rd, Wollongong NSW 2500",
    start_time: new Date("2023-08-22T15:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-22T17:00:00+10:00").toISOString(),
    summary: "Test lead 1",
    latitude: -34.4248,
    longitude: 150.8931
  };
  
  const mockLead2 = {
    customer_name: "Test Lead 2",
    email_address: "lead2@example.com",
    phone_number: "0400000004",
    price: 700,
    address: "101 Test Pde, Coffs Harbour NSW 2450",
    start_time: new Date("2023-08-23T11:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-23T13:00:00+10:00").toISOString(),
    summary: "Test lead 2",
    latitude: -30.2962,
    longitude: 153.1187
  };
  
  // Overlapping booking
  const mockOverlappingBooking = {
    customer_name: "Overlap Customer",
    email_address: "overlap@example.com",
    phone_number: "0400000005",
    price: 550,
    address: "202 Overlap St, Sydney NSW 2000",
    start_time: new Date("2023-08-20T15:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-20T17:00:00+10:00").toISOString(),
    summary: "Overlapping booking",
    latitude: -33.8688,
    longitude: 151.2093
  };
  
  // Insufficient travel time booking
  const mockInsufficientTravelTimeBooking = {
    customer_name: "Travel Time Customer",
    email_address: "traveltime@example.com",
    phone_number: "0400000006",
    price: 600,
    address: "303 Far Away Rd, Wagga Wagga NSW 2650",
    start_time: new Date("2023-08-20T18:00:00+10:00").toISOString(),
    end_time: new Date("2023-08-20T20:00:00+10:00").toISOString(),
    summary: "Insufficient travel time booking",
    latitude: -35.1082,
    longitude: 147.3598
  };
  
  module.exports = {
    mockBooking1,
    mockBooking2,
    mockLead1,
    mockLead2,
    mockOverlappingBooking,
    mockInsufficientTravelTimeBooking
  };