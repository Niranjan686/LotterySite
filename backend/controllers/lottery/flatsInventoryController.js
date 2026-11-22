const XLSX = require('xlsx');
const { connectMongo } = require('../../config/mongoDb');
const { Flat, LotteryEvent } = require('../../models');
const { recordAudit } = require('../../services/auditService');
const { cleanString, normalizeFlatNumber } = require('../../middleware/validateMiddleware');

async function getActiveEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

function assertPreLotteryEditable(event, label = 'modify flats') {
  if (['LIVE', 'PAUSED', 'COMPLETED', 'FINALIZED'].includes(event.status)) {
    const err = new Error(`Cannot ${label} once the lottery event is ${event.status}.`);
    err.statusCode = 409;
    err.code = 'LOTTERY_LOCKED';
    throw err;
  }
}

function inferFloorFromFlatNumber(flatNumber) {
  const digits = String(flatNumber || '').match(/(\d{3,4})$/);
  if (!digits) return '';
  const numStr = digits[1];
  return numStr.length === 3 ? numStr.slice(0, 1) : numStr.slice(0, 2);
}

/**
 * GET /api/lottery/flats
 */
async function listLotteryFlats(req, res, next) {
  try {
    const event = await getActiveEvent();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit =
      req.query.all === 'true'
        ? 25000
        : Math.min(1000, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const search = cleanString(req.query.search || '', 100);
    const status = cleanString(req.query.status || 'all', 30).toUpperCase();
    const wing = cleanString(req.query.wing || '', 60);
    const floor = cleanString(req.query.floor || '', 30);

    const filter = { eventId: event._id };
    if (['AVAILABLE', 'FIXED_MAPPED', 'ALLOCATED'].includes(status)) {
      filter.status = status;
    }
    if (wing) {
      filter.wing = new RegExp(`^${wing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (floor) {
      filter.floor = floor;
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { flatNumber: rx },
        { wing: rx },
        { building: rx },
        { allocatedParticipantName: rx },
        { allocatedParticipantId: rx }
      ];
    }

    const [
      totalRecords,
      flats,
      totalAll,
      availableAll,
      fixedAll,
      allocatedAll,
      distinctWings,
      distinctFloors
    ] = await Promise.all([
      Flat.countDocuments(filter),
      Flat.find(filter)
        .sort({ sequenceOrder: 1, wing: 1, flatNumber: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Flat.countDocuments({ eventId: event._id }),
      Flat.countDocuments({ eventId: event._id, status: 'AVAILABLE', isAvailableForLottery: true }),
      Flat.countDocuments({ eventId: event._id, status: 'FIXED_MAPPED' }),
      Flat.countDocuments({ eventId: event._id, status: 'ALLOCATED' }),
      Flat.distinct('wing', { eventId: event._id, wing: { $ne: '' } }),
      Flat.distinct('floor', { eventId: event._id, floor: { $ne: '' } })
    ]);

    return res.json({
      success: true,
      flats,
      wings: distinctWings.sort(),
      floors: distinctFloors.sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))),
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit))
      },
      summary: {
        totalAll,
        availableAll,
        fixedAll,
        allocatedAll
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/flats/existing-numbers
 */
async function getExistingFlatNumbers(_req, res, next) {
  try {
    const event = await getActiveEvent();
    const docs = await Flat.find({ eventId: event._id }, { flatNumber: 1 }).lean();
    return res.json({
      success: true,
      flatNumbers: docs.map((d) => d.flatNumber)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/flats/bulk-import
 * Supports importing from Excel/CSV rows OR from a sequence list of flat numbers.
 */
async function bulkImportLotteryFlats(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'import flats');

    let rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const skipDuplicates = Boolean(req.body.skipDuplicates);
    const importValidOnly = Boolean(req.body.importValidOnly);

    // Also support comma/newline-separated sequence text (e.g. "101, 102, 103, 201, 202")
    if (rawRows.length === 0 && typeof req.body.sequenceText === 'string') {
      const defaultWing = cleanString(req.body.wing || '', 60);
      const defaultBuilding = cleanString(req.body.building || '', 100);
      rawRows = req.body.sequenceText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((flatNumber, i) => ({
          rowNumber: i + 1,
          flatNumber,
          wing: defaultWing,
          building: defaultBuilding
        }));
    }

    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No flat numbers provided.' });
    }
    if (rawRows.length > 15000) {
      return res.status(400).json({ success: false, message: 'Maximum 15,000 flats per import.' });
    }

    const [existingDocs, currentCount] = await Promise.all([
      Flat.find({ eventId: event._id }, { flatNumber: 1 }).lean(),
      Flat.countDocuments({ eventId: event._id })
    ]);
    const existingSet = new Set(existingDocs.map((d) => d.flatNumber.toUpperCase()));
    const seenInBatch = new Set();

    const validated = rawRows.map((raw, idx) => {
      const rowNumber = parseInt(raw.rowNumber, 10) || idx + 2;
      const flatNumber = normalizeFlatNumber(
        raw.flatNumber ?? raw['Flat Number'] ?? raw['Flat No'] ?? raw.Flat ?? ''
      );
      const wing = cleanString(raw.wing ?? raw.Wing ?? '', 60);
      const floor =
        cleanString(raw.floor ?? raw.Floor ?? '', 30) || inferFloorFromFlatNumber(flatNumber);
      const building = cleanString(raw.building ?? raw.Building ?? raw.Tower ?? '', 100);
      const notes = cleanString(raw.notes ?? raw.Notes ?? '', 250);

      const errors = [];
      let isDbDuplicate = false;

      if (!flatNumber) {
        errors.push('Missing Flat Number');
      } else {
        if (seenInBatch.has(flatNumber)) {
          errors.push(`Duplicate Flat Number "${flatNumber}" in input`);
        } else {
          seenInBatch.add(flatNumber);
        }

        if (existingSet.has(flatNumber)) {
          isDbDuplicate = true;
          errors.push(`Flat Number "${flatNumber}" already exists in MongoDB`);
        }
      }

      return {
        rowNumber,
        flatNumber,
        wing,
        floor,
        building,
        notes,
        isDbDuplicate,
        isValid: errors.length === 0,
        errors
      };
    });

    const blockingErrors = validated.filter((r) => {
      if (r.isValid) return false;
      if (skipDuplicates && r.errors.length === 1 && r.isDbDuplicate) return false;
      return true;
    });

    if (blockingErrors.length > 0 && !importValidOnly) {
      return res.status(422).json({
        success: false,
        code: 'FLAT_VALIDATION_ERRORS',
        message: `${blockingErrors.length} flat record(s) have duplicate or missing flat numbers.`,
        totalRows: validated.length,
        validCount: validated.filter((r) => r.isValid).length,
        invalidCount: validated.filter((r) => !r.isValid).length,
        rows: validated
      });
    }

    const validRows = validated.filter((r) => r.isValid);
    const skippedCount = validated.length - validRows.length;

    if (validRows.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_VALID_FLATS',
        message: 'No new valid flats to import (duplicate flat numbers are never imported).',
        skippedCount
      });
    }

    const docs = validRows.map((r, i) => ({
      eventId: event._id,
      flatNumber: r.flatNumber,
      wing: r.wing,
      floor: r.floor,
      building: r.building,
      notes: r.notes,
      sequenceOrder: currentCount + i + 1,
      isAvailableForLottery: true,
      status: 'AVAILABLE',
      createdBy: req.admin._id
    }));

    await Flat.insertMany(docs, { ordered: true });

    await recordAudit({
      eventId: event._id,
      action: 'FLATS_BULK_IMPORTED',
      entityType: 'FLAT',
      actor: req.admin,
      req,
      summary: `Imported ${docs.length} flat(s) into inventory (${skippedCount} skipped/duplicate).`,
      metadata: { importedCount: docs.length, skippedCount }
    });

    return res.status(201).json({
      success: true,
      message: `Successfully added ${docs.length} flat(s) to inventory!`,
      importedCount: docs.length,
      skippedCount
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/flats
 */
async function createLotteryFlat(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'add flats');

    const flatNumber = normalizeFlatNumber(req.body.flatNumber);
    if (!flatNumber) {
      return res.status(400).json({ success: false, message: 'Flat Number is required.' });
    }

    const dup = await Flat.findOne({ eventId: event._id, flatNumber });
    if (dup) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_FLAT_NUMBER',
        message: `Flat "${flatNumber}" already exists in the flat inventory.`
      });
    }

    const count = await Flat.countDocuments({ eventId: event._id });
    const created = await Flat.create({
      eventId: event._id,
      flatNumber,
      wing: cleanString(req.body.wing || '', 60),
      floor: cleanString(req.body.floor || '', 30) || inferFloorFromFlatNumber(flatNumber),
      building: cleanString(req.body.building || '', 100),
      notes: cleanString(req.body.notes || '', 250),
      sequenceOrder: count + 1,
      isAvailableForLottery: true,
      status: 'AVAILABLE',
      createdBy: req.admin._id
    });

    await recordAudit({
      eventId: event._id,
      action: 'FLAT_CREATED',
      entityType: 'FLAT',
      entityId: String(created._id),
      actor: req.admin,
      req,
      summary: `Added Flat ${created.flatNumber} to inventory.`
    });

    return res.status(201).json({
      success: true,
      message: `Flat ${created.flatNumber} added.`,
      flat: created
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/lottery/flats/:id
 */
async function updateLotteryFlat(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'edit flats');

    const existing = await Flat.findOne({ _id: req.params.id, eventId: event._id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Flat not found.' });
    }
    if (existing.status === 'ALLOCATED') {
      return res.status(409).json({
        success: false,
        message: 'Cannot edit a flat that has already been allocated.'
      });
    }

    const flatNumber = req.body.flatNumber
      ? normalizeFlatNumber(req.body.flatNumber)
      : existing.flatNumber;

    if (flatNumber !== existing.flatNumber) {
      const dup = await Flat.findOne({
        eventId: event._id,
        flatNumber,
        _id: { $ne: existing._id }
      });
      if (dup) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_FLAT_NUMBER',
          message: `Flat "${flatNumber}" already exists.`
        });
      }
    }

    existing.flatNumber = flatNumber;
    if (req.body.wing !== undefined) existing.wing = cleanString(req.body.wing, 60);
    if (req.body.floor !== undefined) existing.floor = cleanString(req.body.floor, 30);
    if (req.body.building !== undefined) existing.building = cleanString(req.body.building, 100);
    if (req.body.notes !== undefined) existing.notes = cleanString(req.body.notes, 250);
    if (req.body.isAvailableForLottery !== undefined && existing.status === 'AVAILABLE') {
      existing.isAvailableForLottery = Boolean(req.body.isAvailableForLottery);
    }

    await existing.save();

    await recordAudit({
      eventId: event._id,
      action: 'FLAT_UPDATED',
      entityType: 'FLAT',
      entityId: String(existing._id),
      actor: req.admin,
      req,
      summary: `Updated Flat ${existing.flatNumber}.`
    });

    return res.json({
      success: true,
      message: `Flat ${existing.flatNumber} updated.`,
      flat: existing
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/lottery/flats/:id
 */
async function deleteLotteryFlat(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'delete flats');

    const existing = await Flat.findOne({ _id: req.params.id, eventId: event._id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Flat not found.' });
    }
    if (existing.status !== 'AVAILABLE') {
      return res.status(409).json({
        success: false,
        message: `Cannot delete Flat "${existing.flatNumber}" because its status is ${existing.status}.`
      });
    }

    await Flat.deleteOne({ _id: existing._id });

    await recordAudit({
      eventId: event._id,
      action: 'FLAT_DELETED',
      entityType: 'FLAT',
      entityId: String(existing._id),
      actor: req.admin,
      req,
      summary: `Removed Flat ${existing.flatNumber} from inventory.`
    });

    return res.json({
      success: true,
      message: `Flat ${existing.flatNumber} removed.`
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/flats/template?format=xlsx|csv&sample=0|500
 */
async function downloadFlatsTemplate(req, res, next) {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const sampleCount = parseInt(req.query.sample, 10) || 0;
    const wings = ['A', 'B', 'C', 'D', 'E'];

    let rows = [];
    if (sampleCount >= 10) {
      const total = Math.min(2000, sampleCount);
      let generated = 0;
      let floor = 1;
      while (generated < total) {
        for (const w of wings) {
          for (let unit = 1; unit <= 4 && generated < total; unit++) {
            const flatNo = `${w}-${floor}${String(unit).padStart(2, '0')}`;
            rows.push({
              'Flat Number': flatNo,
              Wing: `Wing ${w}`,
              Floor: String(floor),
              Building: `Royal Palms Tower ${w}`,
              Notes: ''
            });
            generated += 1;
          }
        }
        floor += 1;
      }
    } else {
      rows = [
        { 'Flat Number': '101', Wing: 'Wing A', Floor: '1', Building: 'Royal Palms Tower A', Notes: '' },
        { 'Flat Number': '102', Wing: 'Wing A', Floor: '1', Building: 'Royal Palms Tower A', Notes: '' },
        { 'Flat Number': '103', Wing: 'Wing A', Floor: '1', Building: 'Royal Palms Tower A', Notes: '' },
        { 'Flat Number': '201', Wing: 'Wing A', Floor: '2', Building: 'Royal Palms Tower A', Notes: '' },
        { 'Flat Number': '202', Wing: 'Wing A', Floor: '2', Building: 'Royal Palms Tower A', Notes: '' }
      ];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Flats');

    const baseName = sampleCount >= 10 ? `RoyalPalms_${sampleCount}_Flats` : 'RoyalPalms_Flats_Template';
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send('\uFEFF' + XLSX.utils.sheet_to_csv(ws));
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    return res.send(buf);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listLotteryFlats,
  getExistingFlatNumbers,
  bulkImportLotteryFlats,
  createLotteryFlat,
  updateLotteryFlat,
  deleteLotteryFlat,
  downloadFlatsTemplate
};
