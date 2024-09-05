let puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
let { main } = require('../magicworkstation');

const supabaseUrl = process.env.SUPABASEURL;
const supabaseAnonKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

let server;
let browser;
let page;

function formatDate(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (isNaN(date.getTime())) {
      console.error('Invalid date:', date);
      return '';
    }
    const formatted = date.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
    console.log(`Formatting date: ${date} -> ${formatted}`);
    return formatted;
  }

function generateUniqueId() {
  return 'Test_' + Math.random().toString(36).substr(2, 9);
}

async function pause(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
  let oneyearfromnow = new Date(Date.now() + 31556952000);
  let oneyearfromnowplushalfhour = new Date(Date.now() + 31556952000 + 1800000);
  let oneyearfromnowplushour = new Date(Date.now() + 31556952000 + 1800000*2);
  let oneyearfromnowplushourandhalf = new Date(Date.now() + 31556952000 + 1800000*3);

//test events 1 and 2 don't overlap in time and there is enough travel time
//test events 1 and 3 don't overlap in time and there is enough travel time
//test events 1 and 4 don't overlap in time and there is enough travel time
//test events 2 and 3 do overlap in time and there is insufficient travel time
//test events 2 and 4 don't overlap in time and there is insufficient travel time
//test events 3 and 4 do overlap in time and there is insufficient travel time
//test event 5 should have a warning message saying it is outside of Sydney

 
const testdata = [
    {
      id: generateUniqueId(),
      event_name: 'test event 1',
      customer_name: 'test event customer 1',
      summary: 'Test summary',
      start_time: formatDate(oneyearfromnow),
      end_time: formatDate(new Date(oneyearfromnow.getTime() + 2700000)), // 45 minutes later
      email_address: 'john@example.com',
      phone_number: '1234567890',
      address: '486 Illawarra Road, Marrickville, Sydney, NSW',
      price: '500'
    },
    {
      id: generateUniqueId(),
      event_name: 'test event 2',
      customer_name: 'test event customer 2',
      summary: 'Test summary',
      start_time: formatDate(oneyearfromnowplushalfhour),
      end_time: formatDate(new Date(oneyearfromnowplushalfhour.getTime() + 3600000)), // 1 hour later
      email_address: 'john@example.com',
      phone_number: '1234567890',
      address: '200 Illawarra Road, Sydney, NSW',
      price: '500'
    },
    {
      id: generateUniqueId(),
      event_name: 'test event 3',
      customer_name: 'test event customer 3',
      summary: 'Test summary',
      start_time: formatDate(oneyearfromnowplushour),
      end_time: formatDate(new Date(oneyearfromnowplushour.getTime() + 3600000)), // 1 hour later
      email_address: 'john@example.com',
      phone_number: '1234567890',
      address: '106 Crystal St, Petersham, Sydney, NSW',
      price: '500'
    },
    {
      id: generateUniqueId(),
      event_name: 'test event 4',
      customer_name: 'test event customer 4',
      summary: 'Test summary',
      start_time: formatDate(oneyearfromnowplushourandhalf),
      end_time: formatDate(new Date(oneyearfromnowplushourandhalf.getTime() + 3600000)), // 1 hour later
      email_address: 'john@example.com',
      phone_number: '1234567890',
      address: '170 Marsden St, Parramatta, Sydney, NSW',
      price: '500'
    },
    {
      id: generateUniqueId(),
      event_name: 'test event 5',
      customer_name: 'test event customer 5',
      summary: 'Test summary',
      start_time: formatDate(new Date(oneyearfromnowplushourandhalf.getTime() + 100000)),
      end_time: formatDate(new Date(oneyearfromnowplushourandhalf.getTime() + 3700000)), // 1 hour later
      email_address: 'john@example.com',
      phone_number: '1234567890',
      address: '230 Crown St, Wollongong, NSW',
      price: '500'
    }
  ];
  
  async function checkConflictMessages(leadData, expectedOverlaps, expectedTravelTimeIssues) {
    console.log(`Checking conflicts for lead: ${JSON.stringify(leadData, null, 2)}`);
    
    await navigateToTab('Create');
    await fillForm('Lead', '', leadData);
    await submitForm('Lead');
  
    await navigateToTab('Leads');
    await pause(5000);
  
    const conflictMessages = await page.evaluate(() => {
      const conflictsDiv = document.querySelector('.conflicts');
      return conflictsDiv ? conflictsDiv.textContent : '';
    });
  
    console.log('Conflict messages:', conflictMessages);
  
    const { data: leadFromDB, error } = await supabase
      .from('Leads')
      .select('*')
      .eq('event_name', leadData.event_name)
      .single();
  
    if (error) {
      console.error('Error fetching lead from database:', error);
    } else {
      console.log('Lead from database:', JSON.stringify(leadFromDB, null, 2));
      console.log('Overlapping booking IDs:', leadFromDB.overlapping_booking_ids);
      console.log('Insufficient travel time booking IDs:', leadFromDB.insufficient_travel_time_booking_ids);
  
      const overlappingIds = leadFromDB.overlapping_booking_ids ? leadFromDB.overlapping_booking_ids.split(',') : [];
      const insufficientTravelTimeIds = leadFromDB.insufficient_travel_time_booking_ids ? leadFromDB.insufficient_travel_time_booking_ids.split(',').map(id => id.split(',')[0]) : [];
  
      console.log('Parsed overlapping IDs:', overlappingIds);
      console.log('Parsed insufficient travel time IDs:', insufficientTravelTimeIds);
  
      for (let overlap of expectedOverlaps) {
        const expectedEvent = testdata.find(b => b.event_name === `test event ${overlap}`);
        console.log(`Looking for test event ${overlap}:`, JSON.stringify(expectedEvent, null, 2));
        
        if (expectedEvent) {
          const bookingId = expectedEvent.id;
          console.log(`Expected booking ID for test event ${overlap}:`, bookingId);
          
          const isOverlapping = overlappingIds.includes(bookingId);
          console.log(`Is test event ${overlap} overlapping:`, isOverlapping);
          console.log(`All overlapping IDs:`, overlappingIds);
          
          expect(isOverlapping).toBeTruthy();
        } else {
          console.error(`Test event ${overlap} not found in testdata`);
          expect(false).toBeTruthy();
        }
      }
  
      for (let travelIssue of expectedTravelTimeIssues) {
        const expectedEvent = testdata.find(b => b.event_name === `test event ${travelIssue}`);
        console.log(`Looking for test event ${travelIssue}:`, JSON.stringify(expectedEvent, null, 2));
        
        if (expectedEvent) {
          const bookingId = expectedEvent.id;
          console.log(`Expected booking ID for test event ${travelIssue}:`, bookingId);
          
          const hasInsufficientTravelTime = insufficientTravelTimeIds.includes(bookingId);
          console.log(`Does test event ${travelIssue} have insufficient travel time:`, hasInsufficientTravelTime);
          
          expect(hasInsufficientTravelTime).toBeTruthy();
        } else {
          console.error(`Test event ${travelIssue} not found in testdata`);
          expect(false).toBeTruthy();
        }
      }
  
      if (expectedOverlaps.length > 0) {
        expect(conflictMessages).toContain(`Time Overlap Conflicts:`);
        for (let overlap of expectedOverlaps) {
          expect(conflictMessages).toContain(`test event ${overlap}`);
        }
      }
  
      if (expectedTravelTimeIssues.length > 0) {
        expect(conflictMessages).toContain(`Insufficient Travel Time:`);
        for (let travelIssue of expectedTravelTimeIssues) {
          expect(conflictMessages).toContain(`test event ${travelIssue}`);
        }
      }
    }
  }
  
  beforeAll(async () => {
    let result = await main(true);
    server = result.server;
    
    // Wait for the server to start listening
    await new Promise(resolve => setTimeout(resolve, 5000));
  
    browser = await puppeteer.launch({ headless: false }); // Set headless: false to see the browser
    page = await browser.newPage();
    
    // Navigate to the page and log any errors
    // page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    // page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    console.log('Page loaded');
  }, 60000);

afterAll(async () => {
    if (browser) {
        await browser.close();
      }
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
});

async function navigateToTab(tabName) {
  await page.waitForSelector('.tablinks');
  console.log(`div.tab button.${tabName}`)
  await page.click(`div.tab button.${tabName}`);
  await pause(3000)
}

async function fillForm(type, uniqueId, customData = {}) {
    let tomorrow = new Date(Date.now() + 86400000);
    let formatDate = (date) => {
      return date.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
    };
  
    let defaultData = {
      'event_name': `${type} ${uniqueId}`,
      'customer_name': `John Doe ${uniqueId}`,
      'summary': `Test summary ${uniqueId}`,
      'start_time': formatDate(tomorrow),
      'end_time': formatDate(new Date(tomorrow.getTime() + 7200000)), // 2 hours later
      'email_address': `john${uniqueId}@example.com`,
      'phone_number': '1234567890',
      'address': '123 Test St, Sydney, NSW',
      'price': '500'
    };
  
    let data = { ...defaultData, ...customData };
  
    for (let [name, value] of Object.entries(data)) {
        await pause(500)
        if(name.includes("time")){
            await page.evaluate((name, value) => {
                document.querySelector(`form[id="create-form"] input[name="${name}"]`).value = value;
            }, name, value); 
        }else{
            await page.type(`form[id="create-form"] input[name="${name}"]`,value).catch(err=>console.log(err))
        }
        console.log(name,value,"form input")   
    }
    await pause(5000)
    console.log('Form filled with data:', data);
  }

  async function submitForm(type) {
    console.log(`Submitting ${type} form`);
    for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
            window.confirm = () => true;
            window.alert = () => {};
          });
        await pause(3000); // Wait a bit for the next dialog or for the page to update
      }
      let [response] = await Promise.all([
        page.waitForResponse(res => res.url().includes(`/api/${type.toLowerCase()}s`) && res.request().method() === 'POST'),
        page.click(`button[name="submit-type"][value="${type.toLowerCase()}"]`)
      ]);
    
      let responseData = await response.json();
      console.log(`${type} form submitted successfully:`, responseData);
    
      // Wait for the page to settle after submission  
    console.log(`${type} form submitted successfully`);
    // Wait a bit to ensure the page has settled
    await pause(5000);
    
    return Array.isArray(responseData) ? responseData[0] : responseData;

    }

    async function checkItemExists(containerSelector, timeout = 5000) {
        try {
          await page.waitForSelector(containerSelector, { timeout: timeout });
          return page.evaluate((selector) => {
            const container = document.querySelector(selector);
            console.log(container, "checking if item exists");
            return !!container;
          }, containerSelector);
        } catch (error) {
          console.log(error)
        }
      }

