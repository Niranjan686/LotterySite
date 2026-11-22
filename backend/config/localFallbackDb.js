const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { cleanString, normalizeFlatNumber } = require('../middleware/validateMiddleware');

const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'society_store.json');

const SPIN_SYMBOLS = [
  'STAR',
  'GIFT',
  'TROPHY',
  'CROWN',
  'DIAMOND',
  'CLOVER',
  'BELL',
  'MEDAL'
];

function createInitialSeedState() {
  const now = new Date().toISOString();
  const societyName = 'Royal Palms Co-operative Housing Society';

  return {
    nextIds: {
      society: 2,
      flat: 13,
      game: 1,
      winner: 1
    },
    societies: [
      {
        SocietyID: 1,
        SocietyName: societyName,
        SocietyAddress: 'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706',
        SocietyLogo: null,
        SocietyImage: null,
        TotalFlats: 500,
        CommitteeName: 'Society Cultural & Events Committee',
        ContactPhone: '+91 98200 12345',
        CreatedAt: now,
        UpdatedAt: now
      }
    ],
    settings: [
      {
        SettingID: 1,
        SocietyID: 1,
        NoRepeatWinner: true,
        SoundEnabled: true,
        ConfettiEnabled: true,
        SpinDurationMs: 3200,
        MatchRatePercent: 35,
        EventTitle: 'Royal Palms Lucky Draw',
        PrizeTitle: 'Official Society Play & Win Winner',
        UpdatedAt: now
      }
    ],
    flats: [
      { FlatID: 1, SocietyID: 1, SocietyName: societyName, FlatNumber: 'A-101', OwnerName: 'Aarav Sharma', MobileNumber: '9820110101', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 2, SocietyID: 1, SocietyName: societyName, FlatNumber: 'A-102', OwnerName: 'Priya Patel', MobileNumber: '9820110102', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 3, SocietyID: 1, SocietyName: societyName, FlatNumber: 'A-201', OwnerName: 'Vikram Deshmukh', MobileNumber: '9820110201', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 4, SocietyID: 1, SocietyName: societyName, FlatNumber: 'A-202', OwnerName: 'Ananya Iyer', MobileNumber: '9820110202', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 5, SocietyID: 1, SocietyName: societyName, FlatNumber: 'B-101', OwnerName: 'Rohan Kulkarni', MobileNumber: '9820210101', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 6, SocietyID: 1, SocietyName: societyName, FlatNumber: 'B-102', OwnerName: 'Meera Nair', MobileNumber: '9820210102', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 7, SocietyID: 1, SocietyName: societyName, FlatNumber: 'B-201', OwnerName: 'Rajesh Mehta', MobileNumber: '9820210201', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 8, SocietyID: 1, SocietyName: societyName, FlatNumber: 'B-202', OwnerName: 'Kavita Verma', MobileNumber: '9820210202', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 9, SocietyID: 1, SocietyName: societyName, FlatNumber: 'C-101', OwnerName: 'Siddharth Joshi', MobileNumber: '9820310101', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 10, SocietyID: 1, SocietyName: societyName, FlatNumber: 'C-102', OwnerName: 'Neha Gupta', MobileNumber: '9820310102', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 11, SocietyID: 1, SocietyName: societyName, FlatNumber: 'C-201', OwnerName: 'Arjun Reddy', MobileNumber: '9820310201', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now },
      { FlatID: 12, SocietyID: 1, SocietyName: societyName, FlatNumber: 'C-202', OwnerName: 'Pooja Chatterjee', MobileNumber: '9820310202', ParticipationStatus: true, CreatedAt: now, UpdatedAt: now }
    ],
    gameSessions: [],
    winners: []
  };
}

let memoryStore = null;

function loadStore() {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(DATA_FILE)) {
      memoryStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return memoryStore;
    }
  } catch (_) {}

  memoryStore = createInitialSeedState();
  saveStore();
  return memoryStore;
}

function saveStore() {
  if (!memoryStore) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(memoryStore, null, 2), 'utf8');
  } catch (_) {}
}

function hasFlatWon(store, flat) {
  return store.winners.some(
    (w) =>
      w.FlatID === flat.FlatID ||
      (w.SocietyID === flat.SocietyID &&
        String(w.FlatNumber).toUpperCase() === String(flat.FlatNumber).toUpperCase())
  );
}

