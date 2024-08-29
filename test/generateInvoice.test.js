const { generateInvoice } = require('../magicworkstation');
const { mockBooking1 } = require('./mockData');
const fs = require('fs').promises;
const path = require('path');

describe('generateInvoice', () => {
  const testOutputDir = path.join(__dirname, 'test-invoices');

  beforeAll(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterAll(async () => {
    const files = await fs.readdir(testOutputDir);
    for (const file of files) {
      await fs.unlink(path.join(testOutputDir, file));
    }
    await fs.rmdir(testOutputDir);
  });

  it('should generate a PDF invoice', async () => {
    const pdfBuffer = await generateInvoice(mockBooking1);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    const filePath = path.join(testOutputDir, `invoice_${mockBooking1.id}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    const fileStats = await fs.stat(filePath);
    expect(fileStats.size).toBeGreaterThan(0);
  }, 120000); // Increased timeout to 120 seconds

  it('should handle missing booking information', async () => {
    const incompleteBooking = { ...mockBooking1, customer_name: undefined, price: undefined };
    const pdfBuffer = await generateInvoice(incompleteBooking);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    const filePath = path.join(testOutputDir, `invoice_incomplete_${incompleteBooking.id}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    const fileStats = await fs.stat(filePath);
    expect(fileStats.size).toBeGreaterThan(0);
  }, 120000); // Increased timeout to 120 seconds
});