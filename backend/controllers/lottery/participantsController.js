const XLSX = require('xlsx');
const { connectMongo } = require('../../config/mongoDb');
const { Participant, LotteryEvent } = require('../../models');
const { recordAudit } = require('../../services/auditService');
const { cleanString } = require('../../middleware/validateMiddleware');

function normalizeParticipantId(val) {
  return cleanString(val, 60).replace(/\s+/g, '-').toUpperCase();
}

async function getActiveEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

function assertPreLotteryEditable(event, actionLabel = 'modify participants') {
  if (['LIVE', 'PAUSED', 'COMPLETED', 'FINALIZED'].includes(event.status)) {
    const err = new Error(
      `Cannot ${actionLabel} once the lottery event is ${event.status}.`
    );
    err.statusCode = 409;
    err.code = 'LOTTERY_LOCKED';
    throw err;
  }
}

/**
 * Validates raw participant rows against both in-batch and MongoDB existing Participant IDs.
 */
function validateParticipantRows(rawRows, existingIdSet) {
  const seenInBatch = new Set();
  const validated = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateDbCount = 0;

  rawRows.forEach((raw, idx) => {
    const rowNumber = parseInt(raw.rowNumber, 10) || idx + 2;
    const fullName = cleanString(
      raw.fullName ?? raw['Full Name'] ?? raw.Name ?? raw['Participant Name'] ?? '',
      160
    );
    const participantId = normalizeParticipantId(
      raw.participantId ?? raw['Participant ID'] ?? raw['Unique Participant ID'] ?? raw.ID ?? ''
    );
    const registrationNumber = cleanString(
      raw.registrationNumber ?? raw['Registration Number'] ?? raw['Reg No'] ?? '',
      80
    );
    const mobileNumber = cleanString(
      raw.mobileNumber ?? raw['Mobile Number'] ?? raw.Mobile ?? raw.Phone ?? '',
      30
    );
    const wingPreference = cleanString(
      raw.wingPreference ?? raw['Wing or Building'] ?? raw.Wing ?? raw.Building ?? '',
      60
    );
    const notes = cleanString(raw.notes ?? raw.Notes ?? raw.Remarks ?? '', 300);

    const errors = [];
    let isDbDuplicate = false;

    if (!fullName) {
      errors.push('Missing Full Name');
    }
    if (!participantId) {
      errors.push('Missing Unique Participant ID');
    } else {
      if (seenInBatch.has(participantId)) {
        errors.push(`Duplicate Participant ID "${participantId}" in file`);
      } else {
        seenInBatch.add(participantId);
      }

      if (existingIdSet.has(participantId)) {
        isDbDuplicate = true;
        duplicateDbCount += 1;
        errors.push(`Participant ID "${participantId}" already exists in MongoDB`);
      }
    }

    if (mobileNumber && !/^[+]?[0-9\s()-]{7,20}$/.test(mobileNumber)) {
      errors.push('Invalid Mobile Number');
    }

    const isValid = errors.length === 0;
    if (isValid) validCount += 1;
    else invalidCount += 1;

    validated.push({
      rowNumber,
      participantId,
      fullName,
      registrationNumber,
      mobileNumber,
      wingPreference,
      notes,
      isValid,
      isDbDuplicate,
      errors
    });
  });

  return {
    totalRows: rawRows.length,
    validCount,
    invalidCount,
    duplicateDbCount,
    rows: validated
  };
}

/**
 * GET /api/lottery/participants
 */