function getPrimarySociety(store) {
  if (!store.societies.length) {
    const seeded = createInitialSeedState();
    store.societies = seeded.societies;
    store.settings = seeded.settings;
    saveStore();
  }
  return store.societies[0];
}

function getSettingsForSociety(store, societyId) {
  let gs = store.settings.find((s) => s.SocietyID === societyId);
  if (!gs) {
    gs = {
      SettingID: store.settings.length + 1,
      SocietyID: societyId,
      NoRepeatWinner: true,
      SoundEnabled: true,
      ConfettiEnabled: true,
      SpinDurationMs: 3200,
      MatchRatePercent: 35,
      EventTitle: 'Royal Palms Lucky Draw',
      PrizeTitle: 'Official Society Play & Win Winner',
      UpdatedAt: new Date().toISOString()
    };
    store.settings.push(gs);
    saveStore();
  }
  return gs;
}

function generateReelSymbols(matchRatePercent) {
  const rate = Math.min(100, Math.max(5, parseInt(matchRatePercent, 10) || 35));
  const roll = crypto.randomInt(0, 100);

  if (roll < rate) {
    const sym = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
    return { isWin: true, reels: [sym, sym, sym] };
  }

  const nearMatch = crypto.randomInt(0, 100) < 28;
  const r1 = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
  const r2 = nearMatch ? r1 : SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
  let r3 = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];

  if (r1 === r2 && r2 === r3) {
    r3 = SPIN_SYMBOLS[(SPIN_SYMBOLS.indexOf(r3) + 1) % SPIN_SYMBOLS.length];
  }

  return { isWin: false, reels: [r1, r2, r3] };
}

/* =========================================================================
   SOCIETY HANDLERS
   ========================================================================= */
function getSocietyProfile(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const reqId = parseInt(req.query.societyId, 10) || null;
  const active = (reqId && store.societies.find((s) => s.SocietyID === reqId)) || primary;
  const settings = getSettingsForSociety(store, active.SocietyID);

  return res.json({
    success: true,
    society: active,
    societies: store.societies,
    settings
  });
}

function createSociety(req, res) {
  const store = loadStore();
  const societyName = cleanString(req.body.societyName, 150);
  const societyAddress =
    cleanString(req.body.societyAddress, 500) || 'Main Residential Avenue, India';
  const committeeName =
    cleanString(req.body.committeeName, 150) || 'Society Cultural & Events Committee';
  const contactPhone = cleanString(req.body.contactPhone, 30) || null;
  const totalFlats = Math.max(1, Math.min(50000, parseInt(req.body.totalFlats, 10) || 500));

  const dup = store.societies.find(
    (s) => s.SocietyName.toLowerCase() === societyName.toLowerCase()
  );
  if (dup) {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_SOCIETY',
      message: `Society "${dup.SocietyName}" is already registered.`
    });
  }

  const now = new Date().toISOString();
  const newSoc = {
    SocietyID: store.nextIds.society++,
    SocietyName: societyName,
    SocietyAddress: societyAddress,
    SocietyLogo: null,
    SocietyImage: null,
    TotalFlats: totalFlats,
    CommitteeName: committeeName,
    ContactPhone: contactPhone,
    CreatedAt: now,
    UpdatedAt: now
  };
  store.societies.push(newSoc);
  getSettingsForSociety(store, newSoc.SocietyID);
  saveStore();

  return res.status(201).json({
    success: true,
    message: `Society "${societyName}" added successfully!`,
    society: newSoc
  });
}

function updateSocietyProfile(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const targetId = parseInt(req.body.societyId, 10) || primary.SocietyID;
  const current = store.societies.find((s) => s.SocietyID === targetId) || primary;

  const societyName = cleanString(req.body.societyName, 150);
  const societyAddress =
    cleanString(req.body.societyAddress, 500) || current.SocietyAddress;
  const committeeName =
    cleanString(req.body.committeeName, 150) || current.CommitteeName;
  const contactPhone = cleanString(req.body.contactPhone, 30) || null;
  const totalFlats = Math.max(1, Math.min(50000, parseInt(req.body.totalFlats, 10) || 500));

  if (req.body.societyLogo !== undefined) {
    current.SocietyLogo = req.body.societyLogo || null;
  }
  if (req.body.societyImage !== undefined) {
    current.SocietyImage = req.body.societyImage || null;
  }

  current.SocietyName = societyName;
  current.SocietyAddress = societyAddress;
  current.TotalFlats = totalFlats;
  current.CommitteeName = committeeName;
  current.ContactPhone = contactPhone;
  current.UpdatedAt = new Date().toISOString();

  store.flats.forEach((f) => {
    if (f.SocietyID === current.SocietyID) f.SocietyName = societyName;
  });
  store.winners.forEach((w) => {
    if (w.SocietyID === current.SocietyID) w.SocietyName = societyName;
  });

  saveStore();
  return res.json({
    success: true,
    message: 'Society profile updated successfully!',
    society: current
  });
}

