jest.setTimeout(30000); // Increase timeout to 30 seconds

afterAll(async () => {
  await new Promise(resolve => setTimeout(() => resolve(), 500)); // wait for 500 ms before closing the server
});