async function listParticipants(req, res, next) {
  try {
    const event = await getActiveEvent();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit =
      req.query.all === 'true'
        ? 25000
        : Math.min(1000, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const search = cleanString(req.query.search || '', 120);
    const status = cleanString(req.query.status || 'all', 30).toUpperCase();
    const wing = cleanString(req.query.wing || '', 60);

    const filter = { eventId: event._id };
    if (status === 'PENDING' || status === 'FIXED_MAPPED' || status === 'ALLOCATED') {
      filter.allocationStatus = status;
    } else if (status === 'INELIGIBLE') {
      filter.isEligible = false;
    }
    if (wing) {
      filter.wingPreference = new RegExp(`^${wing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { fullName: rx },
        { participantId: rx },
        { registrationNumber: rx },
        { mobileNumber: rx },
        { allocatedFlatNumber: rx }
      ];
    }

    const [
      totalRecords,
      participants,
      totalAll,
      pendingAll,
      fixedAll,
      allocatedAll,
      distinctWings
    ] = await Promise.all([
      Participant.countDocuments(filter),
      Participant.find(filter)
        .sort({ participantId: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Participant.countDocuments({ eventId: event._id }),
      Participant.countDocuments({ eventId: event._id, allocationStatus: 'PENDING', isEligible: true }),
      Participant.countDocuments({ eventId: event._id, allocationStatus: 'FIXED_MAPPED' }),
      Participant.countDocuments({ eventId: event._id, allocationStatus: 'ALLOCATED' }),
      Participant.distinct('wingPreference', { eventId: event._id, wingPreference: { $ne: '' } })
    ]);

    return res.json({
      success: true,
      participants,
      wings: distinctWings.sort(),
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit))
      },
      summary: {
        totalAll,
        pendingAll,
        fixedAll,
        allocatedAll
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/participants/existing-ids
 */
async function getExistingParticipantIds(_req, res, next) {
  try {
    const event = await getActiveEvent();
    const docs = await Participant.find({ eventId: event._id }, { participantId: 1 }).lean();
    return res.json({
      success: true,
      participantIds: docs.map((d) => d.participantId)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/participants/preview
 */
async function previewParticipantsUpload(req, res, next) {
  try {
    const event = await getActiveEvent();
    const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows submitted for preview.' });
    }
    if (rawRows.length > 15000) {
      return res.status(400).json({ success: false, message: 'Maximum 15,000 rows per upload.' });
    }

    const existingDocs = await Participant.find({ eventId: event._id }, { participantId: 1 }).lean();
    const existingSet = new Set(existingDocs.map((d) => d.participantId.toUpperCase()));
    const result = validateParticipantRows(rawRows, existingSet);

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/participants/bulk-import
 */
async function bulkImportParticipants(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'import participants');

    const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const skipDuplicates = Boolean(req.body.skipDuplicates);
    const importValidOnly = Boolean(req.body.importValidOnly);

    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No participant rows provided.' });
    }
    if (rawRows.length > 15000) {
      return res.status(400).json({ success: false, message: 'Maximum 15,000 rows per import.' });
    }

    const existingDocs = await Participant.find({ eventId: event._id }, { participantId: 1 }).lean();
    const existingSet = new Set(existingDocs.map((d) => d.participantId.toUpperCase()));
    const validation = validateParticipantRows(rawRows, existingSet);

    const blockingErrors = validation.rows.filter((r) => {
      if (r.isValid) return false;
      if (skipDuplicates && r.errors.length === 1 && r.isDbDuplicate) return false;
      return true;
    });

    if (blockingErrors.length > 0 && !importValidOnly) {
      return res.status(422).json({
        success: false,
        code: 'VALIDATION_ERRORS_FOUND',
        message: `${blockingErrors.length} row(s) contain missing names, duplicate IDs, or format errors. Fix them in the preview table or select "Import Valid Rows Only".`,
        ...validation
      });
    }

    const validToInsert = validation.rows.filter((r) => r.isValid);
    const skippedCount = validation.rows.length - validToInsert.length;

    if (validToInsert.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_VALID_PARTICIPANTS',
        message: 'No valid new participants to import (duplicates are never imported).',
        skippedCount
      });
    }

    const docsToInsert = validToInsert.map((r) => ({
      eventId: event._id,
      participantId: r.participantId,
      fullName: r.fullName,
      registrationNumber: r.registrationNumber,
      mobileNumber: r.mobileNumber,
      wingPreference: r.wingPreference,
      notes: r.notes,
      isEligible: true,
      allocationStatus: 'PENDING',
      createdBy: req.admin._id
    }));

    await Participant.insertMany(docsToInsert, { ordered: true });

    await recordAudit({
      eventId: event._id,
      action: 'PARTICIPANTS_BULK_IMPORTED',
      entityType: 'PARTICIPANT',
      actor: req.admin,
      req,
      summary: `Imported ${docsToInsert.length} participant(s) (${skippedCount} skipped/duplicate).`,
      metadata: {
        importedCount: docsToInsert.length,
        skippedCount
      }
    });

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${docsToInsert.length} participant(s)!`,
      importedCount: docsToInsert.length,
      skippedCount
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/participants
 */
async function createParticipant(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'add participants');

    const fullName = cleanString(req.body.fullName, 160);
    const participantId = normalizeParticipantId(req.body.participantId);
    const registrationNumber = cleanString(req.body.registrationNumber || '', 80);
    const mobileNumber = cleanString(req.body.mobileNumber || '', 30);
    const wingPreference = cleanString(req.body.wingPreference || '', 60);
    const notes = cleanString(req.body.notes || '', 300);

    if (!fullName || !participantId) {
      return res.status(400).json({
        success: false,
        message: 'Full Name and Unique Participant ID are required.'
      });
    }

    const dup = await Participant.findOne({ eventId: event._id, participantId });
    if (dup) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_PARTICIPANT_ID',
        message: `Participant ID "${participantId}" already exists (${dup.fullName}).`
      });
    }

    const created = await Participant.create({
      eventId: event._id,
      participantId,
      fullName,
      registrationNumber,
      mobileNumber,
      wingPreference,
      notes,
      isEligible: req.body.isEligible === undefined ? true : Boolean(req.body.isEligible),
      allocationStatus: 'PENDING',
      createdBy: req.admin._id
    });

    await recordAudit({
      eventId: event._id,
      action: 'PARTICIPANT_CREATED',
      entityType: 'PARTICIPANT',
      entityId: String(created._id),
      actor: req.admin,
      req,
      summary: `Added participant ${created.fullName} (${created.participantId}).`
    });

    return res.status(201).json({
      success: true,
      message: `Participant "${created.fullName}" (${created.participantId}) added.`,
      participant: created
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/lottery/participants/:id
 */
async function updateParticipant(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'edit participants');

    const existing = await Participant.findOne({ _id: req.params.id, eventId: event._id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Participant not found.' });
    }
    if (existing.allocationStatus === 'ALLOCATED') {
      return res.status(409).json({
        success: false,
        message: 'Cannot edit a participant who has already been allocated a flat.'
      });
    }

    const fullName = cleanString(req.body.fullName ?? existing.fullName, 160);
    const participantId = req.body.participantId
      ? normalizeParticipantId(req.body.participantId)
      : existing.participantId;

    if (!fullName || !participantId) {
      return res.status(400).json({
        success: false,
        message: 'Full Name and Unique Participant ID are required.'
      });
    }

    if (participantId !== existing.participantId) {
      const dup = await Participant.findOne({
        eventId: event._id,
        participantId,
        _id: { $ne: existing._id }
      });
      if (dup) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_PARTICIPANT_ID',
          message: `Participant ID "${participantId}" is already used by ${dup.fullName}.`
        });
      }
    }

    existing.fullName = fullName;
    existing.participantId = participantId;
    if (req.body.registrationNumber !== undefined) {
      existing.registrationNumber = cleanString(req.body.registrationNumber, 80);
    }
    if (req.body.mobileNumber !== undefined) {
      existing.mobileNumber = cleanString(req.body.mobileNumber, 30);
    }
    if (req.body.wingPreference !== undefined) {
      existing.wingPreference = cleanString(req.body.wingPreference, 60);
    }
    if (req.body.notes !== undefined) {
      existing.notes = cleanString(req.body.notes, 300);
    }
    if (req.body.isEligible !== undefined && existing.allocationStatus === 'PENDING') {
      existing.isEligible = Boolean(req.body.isEligible);
    }

    await existing.save();

    await recordAudit({
      eventId: event._id,
      action: 'PARTICIPANT_UPDATED',
      entityType: 'PARTICIPANT',
      entityId: String(existing._id),
      actor: req.admin,
      req,
      summary: `Updated participant ${existing.fullName} (${existing.participantId}).`
    });

    return res.json({
      success: true,
      message: `Participant "${existing.fullName}" updated.`,
      participant: existing
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/lottery/participants/:id
 */
async function deleteParticipant(req, res, next) {
  try {
    const event = await getActiveEvent();
    assertPreLotteryEditable(event, 'delete participants');

    const existing = await Participant.findOne({ _id: req.params.id, eventId: event._id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Participant not found.' });
    }
    if (existing.allocationStatus !== 'PENDING') {
      return res.status(409).json({
        success: false,
        message: `Cannot remove "${existing.fullName}" because their status is ${existing.allocationStatus}. Remove any fixed mapping first.`
      });
    }

    await Participant.deleteOne({ _id: existing._id });

    await recordAudit({
      eventId: event._id,
      action: 'PARTICIPANT_DELETED',
      entityType: 'PARTICIPANT',
      entityId: String(existing._id),
      actor: req.admin,
      req,
      summary: `Removed participant ${existing.fullName} (${existing.participantId}).`
    });

    return res.json({
      success: true,
      message: `Participant "${existing.fullName}" (${existing.participantId}) removed.`
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/participants/template?format=xlsx|csv&sample=0|500
 */
async function downloadParticipantsTemplate(req, res, next) {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const sampleCount = parseInt(req.query.sample, 10) || 0;

    const firstNames = [
      'Rahul', 'Amit', 'Neha', 'Priya', 'Vikram', 'Ananya', 'Rohan', 'Kavita', 'Siddharth', 'Pooja',
      'Rajesh', 'Meera', 'Arjun', 'Sneha', 'Karan', 'Divya', 'Nikhil', 'Swati', 'Aditya', 'ishita',
      'Manish', 'Deepika', 'Suresh', 'Sunita', 'Gaurav', 'Ritu', 'Vivek', 'Shruti', 'Harsh', 'Pallavi'
    ];
    const lastNames = [
      'Sharma', 'Patel', 'Shah', 'Deshmukh', 'Iyer', 'Kulkarni', 'Nair', 'Mehta', 'Verma', 'Joshi',
      'Gupta', 'Reddy', 'Chatterjee', 'Malhotra', 'Kapoor', 'Rao', 'Bhatia', 'Agarwal', 'chopra', 'Menon'
    ];
    const wings = ['Wing A', 'Wing B', 'Wing C', 'Wing D', 'Wing E'];

    let rows;
    if (sampleCount >= 10) {
      const total = Math.min(2000, sampleCount);
      rows = Array.from({ length: total }, (_, idx) => {
        const fn = firstNames[idx % firstNames.length];
        const ln = lastNames[Math.floor(idx / firstNames.length) % lastNames.length];
        const cleanFn = fn.charAt(0).toUpperCase() + fn.slice(1);
        const cleanLn = ln.charAt(0).toUpperCase() + ln.slice(1);
        return {
          'Unique Participant ID': `RP-P${String(idx + 1).padStart(4, '0')}`,
          'Full Name': `${cleanFn} ${cleanLn} ${idx >= 500 ? Math.floor(idx / 500) + 1 : ''}`.trim(),
          'Registration Number': `REG-2026-${String(1001 + idx)}`,
          'Mobile Number': `9820${String(100000 + idx).slice(0, 6)}`,
          'Wing or Building': wings[idx % wings.length],
          Notes: idx < 3 ? 'Senior member' : ''
        };
      });
    } else {
      rows = [
        {
          'Unique Participant ID': 'RP-P0001',
          'Full Name': 'Rahul Sharma',
          'Registration Number': 'REG-2026-1001',
          'Mobile Number': '9820010001',
          'Wing or Building': 'Wing A',
          Notes: ''
        },
        {
          'Unique Participant ID': 'RP-P0002',
          'Full Name': 'Amit Patel',
          'Registration Number': 'REG-2026-1002',
          'Mobile Number': '9820010002',
          'Wing or Building': 'Wing B',
          Notes: ''
        },
        {
          'Unique Participant ID': 'RP-P0003',
          'Full Name': 'Neha Shah',
          'Registration Number': 'REG-2026-1003',
          'Mobile Number': '9820010003',
          'Wing or Building': 'Wing C',
          Notes: ''
        }
      ];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 22 },
      { wch: 28 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Participants');

    const baseName = sampleCount >= 10 ? `RoyalPalms_${sampleCount}_Participants` : 'RoyalPalms_Participants_Template';
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
  listParticipants,
  getExistingParticipantIds,
  previewParticipantsUpload,
  bulkImportParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  downloadParticipantsTemplate
};
