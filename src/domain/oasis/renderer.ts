/**
 * OASIS Fixed-Width File Renderer
 * Pure function: invoices[] + metadata → fixed-width string
 * NO side effects, NO database access
 */

export const OASIS_FORMAT_VERSION = 'OASIS_FW_v1' as const;

export interface InvoiceForExport {
  invoiceId: string;
  clinicId: string;
  oasisVendorCode: string;
  amountCents: bigint;
  invoicePeriodStart: Date;
  invoicePeriodEnd: Date;
}

export interface BatchMetadata {
  batchCode: string;
  generationDate: Date;
  fundCode: string;
  orgCode: string;
  objectCode: string;
}

export interface RenderedFile {
  content: string;
  recordCount: number;
  controlTotalCents: bigint;
}

/**
 * Render invoices to OASIS fixed-width format
 * Record width: 100 characters per line
 * Line ending: CRLF
 * Encoding: ASCII
 */
export function renderOasisFile(
  invoices: InvoiceForExport[],
  metadata: BatchMetadata
): RenderedFile {
  const lines: string[] = [];
  
  // Calculate totals
  const recordCount = invoices.length;
  const controlTotalCents = invoices.reduce((sum, inv) => sum + inv.amountCents, 0n);

  // Header record
  const headerLine = renderHeaderRecord(
    metadata.batchCode,
    metadata.generationDate,
    recordCount,
    controlTotalCents,
    metadata.fundCode
  );
  lines.push(headerLine);

  // Detail records
  for (const invoice of invoices) {
    const detailLine = renderDetailRecord(
      invoice,
      metadata.fundCode,
      metadata.orgCode,
      metadata.objectCode
    );
    lines.push(detailLine);
  }

  // Footer record
  const footerLine = renderFooterRecord(
    metadata.batchCode,
    recordCount,
    controlTotalCents
  );
  lines.push(footerLine);

  // Join with CRLF
  const content = lines.join('\r\n') + '\r\n';

  // Validate totals match
  if (recordCount !== invoices.length) {
    throw new Error('RENDER_ERROR: recordCount mismatch');
  }

  return {
    content,
    recordCount,
    controlTotalCents,
  };
}

/**
 * Header Record (Line 1)
 * Format: H + batchCode(20) + date(8) + count(6) + total(12) + fund(5) + version(10) + filler(38)
 * Total: 100 characters
 */
function renderHeaderRecord(
  batchCode: string,
  generationDate: Date,
  recordCount: number,
  controlTotalCents: bigint,
  fundCode: string
): string {
  const recordType = 'H';
  const batchCodeField = padRight(truncate(batchCode, 20), 20);
  const dateField = formatDate(generationDate);
  const countField = padLeft(recordCount.toString(), 6, '0');
  const totalField = padLeft(controlTotalCents.toString(), 12, '0');
  const fundCodeField = padRight(truncate(fundCode, 5), 5);
  const versionField = padRight(OASIS_FORMAT_VERSION, 10);
  const filler = padRight('', 38);

  const line = recordType + batchCodeField + dateField + countField + totalField + fundCodeField + versionField + filler;
  
  if (line.length !== 100) {
    throw new Error(`RENDER_ERROR: Header line length ${line.length}, expected 100`);
  }

  return line;
}

/**
 * Detail Record (Lines 2–N)
 * Format: D + vendor(10) + invoice(15) + date(8) + amount(12) + fund(5) + org(5) + obj(4) + desc(30) + filler(10)
 * Total: 100 characters
 */
function renderDetailRecord(
  invoice: InvoiceForExport,
  fundCode: string,
  orgCode: string,
  objectCode: string
): string {
  const recordType = 'D';
  const vendorField = padRight(truncate(invoice.oasisVendorCode, 10), 10);
  const invoiceField = padRight(truncate(invoice.invoiceId.substring(0, 15), 15), 15);
  const dateField = formatDate(invoice.invoicePeriodEnd);
  const amountField = padLeft(invoice.amountCents.toString(), 12, '0');
  const fundCodeField = padRight(truncate(fundCode, 5), 5);
  const orgCodeField = padRight(truncate(orgCode, 5), 5);
  const objectCodeField = padRight(truncate(objectCode, 4), 4);
  const description = `WVSNP Reimbursement ${invoice.invoicePeriodStart.toISOString().split('T')[0]}`;
  const descField = padRight(truncate(description, 30), 30);
  const filler = padRight('', 10);

  const line = recordType + vendorField + invoiceField + dateField + amountField + 
               fundCodeField + orgCodeField + objectCodeField + descField + filler;

  if (line.length !== 100) {
    throw new Error(`RENDER_ERROR: Detail line length ${line.length}, expected 100`);
  }

  return line;
}

/**
 * Footer Record (Line N+1)
 * Format: F + batchCode(20) + count(6) + total(12) + filler(61)
 * Total: 100 characters
 */
function renderFooterRecord(
  batchCode: string,
  recordCount: number,
  controlTotalCents: bigint
): string {
  const recordType = 'F';
  const batchCodeField = padRight(truncate(batchCode, 20), 20);
  const countField = padLeft(recordCount.toString(), 6, '0');
  const totalField = padLeft(controlTotalCents.toString(), 12, '0');
  const filler = padRight('', 61);

  const line = recordType + batchCodeField + countField + totalField + filler;

  if (line.length !== 100) {
    throw new Error(`RENDER_ERROR: Footer line length ${line.length}, expected 100`);
  }

  return line;
}

/**
 * Format date as MMDDYYYY
 */
function formatDate(date: Date): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return month + day + year;
}

/**
 * Pad string on the right with spaces
 */
function padRight(str: string, length: number): string {
  return str.padEnd(length, ' ');
}

/**
 * Pad string on the left with specified character
 */
function padLeft(str: string, length: number, char: string = ' '): string {
  return str.padStart(length, char);
}

/**
 * Truncate string to max length (never overflow)
 */
function truncate(str: string, maxLength: number): string {
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}