function getDashboardSummary(_req, res) {
  const store = loadStore();
  const society = getPrimarySociety(store);
  const settings = getSettingsForSociety(store, society.SocietyID);
  const noRepeat = Boolean(settings.NoRepeatWinner);

  const uniqueOwners = new Set(
    store.flats.map((f) => f.OwnerName.trim().toUpperCase()).filter(Boolean)
  );
  const participatingFlats = store.flats.filter((f) => f.ParticipationStatus).length;
  const excludedFlats = store.flats.length - participatingFlats;
  const eligibleDrawPool = store.flats.filter(
    (f) => f.ParticipationStatus && (!noRepeat || !hasFlatWon(store, f))
  ).length;

  const recentWinners = [...store.winners]
    .sort((a, b) => b.WinnerID - a.WinnerID)
    .slice(0, 8);

  return res.json({
    success: true,
    society,
    settings,
    stats: {
      totalRegisteredFlats: store.flats.length,
      totalRegisteredOwners: uniqueOwners.size,
      participatingFlats,
      excludedFlats,
      eligibleDrawPool,
      totalSpins: store.gameSessions.length,
      winningSpins: store.gameSessions.filter((g) => g.IsWinningMatch).length,
      totalWinners: store.winners.length,
      totalSocieties: store.societies.length,
      noRepeatWinner: noRepeat,
      societyCapacity: society.TotalFlats
    },
    recentWinners
  });
}

/* =========================================================================
   FLAT HANDLERS
   ========================================================================= */
function resolveSocietyInStore(store, societyId, societyName) {
  const primary = getPrimarySociety(store);
  const cleanName = cleanString(societyName, 150);

  if (cleanName) {
    const found = store.societies.find(
      (s) => s.SocietyName.toLowerCase() === cleanName.toLowerCase()
    );
    if (found) return found;

    const now = new Date().toISOString();
    const created = {
      SocietyID: store.nextIds.society++,
      SocietyName: cleanName,
      SocietyAddress: primary.SocietyAddress,
      SocietyLogo: null,
      SocietyImage: null,
      TotalFlats: 500,
      CommitteeName: primary.CommitteeName,
      ContactPhone: null,
      CreatedAt: now,
      UpdatedAt: now
    };
    store.societies.push(created);
    getSettingsForSociety(store, created.SocietyID);
    return created;
  }

  if (societyId) {
    const byId = store.societies.find((s) => s.SocietyID === societyId);
    if (byId) return byId;
  }

  return primary;
}