async function updateItem(type, id, newData) {
  let formId = `form-${id}`;
  await page.waitForSelector(`#${formId}`);
  console.log("updating item",id,newData)
  for (let [name, value] of Object.entries(newData)) {
    await page.$eval(`#${formId} input[name="${name}"]`, (el, val) => el.value = val, value);
    await pause(3000); 
  }
  
  await page.click(`#${formId} button[type="submit"]`);
}





test('Test for overlaps and insufficient travel time', async () => {
    console.log('Starting overlap and travel time test');
  
    // Submit all test events as bookings
    for (let booking of testdata) {
      console.log(`Submitting booking: ${booking.event_name}`);
      await navigateToTab('Create');
      await fillForm('Booking', '', booking);
      await submitForm('Booking');
    }
    console.log('All test bookings submitted');
  
    async function checkConflictMessages(leadData, expectedOverlaps, expectedTravelTimeIssues) {
      console.log(`Checking conflicts for lead: ${leadData.event_name}`);
      
      await navigateToTab('Create');
      await fillForm('Lead', '', leadData);
      await submitForm('Lead');
  
      await navigateToTab('Leads');
      await pause(5000);
  
      const conflictMessages = await page.evaluate(() => {
        const conflictsDiv = document.querySelector('.conflicts');
        return conflictsDiv ? conflictsDiv.textContent : '';
      });
  
      console.log('Lead Data:', leadData);
      console.log('Conflict messages:', conflictMessages);
  
      const { data: leadFromDB, error } = await supabase
        .from('Leads')
        .select('*')
        .eq('event_name', leadData.event_name)
        .single();
  
      if (error) {
        console.error('Error fetching lead from database:', error);
      } else {
        console.log('Lead from database:', leadFromDB);
        console.log('Overlapping booking IDs:', leadFromDB.overlapping_booking_ids);
        console.log('Insufficient travel time booking IDs:', leadFromDB.insufficient_travel_time_booking_ids);
  
        const overlappingIds = leadFromDB.overlapping_booking_ids ? leadFromDB.overlapping_booking_ids.split(',') : [];
        const insufficientTravelTimeIds = leadFromDB.insufficient_travel_time_booking_ids ? leadFromDB.insufficient_travel_time_booking_ids.split(',').map(id => id.split(',')[0]) : [];
  
        console.log('Parsed overlapping IDs:', overlappingIds);
        console.log('Parsed insufficient travel time IDs:', insufficientTravelTimeIds);
  
        for (let overlap of expectedOverlaps) {
            const expectedEvent = testdata.find(b => b.event_name === `test event ${overlap}`);
            console.log(`Looking for test event ${overlap}:`, JSON.stringify(expectedEvent, null, 2));
            
            if (expectedEvent) {
              const bookingId = expectedEvent.id;
              console.log(`Expected booking ID for test event ${overlap}:`, bookingId);
              
              const isOverlapping = overlappingIds.includes(bookingId);
              console.log(`Is test event ${overlap} overlapping:`, isOverlapping);
              console.log(`All overlapping IDs:`, overlappingIds);
              
              expect(isOverlapping).toBeTruthy();
            } else {
              console.error(`Test event ${overlap} not found in testdata`);
              expect(false).toBeTruthy();
            }
          }
  
        for (let travelIssue of expectedTravelTimeIssues) {
          const expectedEvent = testdata.find(b => b.event_name === `test event ${travelIssue}`);
          console.log(`Looking for test event ${travelIssue}:`, expectedEvent);
          
          if (expectedEvent) {
            const bookingId = expectedEvent.id;
            console.log(`Expected booking ID for test event ${travelIssue}:`, bookingId);
            
            const hasInsufficientTravelTime = insufficientTravelTimeIds.includes(bookingId);
            console.log(`Does test event ${travelIssue} have insufficient travel time:`, hasInsufficientTravelTime);
            
            expect(hasInsufficientTravelTime).toBeTruthy();
          } else {
            console.error(`Test event ${travelIssue} not found in testdata`);
            expect(false).toBeTruthy();
          }
        }
  
        if (expectedOverlaps.length > 0) {
          expect(conflictMessages).toContain(`Time Overlap Conflicts:`);
          for (let overlap of expectedOverlaps) {
            expect(conflictMessages).toContain(`test event ${overlap}`);
          }
        }
  
        if (expectedTravelTimeIssues.length > 0) {
          expect(conflictMessages).toContain(`Insufficient Travel Time:`);
          for (let travelIssue of expectedTravelTimeIssues) {
            expect(conflictMessages).toContain(`test event ${travelIssue}`);
          }
        }
      }
    }
  
    // Test cases
    console.log('Running test cases');
  
    // Test lead 1: No conflicts
    console.log('Test case 1: No conflicts');
    await checkConflictMessages(testdata[0], [], []);
  
    // Test lead 2: Overlaps with test event 2, potential travel time issues with 3
    console.log('Test case 2: Overlap with event 2, potential travel time issues with 3');
    let lead2 = {...testdata[1]};
    lead2.start_time = formatDate(new Date(new Date(lead2.start_time).getTime() + 900000)); // 15 minutes later
    await checkConflictMessages(lead2, ['2'], ['3']);
  
    // Test lead 3: Overlaps with test event 3, potential travel time issues with 4
    console.log('Test case 3: Overlap with event 3, potential travel time issues with 4');
    let lead3 = {...testdata[2]};
    lead3.start_time = formatDate(new Date(new Date(lead3.start_time).getTime() + 1800000)); // 30 minutes later
    await checkConflictMessages(lead3, ['3'], ['4']);
  
    // Test lead 4: Potential travel time issues with test event 2
    console.log('Test case 4: Potential travel time issues with event 2');
    let lead4 = {...testdata[3]};
    lead4.start_time = formatDate(new Date(new Date(lead4.start_time).getTime() + 5400000)); // 1.5 hours later
    await checkConflictMessages(lead4, [], ['2']);
  
    // Test lead 5: No conflicts (different city)
    console.log('Test case 5: No conflicts (different city)');
    await checkConflictMessages(testdata[4], [], []);
  
    // Clean up: Delete all created bookings and leads
    console.log('Cleaning up: Deleting all created bookings and leads');
    
    await navigateToTab('Bookings');
    for (let booking of testdata) {
      console.log(`Attempting to delete booking: ${booking.event_name}`);
      try {
        await page.click(`#delete-${booking.id}`);
        await pause(1000);
        await page.evaluate(() => {
          window.confirm = () => true;
          window.alert = () => {};
        });
        await pause(3000);
        console.log(`Deleted booking: ${booking.event_name}`);
      } catch (error) {
        console.error(`Failed to delete booking ${booking.event_name}:`, error);
      }
    }
  
    await navigateToTab('Leads');
    for (let lead of testdata) {
      console.log(`Attempting to delete lead: ${lead.event_name}`);
      try {
        const leadElement = await page.$(`#form-${lead.event_name}`);
        if (leadElement) {
          await page.click(`#delete-${lead.event_name}`);
          await pause(1000);
          await page.evaluate(() => {
            window.confirm = () => true;
            window.alert = () => {};
          });
          await pause(3000);
          console.log(`Deleted lead: ${lead.event_name}`);
        } else {
          console.log(`Lead ${lead.event_name} not found, may have been already deleted or not created`);
        }
} catch (error) {
    console.error(`Failed to delete lead ${lead.event_name}:`, error);
  }
}

// Verify deletion in the database
console.log('Verifying deletion in the database');
for (let event of testdata) {
  const { data: bookingInDB, error: bookingError } = await supabase
    .from('Bookings')
    .select('id')
    .eq('id', event.id)
    .single();

  if (bookingError && bookingError.code === 'PGRST116') {
    console.log(`Confirmed: Booking ${event.event_name} deleted from database`);
  } else if (bookingInDB) {
    console.error(`Warning: Booking ${event.event_name} still exists in database`);
  }

  const { data: leadInDB, error: leadError } = await supabase
    .from('Leads')
    .select('id')
    .eq('event_name', event.event_name)
    .single();

  if (leadError && leadError.code === 'PGRST116') {
    console.log(`Confirmed: Lead ${event.event_name} deleted from database`);
  } else if (leadInDB) {
    console.error(`Warning: Lead ${event.event_name} still exists in database`);
  }
}

console.log('Cleanup process completed');
console.log('Overlap and travel time test completed');
}, 600000);

