const puppeteer = require('puppeteer');
const { main } = require('../magicworkstation');

let server;
let browser;
let page;

function generateUniqueId() {
  return 'Test_' + Math.random().toString(36).substr(2, 9);
}

async function pause(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  beforeAll(async () => {
    const result = await main(true);
    server = result.server;
    
    // Wait for the server to start listening
    await new Promise(resolve => setTimeout(resolve, 5000));
  
    browser = await puppeteer.launch({ headless: false }); // Set headless: false to see the browser
    page = await browser.newPage();
    
    // Navigate to the page and log any errors
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    console.log('Page loaded');
    
    // Capture a screenshot for debugging
    await page.screenshot({ path: 'initial-load.png' });
    
    // Log the page content
    const content = await page.content();
    console.log('Page content:', content);
  
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
    const tomorrow = new Date(Date.now() + 86400000);
    const formatDate = (date) => {
      return date.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
    };
  
    const defaultData = {
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
  
    const data = { ...defaultData, ...customData };
  
    for (const [name, value] of Object.entries(data)) {
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
      const [response] = await Promise.all([
        page.waitForResponse(res => res.url().includes(`/api/${type.toLowerCase()}s`) && res.request().method() === 'POST'),
        page.click(`button[name="submit-type"][value="${type.toLowerCase()}"]`)
      ]);
    
      const responseData = await response.json();
      console.log(`${type} form submitted successfully:`, responseData);
    
      // Wait for the page to settle after submission  
    console.log(`${type} form submitted successfully`);
    // Wait a bit to ensure the page has settled
    await pause(5000);
    return responseData.data[0]; // Return the created item
  }

async function checkItemExists(containerSelector) {
  await page.waitForSelector(containerSelector);
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    console.log(container,"checking if item exists")
    return container
  }, containerSelector);
}

async function updateItem(type, id, newData) {
  const formId = `form-${id}`;
  await page.waitForSelector(`#${formId}`);
  
  for (const [name, value] of Object.entries(newData)) {
    await page.$eval(`#${formId} input[name="${name}"]`, (el, val) => el.value = val, value);
  }
  
  await page.click(`#${formId} button[type="submit"]`);
}

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
  lead2Id=lead2Id.id
  console.log(lead2Id,"lead2Id!!!!!")
  await pause(5000);
  console.log("finished entering second lead")

  await navigateToTab('Create');
  await fillForm('Booking', bookingId);
  console.log("form filled")
  await pause(3000);
  bookingId=await submitForm('Booking', bookingId);
  bookingId=bookingId.id
  console.log(bookingId,"bookingId!!!!!")
  console.log(lead1Id,lead2Id,bookingId,"IDS!!!!")
  await pause(10000);

  // Convert one lead to a booking
  await navigateToTab('Leads');
  await pause(5000);
  const leadsContent = await page.evaluate(() => document.querySelector('#leads').innerHTML);
  console.log('Leads container content:', leadsContent);
  
  // Check if the button exists
  const buttonExists = await page.evaluate((id) => !!document.querySelector(`#ready-to-book-${id}`), lead1Id);
  console.log(`Button #ready-to-book-${lead1Id} exists:`, buttonExists);
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes(`/api/bookings`) && res.request().method() === 'POST'),
    page.click(`#ready-to-book-${lead1Id}`)
  ]);

  const responseData = await response.json();
  console.log(`lead converted to booking successfully:`, responseData);
  let leadToBookingId=responseData.id
  console.log(leadToBookingId,"leadToBookingId")
    await pause(1000);

  // Update the remaining lead
  const newLeadData = {
    'customer_name': `Updated Lead ${lead2Id}`,
    'price': '600'
  };
  await updateItem('Lead', lead2Id, newLeadData);

  // Refresh and check if lead was updated
  await page.reload();
  await navigateToTab('Leads');
  let leadExists = await checkItemExists(`form#form-${lead2Id}`);
  expect(leadExists).toBeTruthy();

  // Delete the remaining lead
  await page.click(`#delete-${lead2Id}`);
  await pause(1000);

  // Refresh and check if lead was deleted
  await page.reload();
  await navigateToTab('Leads');
  leadExists = await checkItemExists(`form#form-${lead2Id}`);
  expect(leadExists).toBeFalsy();

  // Update one of the bookings
  await navigateToTab('Bookings');
  const newBookingData = {
    'customer_name': `Updated Booking ${bookingId}`,
    'price': '700'
  };
  await updateItem('Booking', bookingId, newBookingData);

  // Refresh and check if booking was updated
  await page.reload();
  await navigateToTab('Bookings');
  let bookingExists = await checkItemExists(`form#form-${lead2Id}`);
  expect(bookingExists).toBeTruthy();

  // Delete both bookings
  for (const id of [lead1Id, bookingId]) {
    await page.click(`#delete-${id}`);
    await pause(1000);
  }

  // Refresh and check if bookings were deleted
  await page.reload();
  await navigateToTab('Bookings');
  for (const id of [lead1Id, bookingId]) {
    bookingExists = await checkItemExists('#events', `Booking ${id}`);
    expect(bookingExists).toBeFalsy();
  }
  await page.click(`#delete-${leadToBookingId}`);
  await pause(10000);
}, 380000);