function listFlats(req, res) {
  const store = loadStore();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit =
    req.query.all === 'true'
      ? 20000
      : Math.min(500, Math.max(5, parseInt(req.query.limit, 10) || 25));

  const ownerSearch = cleanString(req.query.ownerName || '', 150).toLowerCase();
  const flatSearch = cleanString(req.query.flatNumber || '', 50).toLowerCase();
  const generalSearch = cleanString(req.query.search || '', 150).toLowerCase();
  const statusFilter = cleanString(req.query.status || 'all', 20).toLowerCase();
  const societyId = parseInt(req.query.societyId, 10) || null;

  const filtered = store.flats
    .filter((f) => {
      if (societyId && f.SocietyID !== societyId) return false;
      if (ownerSearch && !f.OwnerName.toLowerCase().includes(ownerSearch)) return false;
      if (flatSearch && !f.FlatNumber.toLowerCase().includes(flatSearch)) return false;
      if (
        generalSearch &&
        !f.OwnerName.toLowerCase().includes(generalSearch) &&
        !f.FlatNumber.toLowerCase().includes(generalSearch) &&
        !f.SocietyName.toLowerCase().includes(generalSearch) &&
        !String(f.MobileNumber || '').toLowerCase().includes(generalSearch)
      ) {
        return false;
      }
      if ((statusFilter === 'active' || statusFilter === 'participating') && !f.ParticipationStatus) {
        return false;
      }
      if ((statusFilter === 'inactive' || statusFilter === 'excluded') && f.ParticipationStatus) {
        return false;
      }
      if (statusFilter === 'winners' && !hasFlatWon(store, f)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.FlatNumber.localeCompare(b.FlatNumber))
    .map((f) => ({
      ...f,
      HasWon: hasFlatWon(store, f) ? 1 : 0
    }));

  const uniqueOwners = new Set(
    store.flats.map((f) => f.OwnerName.trim().toUpperCase()).filter(Boolean)
  );
  const participatingAll = store.flats.filter((f) => f.ParticipationStatus).length;

  const offset = (page - 1) * limit;
  const paged = filtered.slice(offset, offset + limit);

  return res.json({
    success: true,
    flats: paged,
    pagination: {
      page,
      limit,
      totalRecords: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit))
    },
    summary: {
      totalAll: store.flats.length,
      totalOwners: uniqueOwners.size,
      participatingAll,
      excludedAll: store.flats.length - participatingAll
    }
  });
}

function getExistingFlatKeys(_req, res) {
  const store = loadStore();
  const society = getPrimarySociety(store);
  return res.json({
    success: true,
    defaultSocietyName: society.SocietyName,
    existing: store.flats.map((f) => ({
      SocietyID: f.SocietyID,
      SocietyName: f.SocietyName,
      FlatNumber: f.FlatNumber
    }))
  });
}

function createFlat(req, res) {
  const store = loadStore();
  const flatNumber = normalizeFlatNumber(req.body.flatNumber);
  const ownerName = cleanString(req.body.ownerName, 150);
  const mobileNumber = cleanString(req.body.mobileNumber, 25) || null;
  const participationStatus =
    req.body.participationStatus === undefined ? true : Boolean(req.body.participationStatus);

  if (mobileNumber && !/^[+]?[0-9\s()-]{7,20}$/.test(mobileNumber)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_MOBILE',
      message: 'Please enter a valid mobile number (7-20 digits).'
    });
  }

  const targetSoc = resolveSocietyInStore(
    store,
    parseInt(req.body.societyId, 10) || null,
    req.body.societyName
  );

  const dup = store.flats.find(
    (f) =>
      f.SocietyID === targetSoc.SocietyID &&
      f.FlatNumber.toUpperCase() === flatNumber.toUpperCase()
  );
  if (dup) {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_FLAT',
      message: `Flat Number "${flatNumber}" is already registered in ${targetSoc.SocietyName}.`
    });
  }

  const now = new Date().toISOString();
  const newFlat = {
    FlatID: store.nextIds.flat++,
    SocietyID: targetSoc.SocietyID,
    SocietyName: targetSoc.SocietyName,
    FlatNumber: flatNumber,
    OwnerName: ownerName,
    MobileNumber: mobileNumber,
    ParticipationStatus: participationStatus,
    CreatedAt: now,
    UpdatedAt: now
  };
  store.flats.push(newFlat);
  saveStore();

  return res.status(201).json({
    success: true,
    message: `Flat ${flatNumber} (${ownerName}) added successfully!`,
    flat: newFlat
  });
}

function updateFlat(req, res) {
  const store = loadStore();
  const flatId = parseInt(req.params.id, 10);
  const existing = store.flats.find((f) => f.FlatID === flatId);
  if (!existing) {
    return res.status(404).json({
      success: false,
      code: 'FLAT_NOT_FOUND',
      message: 'Flat record not found.'
    });
  }

  const flatNumber = normalizeFlatNumber(req.body.flatNumber);
  const ownerName = cleanString(req.body.ownerName, 150);
  const mobileNumber = cleanString(req.body.mobileNumber, 25) || null;
  const participationStatus = Boolean(req.body.participationStatus);

  const targetSoc = req.body.societyName
    ? resolveSocietyInStore(store, null, req.body.societyName)
    : store.societies.find((s) => s.SocietyID === existing.SocietyID) || getPrimarySociety(store);

  const dup = store.flats.find(
    (f) =>
      f.FlatID !== flatId &&
      f.SocietyID === targetSoc.SocietyID &&
      f.FlatNumber.toUpperCase() === flatNumber.toUpperCase()
  );
  if (dup) {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_FLAT',
      message: `Another flat with number "${flatNumber}" already exists in ${targetSoc.SocietyName}.`
    });
  }

  existing.SocietyID = targetSoc.SocietyID;
  existing.SocietyName = targetSoc.SocietyName;
  existing.FlatNumber = flatNumber;
  existing.OwnerName = ownerName;
  existing.MobileNumber = mobileNumber;
  existing.ParticipationStatus = participationStatus;
  existing.UpdatedAt = new Date().toISOString();
  saveStore();

  return res.json({
    success: true,
    message: `Flat ${flatNumber} updated successfully!`,
    flat: existing
  });
}