test('Comprehensive test of leads and bookings', async () => {
  let lead1Id = generateUniqueId();
  let lead2Id = generateUniqueId();
  let bookingId = generateUniqueId();

  console.log("entering first lead")
  await navigateToTab('Create');
  console.log("about to fill form",lead1Id)
  await pause(3000);
  await fillForm('Lead', lead1Id);
  console.log("form filled")
  await pause(3000);
  lead1Id=await submitForm('Lead', lead1Id);
  console.log(lead1Id)
  lead1Id=lead1Id.data
  lead1Id=lead1Id[0]
  lead1Id=lead1Id.id
  console.log(lead1Id,"lead1Id!!!!!")
  await pause(5000);
  console.log("finished entering first lead")


  console.log("entering first lead")
  await navigateToTab('Create');
  console.log("about to fill form",lead2Id)
  await pause(3000);
  await fillForm('Lead', lead2Id);
  console.log("form filled")
  await pause(3000);
  lead2Id=await submitForm('Lead', lead2Id);
  console.log(lead2Id)
  lead2Id=lead2Id.data
  lead2Id=lead2Id[0]
  lead2Id=lead2Id.id
  console.log(lead2Id,"lead2Id!!!!!")
  await pause(5000);
  console.log("finished entering second lead")

  await navigateToTab('Create');
  await fillForm('Booking', bookingId);
  console.log("form filled")
  await pause(3000);
  bookingId=await submitForm('Booking', bookingId);
  console.log(bookingId)
  bookingId=bookingId.id
  console.log(bookingId,"bookingId!!!!!")
  console.log(lead1Id,lead2Id,bookingId,"IDS!!!!")
  await pause(10000);

  // Convert one lead to a booking
  await navigateToTab('Leads');
  await pause(5000);
  let leadsContent = await page.evaluate(() => document.querySelector('#leads').innerHTML);
  console.log('Leads container content:', leadsContent);
  
  // Check if the button exists
  let buttonExists = await page.evaluate((id) => !!document.querySelector(`#ready-to-book-${id}`), lead1Id);
  console.log(`Button #ready-to-book-${lead1Id} exists:`, buttonExists);
  let [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes(`/api/bookings`) && res.request().method() === 'POST'),
    page.click(`#ready-to-book-${lead1Id}`)
  ]);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
        window.confirm = () => true;
        window.alert = () => {};
      });
    await pause(3000); // Wait a bit for the next dialog or for the page to update
  }
  let responseData = await response.json();
  console.log(`lead converted to booking successfully:`, responseData);
  responseData=responseData[0]
  let leadToBookingId=responseData.id
  console.log(leadToBookingId,"leadToBookingId")
    await pause(1000);

  // Update the remaining lead
  let newLeadData = {
    'customer_name': `Updated Lead ${lead2Id}`,
    'price': '600'
  };
  console.log("Trying to update lead 2")

  await updateItem('Lead', lead2Id, newLeadData);
  console.log("lead updated successfully")
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
        window.confirm = () => true;
        window.alert = () => {};
      });
    await pause(3000); // Wait a bit for the next dialog or for the page to update
  }
  // Refresh and check if lead was updated
  await page.reload();
  await navigateToTab('Leads');
  let leadExists = await checkItemExists(`form#form-${lead2Id}`, 10000);
  expect(leadExists).toBeTruthy();
  await page.on('dialog', async (dialog) => {
    console.log(`Dialog message: ${dialog.message()}`);
    await dialog.accept(); // This is equivalent to clicking "OK"
  });
  // Delete the remaining lead
  await page.click(`#delete-${lead2Id}`);
  await pause(3000); // Wait a bit for the next dialog or for the page to update
