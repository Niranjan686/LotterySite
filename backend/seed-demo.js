/**
 * Generates Ready-to-Upload Dummy Excel/CSV files in ../demo_data/
 * AND can be run any time (`npm run demo`) to generate/refresh demo files.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { buildDemoDataset } = require('./controllers/lottery/liveLotteryController');

const demoDir = path.resolve(__dirname, '../demo_data');
if (!fs.existsSync(demoDir)) {
  fs.mkdirSync(demoDir, { recursive: true });
}

function writeSpreadsheetPair(presetCount, label) {
  const { participants, flats } = buildDemoDataset(presetCount);

  const participantSheetRows = participants.map((p) => ({
    'Unique Participant ID': p.participantId,
    'Full Name': p.fullName,
    'Registration Number': p.registrationNumber,
    'Mobile Number': p.mobileNumber,
    'Wing or Building': p.wingPreference,
    Notes: p.notes
  }));

  const flatSheetRows = flats.map((f) => ({
    'Flat Number': f.flatNumber,
    Wing: f.wing,
    Floor: f.floor,
    Building: f.building,
    Notes: f.notes
  }));

  // 1. Participants XLSX & CSV
  const pWb = XLSX.utils.book_new();
  const pWs = XLSX.utils.json_to_sheet(participantSheetRows);
  pWs['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(pWb, pWs, 'Participants');
  XLSX.writeFile(pWb, path.join(demoDir, `RoyalPalms_Demo_${label}_Participants.xlsx`));
  fs.writeFileSync(
    path.join(demoDir, `RoyalPalms_Demo_${label}_Participants.csv`),
    '\uFEFF' + XLSX.utils.sheet_to_csv(pWs),
    'utf8'
  );

  // 2. Flats XLSX & CSV
  const fWb = XLSX.utils.book_new();
  const fWs = XLSX.utils.json_to_sheet(flatSheetRows);
  fWs['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(fWb, fWs, 'Flats');
  XLSX.writeFile(fWb, path.join(demoDir, `RoyalPalms_Demo_${label}_Flats.xlsx`));
  fs.writeFileSync(
    path.join(demoDir, `RoyalPalms_Demo_${label}_Flats.csv`),
    '\uFEFF' + XLSX.utils.sheet_to_csv(fWs),
    'utf8'
  );
}

writeSpreadsheetPair(25, '25');
writeSpreadsheetPair(520, '520');

console.log('Generated repeatable demo spreadsheets in:', demoDir);