function toggleParticipation(req, res) {
  const store = loadStore();
  const flatId = parseInt(req.params.id, 10);
  const existing = store.flats.find((f) => f.FlatID === flatId);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Flat not found.' });
  }
  existing.ParticipationStatus = Boolean(req.body.participationStatus);
  existing.UpdatedAt = new Date().toISOString();
  saveStore();

  return res.json({
    success: true,
    message: `Participation status updated for Flat ${existing.FlatNumber}.`,
    flat: existing
  });
}

function deleteFlat(req, res) {
  const store = loadStore();
  const flatId = parseInt(req.params.id, 10);
  const idx = store.flats.findIndex((f) => f.FlatID === flatId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Flat not found.' });
  }

  store.winners.forEach((w) => {
    if (w.FlatID === flatId) w.FlatID = null;
  });

  const [removed] = store.flats.splice(idx, 1);
  saveStore();

  return res.json({
    success: true,
    message: `Flat ${removed.FlatNumber} deleted successfully.`
  });
}

function bulkImportFlats(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const skipDuplicates = Boolean(req.body.skipDuplicates);

  const existingSet = new Set(
    store.flats.map((f) => `${f.SocietyName.toLowerCase()}::${f.FlatNumber.toUpperCase()}`)
  );
  const seenInBatch = new Set();
  const rowErrors = [];
  const validRows = [];
  let skippedCount = 0;

  rawRows.forEach((row, idx) => {
    const rowNum = parseInt(row.rowNumber, 10) || idx + 2;
    const societyName = cleanString(row.societyName, 150) || primary.SocietyName;
    const flatNumber = normalizeFlatNumber(row.flatNumber);
    const ownerName = cleanString(row.ownerName, 150);
    const mobileNumber = cleanString(row.mobileNumber, 25) || null;

    let participationStatus = true;
    if (row.participationStatus !== undefined && row.participationStatus !== null && row.participationStatus !== '') {
      const s = String(row.participationStatus).trim().toLowerCase();
      participationStatus = !['false', '0', 'no', 'inactive', 'excluded', 'n'].includes(s);
    }

    const errs = [];
    if (!societyName) errs.push('Society Name is required');
    if (!flatNumber) errs.push('Flat No is required');
    if (!ownerName) errs.push('Owner Name is required');

    const key = `${societyName.toLowerCase()}::${flatNumber}`;
    if (societyName && flatNumber) {
      if (seenInBatch.has(key)) {
        errs.push(`Duplicate Flat No "${flatNumber}" within uploaded file`);
      } else {
        seenInBatch.add(key);
      }

      if (existingSet.has(key)) {
        if (skipDuplicates) {
          skippedCount += 1;
          return;
        }
        errs.push(`Flat No "${flatNumber}" already exists in database`);
      }
    }

    if (errs.length > 0) {
      rowErrors.push({ rowNumber: rowNum, societyName, flatNumber, ownerName, errors: errs });
    } else {
      validRows.push({ societyName, flatNumber, ownerName, mobileNumber, participationStatus });
    }
  });

  if (validRows.length === 0) {
    return res.status(400).json({
      success: false,
      code: 'NO_VALID_ROWS',
      message: skippedCount > 0 ? `All ${skippedCount} row(s) already exist.` : 'No valid rows available to import.',
      skippedCount,
      rowErrors
    });
  }

  const now = new Date().toISOString();
  validRows.forEach((r) => {
    const soc = resolveSocietyInStore(store, null, r.societyName);
    store.flats.push({
      FlatID: store.nextIds.flat++,
      SocietyID: soc.SocietyID,
      SocietyName: soc.SocietyName,
      FlatNumber: r.flatNumber,
      OwnerName: r.ownerName,
      MobileNumber: r.mobileNumber,
      ParticipationStatus: r.participationStatus,
      CreatedAt: now,
      UpdatedAt: now
    });
  });

  saveStore();

  return res.status(201).json({
    success: true,
    message: `Successfully imported ${validRows.length} flat(s)!`,
    importedCount: validRows.length,
    skippedCount,
    errorCount: rowErrors.length,
    rowErrors
  });
}