console.log("Trying to delete lead 2")
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
        window.confirm = () => true;
        window.alert = () => {};
      });
    await pause(3000); // Wait a bit for the next dialog or for the page to update
  }

  // Refresh and check if lead was deleted
  await page.reload();
  await navigateToTab('Leads');
  leadExists = await checkItemExists(`form#form-${lead2Id}`, 10000);
  expect(leadExists).toBeFalsy();


  // Update one of the bookings
  await navigateToTab('Bookings');
  let newBookingData = {
    'customer_name': `Updated Booking ${bookingId}`,
    'price': '700'
  };
  await updateItem('Booking', bookingId, newBookingData);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
        window.confirm = () => true;
        window.alert = () => {};
      });
    await pause(3000); // Wait a bit for the next dialog or for the page to update
  }
  // Refresh and check if booking was updated
  await page.reload();
  await navigateToTab('Bookings');
  let bookingExists = await checkItemExists(`form#form-${bookingId}`, 10000);
  expect(bookingExists).toBeTruthy();

  // Delete both bookings
  for (let id of [leadToBookingId, bookingId]) {
    await page.click(`#delete-${id}`);
    await pause(1000);
    for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
            window.confirm = () => true;
            window.alert = () => {};
          });
        await pause(3000); // Wait a bit for the next dialog or for the page to update
      }
  }

  // Refresh and check if bookings were deleted
  await page.reload();
  await navigateToTab('Bookings');
  for (let id of [leadToBookingId, bookingId]) {
    bookingExists = await checkItemExists('#events', `Booking ${id}`, 10000);
    expect(bookingExists).toBeFalsy();
  }
  await pause(60000);
}, 480000);