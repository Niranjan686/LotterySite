/**
 * Pure Node.js PDF 1.4 Document Generator
 * Produces authentic, multi-page vector PDF documents for:
 *  1) Luxury Individual Flat Allocation Tickets (with vector QR Code, Gold Filigree Border & Verification Hash)
 *  2) Official Society Allocation & Audit Reports (multi-page landscape tables with headers & page numbers)
 */

const { generateQrMatrix } = require('./qrGenerator');

function pdfEscape(text) {
  return String(text ?? '')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      if (ch === '•') return '-';
      if (ch === '—' || ch === '–') return '-';
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateText(str, maxChars) {
  const s = String(str ?? '').trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 2)) + '..';
}

/**
 * Compiles an array of page content-stream strings into a valid binary %PDF-1.4 Buffer.
 * Fonts registered on every page:
 *   /F1 = Helvetica
 *   /F2 = Helvetica-Bold
 *   /F3 = Times-Bold
 *   /F4 = Courier-Bold
 */
function buildPdfBuffer(pages, { width = 595.28, height = 841.89 } = {}) {
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length; // 1-based object ID
  };

  const catalogId = addObj(''); // 1
  const pagesId = addObj(''); // 2
  const fontF1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontF2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const fontF3 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  const fontF4 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds = [];

  for (const content of pages) {
    const streamBuf = Buffer.from(content, 'ascii');
    const contentId = addObj(
      `<< /Length ${streamBuf.length} >>\nstream\n${content}\nendstream`
    );
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontF1} 0 R /F2 ${fontF2} 0 R /F3 ${fontF3} 0 R /F4 ${fontF4} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks = [];
  let offset = 0;
  const push = (str) => {
    const b = Buffer.from(str, 'ascii');
    chunks.push(b);
    offset += b.length;
  };

  push('%PDF-1.4\n');
  const xrefOffsets = [0];

  for (let i = 0; i < objects.length; i++) {
    xrefOffsets.push(offset);
    push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }

  const xrefStart = offset;
  push(`xref\n0 ${objects.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    push(`${String(xrefOffsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return Buffer.concat(chunks);
}

function centeredTextCmd(font, size, pageWidth, y, text, rgb = '0.08 0.13 0.24') {
  const clean = String(text ?? '');
  const approxWidth = clean.length * size * 0.52;
  const x = Math.max(36, (pageWidth - approxWidth) / 2);
  return `${rgb} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(clean)}) Tj ET`;
}

function leftTextCmd(font, size, x, y, text, rgb = '0.08 0.13 0.24') {
  return `${rgb} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`;
}

/**
 * Generates a luxury single-page Official Winning Allocation Ticket PDF.
 */
function generateTicketPdfBuffer(allocation, event = {}) {
  const W = 595.28;
  const H = 841.89;
  const ops = [];

  const societyName = (allocation.societyName || event.societyName || 'ROYAL PALMS SOCIETY').toUpperCase();
  const societyAddress = event.societyAddress || 'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai';
  const allocDate = allocation.allocatedAt
    ? new Date(allocation.allocatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })
    : new Date().toLocaleString('en-IN');

  // Cream Luxury Ticket Sheet Background
  ops.push('0.992 0.984 0.965 rg 28 110 539.28 695 re f');

  // Deep Navy Header Banner
  ops.push('0.055 0.106 0.227 rg 36 690 523.28 107 re f');

  // Outer & Inner Champagne-Gold Double Border
  ops.push('0.784 0.624 0.286 RG 2.6 w 36 118 523.28 679 re S');
  ops.push('0.855 0.729 0.447 RG 0.9 w 43 125 509.28 665 re S');

  // Header Typography (Champagne Gold & Ivory on Deep Navy)
  ops.push(centeredTextCmd('F2', 11, W, 768, 'OFFICIAL FLAT ALLOCATION CERTIFICATE & TICKET', '0.906 0.780 0.482'));
  ops.push(centeredTextCmd('F3', 20, W, 740, truncateText(societyName, 44), '1 0.992 0.973'));
  ops.push(centeredTextCmd('F1', 9.5, W, 718, truncateText(societyAddress, 75), '0.84 0.87 0.93'));
  ops.push('0.784 0.624 0.286 RG 1.2 w 160 705 m 435 705 l S');

  // Congratulations Ribbon
  ops.push('0.984 0.957 0.890 rg 185 642 225 30 re f');
  ops.push('0.784 0.624 0.286 RG 1 w 185 642 225 30 re S');
  ops.push(centeredTextCmd('F2', 12.5, W, 652, 'CONGRATULATIONS!', '0.620 0.463 0.141'));

  // Participant Name
  ops.push(centeredTextCmd('F1', 10, W, 616, 'ALLOTTED RESIDENT / PARTICIPANT', '0.42 0.47 0.55'));
  ops.push(centeredTextCmd('F3', 25, W, 586, truncateText(String(allocation.participantName || '').toUpperCase(), 34), '0.078 0.129 0.239'));
  ops.push('0.784 0.624 0.286 RG 1.4 w 140 573 m 455 573 l S');

  ops.push(centeredTextCmd('F2', 11, W, 550, 'YOUR FLAT HAS BEEN OFFICIALLY ALLOCATED', '0.24 0.30 0.40'));

  // Centerpiece Flat Number Medallion Box
  ops.push('0.055 0.106 0.227 rg 185 432 225 98 re f');
  ops.push('0.855 0.729 0.447 RG 2 w 185 432 225 98 re S');
  ops.push(centeredTextCmd('F2', 10.5, W, 507, 'ALLOCATED FLAT NO.', '0.906 0.780 0.482'));
  ops.push(centeredTextCmd('F3', 36, W, 463, String(allocation.flatNumber || '-'), '1 0.992 0.973'));
  const unitMeta = [allocation.wing, allocation.floor ? `Floor ${allocation.floor}` : '', allocation.building]
    .filter(Boolean)
    .join('  |  ');
  if (unitMeta) {
    ops.push(centeredTextCmd('F1', 9.5, W, 442, truncateText(unitMeta, 42), '0.88 0.82 0.66'));
  }

  // Metadata Grid (Left) + Scannable Vector QR Code (Right)
  ops.push('0.968 0.953 0.922 rg 60 225 320 180 re f');
  ops.push('0.855 0.800 0.706 RG 0.8 w 60 225 320 180 re S');

  const metaRows = [
    ['Allocation ID', allocation.allocationId || '-'],
    ['Participant ID', allocation.participantId || '-'],
    ['Registration No', allocation.registrationNumber || 'N/A'],
    ['Allocation Type', `${allocation.allocationType || 'RANDOM'} ALLOCATION`],
    ['Status', 'SUCCESSFULLY ALLOCATED'],
    ['Date & Time', allocDate],
    ['Authorized By', allocation.initiatedByName || 'Lottery Committee']
  ];

  let rowY = 383;
  for (const [label, val] of metaRows) {
    ops.push(leftTextCmd('F2', 9.2, 74, rowY, `${label}:`, '0.38 0.43 0.52'));
    ops.push(leftTextCmd('F2', 9.8, 175, rowY, truncateText(val, 34), '0.078 0.129 0.239'));
    rowY -= 22;
  }

  // Draw Vector QR Code Box on Right (x=400..535, y=245..380)
  ops.push('1 1 1 rg 400 245 135 160 re f');
  ops.push('0.855 0.800 0.706 RG 0.8 w 400 245 135 160 re S');

  const qrPayload =
    allocation.verificationPayload ||
    `RP-VERIFY|${allocation.allocationId}|FLAT:${allocation.flatNumber}|PID:${allocation.participantId}`;
  const qr = generateQrMatrix(qrPayload);
  const qrBoxSize = 108;
  const cell = qrBoxSize / qr.size;
  const qrStartX = 400 + (135 - qrBoxSize) / 2;
  const qrTopY = 392;

  ops.push('0.055 0.106 0.227 rg');
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        const rx = qrStartX + c * cell;
        const ry = qrTopY - (r + 1) * cell;
        ops.push(`${rx.toFixed(2)} ${ry.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
      }
    }
  }
  ops.push(leftTextCmd('F2', 7.5, 422, 263, 'SCAN TO VERIFY TICKET', '0.38 0.43 0.52'));
  ops.push(
    leftTextCmd(
      'F4',
      7.2,
      412,
      252,
      `REF: ${String(allocation.verificationHash || '').slice(0, 14).toUpperCase()}`,
      '0.620 0.463 0.141'
    )
  );

  // Signatures & Verification Footer
  ops.push('0.078 0.129 0.239 RG 0.8 w 70 162 m 220 162 l S');
  ops.push('0.078 0.129 0.239 RG 0.8 w 375 162 m 525 162 l S');
  ops.push(leftTextCmd('F2', 8.8, 102, 148, 'Allottee Signature', '0.24 0.30 0.40'));
  ops.push(leftTextCmd('F2', 8.8, 392, 148, 'Authorized Society Seal & Sign', '0.24 0.30 0.40'));
  ops.push(
    centeredTextCmd(
      'F1',
      8,
      W,
      132,
      `Cryptographic Verification Digest: ${String(allocation.verificationHash || 'VERIFIED').slice(0, 32)}`,
      '0.45 0.50 0.58'
    )
  );

  return buildPdfBuffer([ops.join('\n')], { width: W, height: H });
}

/**
 * Generates a multi-page Landscape A4 Official Society Report PDF.
 */
function generateReportPdfBuffer({
  title = 'COMPLETE FLAT ALLOCATION REPORT',
  subtitle = '',
  event = {},
  summaryItems = [],
  columns = [],
  rows = []
}) {
  const W = 841.89; // Landscape A4
  const H = 595.28;
  const marginX = 32;
  const usableW = W - marginX * 2;
  const rowsPerPage = 19;

  const colCount = Math.max(1, columns.length);
  const colWidths = columns.map((c) => c.width || usableW / colCount);
  const totalDefinedW = colWidths.reduce((a, b) => a + b, 0);
  const normWidths = colWidths.map((w) => (w / totalDefinedW) * usableW);

  const chunks = [];
  if (rows.length === 0) {
    chunks.push([]);
  } else {
    for (let i = 0; i < rows.length; i += rowsPerPage) {
      chunks.push(rows.slice(i, i + rowsPerPage));
    }
  }

  const societyName = event.societyName || 'Royal Palms Co-operative Housing Society';
  const generatedStr = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const pageStreams = chunks.map((pageRows, pageIdx) => {
    const ops = [];

    // Header bar
    ops.push('0.055 0.106 0.227 rg 32 522 777.89 48 re f');
    ops.push('0.784 0.624 0.286 RG 1.5 w 32 522 777.89 48 re S');
    ops.push(leftTextCmd('F3', 14, 44, 549, truncateText(societyName.toUpperCase(), 62), '1 0.992 0.973'));
    ops.push(leftTextCmd('F2', 9.5, 44, 532, truncateText(title, 78), '0.906 0.780 0.482'));
    ops.push(
      leftTextCmd(
        'F1',
        8.5,
        615,
        549,
        `Generated: ${generatedStr}`,
        '0.86 0.89 0.95'
      )
    );
    ops.push(
      leftTextCmd(
        'F2',
        8.5,
        615,
        532,
        `Page ${pageIdx + 1} of ${chunks.length}  |  Records: ${rows.length}`,
        '0.906 0.780 0.482'
      )
    );

    let tableTopY = 508;

    // Summary pills on page 1
    if (pageIdx === 0 && (subtitle || summaryItems.length > 0)) {
      ops.push('0.976 0.961 0.929 rg 32 482 777.89 22 re f');
      ops.push('0.855 0.800 0.706 RG 0.6 w 32 482 777.89 22 re S');
      const summaryLine =
        summaryItems.length > 0
          ? summaryItems.map((s) => `${s.label}: ${s.value}`).join('   |   ')
          : subtitle;
      ops.push(leftTextCmd('F2', 8.5, 42, 490, truncateText(summaryLine, 128), '0.078 0.129 0.239'));
      tableTopY = 472;
    }

    // Table Header Row
    const headerH = 22;
    ops.push(`0.937 0.906 0.847 rg ${marginX} ${tableTopY - headerH} ${usableW.toFixed(2)} ${headerH} re f`);
    ops.push(`0.784 0.624 0.286 RG 0.8 w ${marginX} ${tableTopY - headerH} ${usableW.toFixed(2)} ${headerH} re S`);

    let curX = marginX;
    columns.forEach((col, cIdx) => {
      const label = typeof col === 'string' ? col : col.header;
      const maxChars = Math.max(4, Math.floor(normWidths[cIdx] / 4.8));
      ops.push(leftTextCmd('F2', 8.2, curX + 5, tableTopY - 14.5, truncateText(label, maxChars), '0.078 0.129 0.239'));
      curX += normWidths[cIdx];
    });

    // Data Rows
    const rowH = 20;
    let curY = tableTopY - headerH;

    if (pageRows.length === 0) {
      ops.push(centeredTextCmd('F1', 10, W, curY - 30, 'No matching records found for this report filter.', '0.42 0.47 0.55'));
    } else {
      pageRows.forEach((rowCells, rIdx) => {
        curY -= rowH;
        if (rIdx % 2 === 1) {
          ops.push(`0.988 0.980 0.965 rg ${marginX} ${curY} ${usableW.toFixed(2)} ${rowH} re f`);
        }
        ops.push(`0.88 0.85 0.79 RG 0.4 w ${marginX} ${curY} m ${marginX + usableW} ${curY} l S`);

        let cellX = marginX;
        columns.forEach((_col, cIdx) => {
          const val = Array.isArray(rowCells) ? rowCells[cIdx] : '';
          const maxChars = Math.max(4, Math.floor(normWidths[cIdx] / 4.6));
          ops.push(leftTextCmd('F1', 8.2, cellX + 5, curY + 6.2, truncateText(val, maxChars), '0.12 0.18 0.28'));
          cellX += normWidths[cIdx];
        });
      });
    }

    // Footer
    ops.push('0.82 0.77 0.68 RG 0.6 w 32 34 m 809.89 34 l S');
    ops.push(
      leftTextCmd(
        'F1',
        7.8,
        32,
        21,
        `${societyName} - Official MongoDB Verified Lottery Record`,
        '0.45 0.50 0.58'
      )
    );

    return ops.join('\n');
  });

  return buildPdfBuffer(pageStreams, { width: W, height: H });
}

module.exports = {
  generateTicketPdfBuffer,
  generateReportPdfBuffer
};