function exportFlats(req, res) {
  const store = loadStore();
  const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const rows = store.flats.map((r, index) => ({
    'Sr No': index + 1,
    'Society Name': r.SocietyName,
    'Flat No': r.FlatNumber,
    'Owner Name': r.OwnerName,
    'Mobile Number': r.MobileNumber || '',
    'Participation Status': r.ParticipationStatus ? 'Participating' : 'Excluded',
    'Created Date': r.CreatedAt ? new Date(r.CreatedAt).toISOString().split('T')[0] : ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Sr No': '', 'Society Name': '', 'Flat No': '', 'Owner Name': '' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Society Flats');

  const dateStamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Society_Flats_${dateStamp}.csv"`);
    return res.send('\uFEFF' + XLSX.utils.sheet_to_csv(ws));
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Society_Flats_${dateStamp}.xlsx"`);
  return res.send(buffer);
}

/* =========================================================================
   GAME & SPIN HANDLERS
   ========================================================================= */
function getGameState(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const filterSocietyId = parseInt(req.query.societyId, 10) || null;
  const settings = getSettingsForSociety(store, primary.SocietyID);
  const noRepeat = Boolean(settings.NoRepeatWinner);

  const participating = store.flats.filter(
    (f) => f.ParticipationStatus && (!filterSocietyId || f.SocietyID === filterSocietyId)
  );
  const eligible = participating.filter((f) => !noRepeat || !hasFlatWon(store, f));

  const recentWinners = [...store.winners]
    .sort((a, b) => b.WinnerID - a.WinnerID)
    .slice(0, 10);

  return res.json({
    success: true,
    society: primary,
    societies: store.societies.map((s) => ({
      SocietyID: s.SocietyID,
      SocietyName: s.SocietyName,
      SocietyLogo: s.SocietyLogo
    })),
    settings,
    counts: {
      eligibleFlatsCount: eligible.length,
      totalParticipatingCount: participating.length,
      totalRegisteredCount: store.flats.length,
      totalWinnersCount: store.winners.length,
      totalSpinsCount: store.gameSessions.length
    },
    recentWinners
  });
}

function updateGameSettings(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const settings = getSettingsForSociety(store, primary.SocietyID);

  settings.NoRepeatWinner = Boolean(req.body.noRepeatWinner);
  settings.SoundEnabled = req.body.soundEnabled === undefined ? true : Boolean(req.body.soundEnabled);
  settings.ConfettiEnabled = req.body.confettiEnabled === undefined ? true : Boolean(req.body.confettiEnabled);
  settings.SpinDurationMs = Math.min(10000, Math.max(1500, parseInt(req.body.spinDurationMs, 10) || 3200));
  settings.MatchRatePercent = Math.min(100, Math.max(5, parseInt(req.body.matchRatePercent, 10) || 35));
  settings.EventTitle = cleanString(req.body.eventTitle || 'Royal Palms Lucky Draw', 150);
  settings.PrizeTitle = cleanString(req.body.prizeTitle || 'Official Society Play & Win Winner', 150);
  settings.UpdatedAt = new Date().toISOString();

  saveStore();
  return res.json({
    success: true,
    message: 'Slot machine & draw rules saved successfully!',
    settings
  });
}

function spinSlotMachine(req, res) {
  const store = loadStore();
  const primary = getPrimarySociety(store);
  const filterSocietyId = parseInt(req.body.societyId, 10) || null;
  const settings = getSettingsForSociety(store, primary.SocietyID);
  const noRepeatWinner = Boolean(settings.NoRepeatWinner);

  const eligibleFlats = store.flats.filter(
    (f) =>
      f.ParticipationStatus &&
      (!filterSocietyId || f.SocietyID === filterSocietyId) &&
      (!noRepeatWinner || !hasFlatWon(store, f))
  );

  if (eligibleFlats.length === 0) {
    return res.status(409).json({
      success: false,
      code: 'NO_ELIGIBLE_FLATS',
      message: noRepeatWinner
        ? 'All participating flats have already won! Add more participating flats or disable "No-Repeat Winner" in Settings.'
        : 'No participating flats found! Please add or import society flats in Flat Management.'
    });
  }

  const outcome = generateReelSymbols(settings.MatchRatePercent);
  const [r1, r2, r3] = outcome.reels;
  const now = new Date().toISOString();
  const gameId = store.nextIds.game++;
  const sessionCode = `SPW-${String(gameId).padStart(6, '0')}`;

  if (!outcome.isWin) {
    const session = {
      GameID: gameId,
      SessionCode: sessionCode,
      SocietyID: filterSocietyId || primary.SocietyID,
      Reel1Symbol: r1,
      Reel2Symbol: r2,
      Reel3Symbol: r3,
      IsWinningMatch: false,
      PlayedAt: now
    };
    store.gameSessions.push(session);
    saveStore();

    return res.status(200).json({
      success: true,
      isWin: false,
      reels: [r1, r2, r3],
      session,
      winner: null,
      poolStats: {
        eligibleFlatsCount: eligibleFlats.length,
        remainingEligibleFlats: eligibleFlats.length,
        noRepeatWinner
      }
    });
  }

  // Cryptographically select an actual registered flat from eligibleFlats
  const winnerIndex = crypto.randomInt(0, eligibleFlats.length);
  const chosenFlat = eligibleFlats[winnerIndex];

  const session = {
    GameID: gameId,
    SessionCode: sessionCode,
    SocietyID: chosenFlat.SocietyID,
    Reel1Symbol: r1,
    Reel2Symbol: r2,
    Reel3Symbol: r3,
    IsWinningMatch: true,
    PlayedAt: now
  };
  store.gameSessions.push(session);

  const winnerId = store.nextIds.winner++;
  const winner = {
    WinnerID: winnerId,
    CertificateNo: `CERT-${String(winnerId).padStart(6, '0')}`,
    GameID: gameId,
    SessionCode: sessionCode,
    FlatID: chosenFlat.FlatID,
    SocietyID: chosenFlat.SocietyID,
    OwnerName: chosenFlat.OwnerName,
    FlatNumber: chosenFlat.FlatNumber,
    SocietyName: chosenFlat.SocietyName,
    MobileNumber: chosenFlat.MobileNumber || null,
    MatchedSymbol: r1,
    PrizeTitle: settings.PrizeTitle || 'Official Society Play & Win Winner',
    DrawDateTime: now
  };
  store.winners.push(winner);
  saveStore();

  return res.status(201).json({
    success: true,
    isWin: true,
    message: 'CONGRATULATIONS! OFFICIAL SOCIETY WINNER SELECTED!',
    reels: [r1, r2, r3],
    session,
    winner,
    poolStats: {
      previousPoolSize: eligibleFlats.length,
      remainingEligibleFlats: noRepeatWinner ? Math.max(0, eligibleFlats.length - 1) : eligibleFlats.length,
      noRepeatWinner
    }
  });
}

/* =========================================================================
   WINNER HANDLERS
   ========================================================================= */
function filterWinnerRecords(store, queryParams) {
  const search = cleanString(queryParams.search || '', 150).toLowerCase();
  const societyId = parseInt(queryParams.societyId, 10) || null;
  const symbol = cleanString(queryParams.symbol || '', 50).toUpperCase();
  const dateFrom = cleanString(queryParams.dateFrom || '', 30);
  const dateTo = cleanString(queryParams.dateTo || '', 30);

  return [...store.winners]
    .filter((w) => {
      if (societyId && w.SocietyID !== societyId) return false;
      if (symbol && w.MatchedSymbol !== symbol) return false;
      if (dateFrom && w.DrawDateTime.slice(0, 10) < dateFrom) return false;
      if (dateTo && w.DrawDateTime.slice(0, 10) > dateTo) return false;
      if (
        search &&
        !w.OwnerName.toLowerCase().includes(search) &&
        !w.FlatNumber.toLowerCase().includes(search) &&
        !w.SocietyName.toLowerCase().includes(search) &&
        !w.CertificateNo.toLowerCase().includes(search) &&
        !String(w.SessionCode || '').toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.WinnerID - a.WinnerID);
}

function listWinners(req, res) {
  const store = loadStore();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit =
    req.query.all === 'true'
      ? 10000
      : Math.min(500, Math.max(5, parseInt(req.query.limit, 10) || 20));

  const filtered = filterWinnerRecords(store, req.query).map((w) => {
    const soc = store.societies.find((s) => s.SocietyID === w.SocietyID);
    return {
      ...w,
      SocietyAddress: soc?.SocietyAddress || '',
      SocietyLogo: soc?.SocietyLogo || null
    };
  });

  const uniqueFlats = new Set(store.winners.map((w) => `${w.SocietyName}::${w.FlatNumber}`));
  const uniqueSoc = new Set(store.winners.map((w) => w.SocietyID));
  const latestDrawAt = store.winners.length
    ? store.winners[store.winners.length - 1].DrawDateTime
    : null;

  const offset = (page - 1) * limit;
  return res.json({
    success: true,
    winners: filtered.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      totalRecords: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit))
    },
    summary: {
      totalWinners: store.winners.length,
      uniqueWinningFlats: uniqueFlats.size,
      societiesWithWinners: uniqueSoc.size,
      latestDrawAt
    }
  });
}

function getWinnerById(req, res) {
  const store = loadStore();
  const winnerId = parseInt(req.params.id, 10);
  const found = store.winners.find((w) => w.WinnerID === winnerId);
  if (!found) {
    return res.status(404).json({
      success: false,
      code: 'WINNER_NOT_FOUND',
      message: 'Winner record not found.'
    });
  }
  const soc = store.societies.find((s) => s.SocietyID === found.SocietyID);
  return res.json({
    success: true,
    winner: {
      ...found,
      SocietyAddress: soc?.SocietyAddress || '',
      SocietyLogo: soc?.SocietyLogo || null,
      AuthorizedBy: soc?.CommitteeName || 'Society Cultural & Events Committee'
    }
  });
}

function exportWinners(req, res) {
  const store = loadStore();
  const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const filtered = filterWinnerRecords(store, req.query);

  const rows = filtered.map((w, idx) => {
    const dt = w.DrawDateTime ? new Date(w.DrawDateTime) : null;
    return {
      'Sr No': idx + 1,
      'Certificate No': w.CertificateNo,
      'Game ID': w.SessionCode,
      'Winner Name': w.OwnerName,
      'Flat Number': w.FlatNumber,
      'Society Name': w.SocietyName,
      'Mobile Number': w.MobileNumber || '',
      'Matched Symbol': w.MatchedSymbol,
      'Prize Title': w.PrizeTitle,
      'Draw Date': dt ? dt.toLocaleDateString('en-CA') : '',
      'Draw Time': dt ? dt.toLocaleTimeString('en-US', { hour12: true }) : ''
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Sr No': '', 'Certificate No': '', 'Winner Name': '', 'Flat Number': '' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Winner History');

  const dateStamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Society_Winners_${dateStamp}.csv"`);
    return res.send('\uFEFF' + XLSX.utils.sheet_to_csv(ws));
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Society_Winners_${dateStamp}.xlsx"`);
  return res.send(buffer);
}

function resetWinnerHistory(req, res) {
  if (String(req.body.confirmText || '').trim().toUpperCase() !== 'RESET') {
    return res.status(400).json({
      success: false,
      code: 'CONFIRMATION_REQUIRED',
      message: 'Type RESET to confirm clearing winner history.'
    });
  }
  const store = loadStore();
  store.winners = [];
  store.gameSessions = [];
  saveStore();

  return res.json({
    success: true,
    message: 'Winner history and spin sessions have been reset for a new society event.'
  });
}

module.exports = {
  getSocietyProfile,
  createSociety,
  updateSocietyProfile,
  getDashboardSummary,
  listFlats,
  getExistingFlatKeys,
  createFlat,
  updateFlat,
  toggleParticipation,
  deleteFlat,
  bulkImportFlats,
  exportFlats,
  getGameState,
  updateGameSettings,
  spinSlotMachine,
  listWinners,
  getWinnerById,
  exportWinners,
  resetWinnerHistory
};
