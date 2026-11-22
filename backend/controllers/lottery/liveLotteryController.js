const mongoose = require('mongoose');
const { connectMongo, runInMongoTransaction } = require('../../config/mongoDb');
const { LotteryEvent, Participant, Flat, FixedMapping, Allocation } = require('../../models');
const {
  computeEventPoolSummary,
  createFixedMapping,
  drawSingleRandomAllocation,
  runCompleteBatchAllocation,
  withEventLock
} = require('../../services/allocationEngine');
const {
  buildAllocationVerification,
  enrichAllocationForClient,
  recordAudit
} = require('../../services/auditService');
const { generateTicketPdfBuffer } = require('../../utils/pdfGenerator');
const { cleanString } = require('../../middleware/validateMiddleware');

async function getActiveEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

async function resolveAllocationByIdOrCode(idOrCode, eventId) {
  const raw = cleanString(idOrCode, 80);
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const byObj = await Allocation.findOne({ _id: raw, eventId });
    if (byObj) return byObj;
  }
  return Allocation.findOne({ eventId, allocationId: raw.toUpperCase() });
}

/**
 * GET /api/lottery/overview
 * Real-time MongoDB overview for Admin Dashboard, Homepage & Live Lottery Show Screen.
 */
async function getLotteryOverview(_req, res, next) {
  try {
    const event = await getActiveEvent();
    const [summary, recentDocs] = await Promise.all([
      computeEventPoolSummary(event._id),
      Allocation.find({ eventId: event._id })
        .sort({ sequenceNumber: -1, allocatedAt: -1 })
        .limit(15)
        .lean()
    ]);

    const recentAllocations = recentDocs.map(enrichAllocationForClient);

    return res.json({
      success: true,
      event,
      summary,
      latestAllocation: recentAllocations[0] || null,
      recentAllocations
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/verify/:allocationId
 * Public ticket verification lookup for QR scans and Allocation IDs.
 */
async function verifyTicketPublic(req, res, next) {
  try {
    const event = await getActiveEvent();
    const code = cleanString(req.params.allocationId || '', 60).toUpperCase();
    const alloc = await Allocation.findOne({ eventId: event._id, allocationId: code }).lean();

    if (!alloc) {
      return res.status(404).json({
        success: false,
        verified: false,
        code: 'TICKET_NOT_FOUND',
        message: `No official allocation record found for ID "${code}".`
      });
    }

    return res.json({
      success: true,
      verified: true,
      societyName: event.societyName,
      eventName: event.eventName,
      ticket: enrichAllocationForClient(alloc)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/precheck
 * Pre-lottery allocation summary & validation warnings required before starting.
 */
async function getPreLotterySummary(_req, res, next) {
  try {
    const event = await getActiveEvent();
    const summary = await computeEventPoolSummary(event._id);
    const warnings = [];
    const blockers = [];

    if (summary.remainingParticipants === 0 && summary.totalAllocated === 0) {
      blockers.push('No eligible participants uploaded yet. Upload participants first.');
    }
    if (summary.remainingFlats === 0 && summary.totalAllocated === 0) {
      blockers.push('No available flats uploaded yet. Add or upload flat numbers first.');
    }
    if (summary.mismatchWarning) {
      warnings.push(summary.mismatchWarning);
    }
    if (summary.ineligibleParticipants > 0) {
      warnings.push(`${summary.ineligibleParticipants} participant(s) are marked ineligible and excluded.`);
    }

    return res.json({
      success: true,
      event,
      summary,
      canStart: blockers.length === 0 && event.status !== 'FINALIZED',
      blockers,
      warnings
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/lottery/config
 * Updates Lottery Show parameters & Society Settings.
 */
async function updateLotteryConfig(req, res, next) {
  try {
    const event = await getActiveEvent();
    const b = req.body || {};

    if (b.eventName) event.eventName = cleanString(b.eventName, 160);
    if (b.societyName) event.societyName = cleanString(b.societyName, 160);
    if (b.societyAddress !== undefined) event.societyAddress = cleanString(b.societyAddress, 400);
    if (b.registrationNo !== undefined) event.registrationNo = cleanString(b.registrationNo, 80);
    if (b.committeeName !== undefined) event.committeeName = cleanString(b.committeeName, 160);
    if (b.contactPhone !== undefined) event.contactPhone = cleanString(b.contactPhone, 40);
    if (b.societyLogo !== undefined && String(b.societyLogo).length < 4_000_000) {
      event.societyLogo = b.societyLogo || 'assets/images/logo.svg';
    }

    if (b.countdownSeconds !== undefined) {
      event.config.countdownSeconds = Math.min(10, Math.max(1, parseInt(b.countdownSeconds, 10) || 3));
    }
    if (b.nameRevealDurationMs !== undefined) {
      event.config.nameRevealDurationMs = Math.min(
        12000,
        Math.max(800, parseInt(b.nameRevealDurationMs, 10) || 2800)
      );
    }
    if (b.flatRevealDurationMs !== undefined) {
      event.config.flatRevealDurationMs = Math.min(
        12000,
        Math.max(800, parseInt(b.flatRevealDurationMs, 10) || 2400)
      );
    }
    if (b.soundEnabled !== undefined) event.config.soundEnabled = Boolean(b.soundEnabled);
    if (b.confettiEnabled !== undefined) event.config.confettiEnabled = Boolean(b.confettiEnabled);
    if (b.musicVolume !== undefined) {
      event.config.musicVolume = Math.min(1, Math.max(0, Number(b.musicVolume)));
    }
    if (b.sfxVolume !== undefined) {
      event.config.sfxVolume = Math.min(1, Math.max(0, Number(b.sfxVolume)));
    }
    if (b.ticketPrefix !== undefined) {
      event.config.ticketPrefix =
        cleanString(b.ticketPrefix, 8).replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'RP';
    }

    await event.save();

    await recordAudit({
      eventId: event._id,
      action: 'LOTTERY_CONFIG_UPDATED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: `Updated lottery configuration & society settings for "${event.eventName}".`
    });

    return res.json({
      success: true,
      message: 'Lottery configuration & society settings saved.',
      event
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/start
 * Requires explicit admin confirmation (and count mismatch acknowledgment when applicable).
 */
async function startLotteryEvent(req, res, next) {
  try {
    const event = await getActiveEvent();
    if (event.status === 'FINALIZED') {
      return res.status(409).json({
        success: false,
        code: 'EVENT_FINALIZED',
        message: 'This lottery event has already been finalized and locked.'
      });
    }

    if (!req.body.confirmed) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Admin confirmation ("confirmed: true") is required before starting the lottery.'
      });
    }

    const summary = await computeEventPoolSummary(event._id);
    if (summary.remainingParticipants === 0 || summary.remainingFlats === 0) {
      if (summary.totalAllocated === 0) {
        return res.status(409).json({
          success: false,
          code: 'EMPTY_POOLS',
          message: 'Cannot start lottery without both eligible participants and available flats.'
        });
      }
    }

    if (summary.hasCountMismatch && !req.body.acknowledgeMismatch) {
      return res.status(409).json({
        success: false,
        code: 'COUNT_MISMATCH_WARNING',
        message: summary.mismatchWarning,
        summary
      });
    }

    event.status = 'LIVE';
    if (!event.startedAt) {
      event.startedAt = new Date();
      event.startedBy = req.admin._id;
    }
    await event.save();

    await recordAudit({
      eventId: event._id,
      action: 'LOTTERY_STARTED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: `Lottery event "${event.eventName}" started (Remaining Participants: ${summary.remainingParticipants}, Remaining Flats: ${summary.remainingFlats}, Fixed: ${summary.fixedAllocations}).`,
      metadata: summary
    });

    return res.json({
      success: true,
      message: 'Lottery event is now LIVE!',
      event,
      summary
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/pause
 */
async function pauseLotteryEvent(req, res, next) {
  try {
    const event = await getActiveEvent();
    if (event.status !== 'LIVE') {
      return res.status(409).json({
        success: false,
        message: `Cannot pause when event status is ${event.status}.`
      });
    }
    event.status = 'PAUSED';
    await event.save();

    await recordAudit({
      eventId: event._id,
      action: 'LOTTERY_PAUSED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: 'Paused live lottery presentation.'
    });

    return res.json({
      success: true,
      message: 'Live lottery presentation paused.',
      event
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/resume
 */
async function resumeLotteryEvent(req, res, next) {
  try {
    const event = await getActiveEvent();
    if (!['PAUSED', 'COMPLETED'].includes(event.status)) {
      return res.status(409).json({
        success: false,
        message: `Event is currently ${event.status}.`
      });
    }
    event.status = 'LIVE';
    await event.save();

    await recordAudit({
      eventId: event._id,
      action: 'LOTTERY_RESUMED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: 'Resumed live lottery presentation.'
    });

    return res.json({
      success: true,
      message: 'Live lottery presentation resumed.',
      event
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/end
 * Ends or permanently Finalizes & Locks the lottery event (requires confirmation).
 */
async function endOrFinalizeLotteryEvent(req, res, next) {
  try {
    if (!req.body.confirmed) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Admin confirmation is required before ending or finalizing the lottery.'
      });
    }

    const event = await getActiveEvent();
    const finalize = Boolean(req.body.finalize);
    const now = new Date();

    if (finalize) {
      event.status = 'FINALIZED';
      event.finalizedAt = now;
      event.finalizedBy = req.admin._id;
      if (!event.completedAt) event.completedAt = now;
    } else {
      event.status = 'COMPLETED';
      event.completedAt = now;
    }

    await event.save();
    const summary = await computeEventPoolSummary(event._id);

    await recordAudit({
      eventId: event._id,
      action: finalize ? 'LOTTERY_FINALIZED' : 'LOTTERY_ENDED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: finalize
        ? `Finalized and locked "${event.eventName}" with ${summary.totalAllocated} total allocations.`
        : `Ended live session for "${event.eventName}" (${summary.totalAllocated} allocated).`,
      metadata: summary
    });

    return res.json({
      success: true,
      message: finalize
        ? 'Lottery event has been permanently finalized and locked.'
        : 'Live lottery session ended.',
      event,
      summary
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/draw-one
 * Executes 1 server-side cryptographic random draw & saves permanently in MongoDB.
 */
async function drawOneAllocationHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    const idempotencyKey =
      req.headers['x-idempotency-key'] || req.body?.idempotencyKey || undefined;

    const result = await drawSingleRandomAllocation({
      eventId: event._id,
      actor: req.admin,
      req,
      idempotencyKey
    });

    return res.status(result.replayedIdempotent ? 200 : 201).json({
      success: true,
      message: `CONGRATULATIONS! ${result.allocation.participantName} has been allocated Flat ${result.allocation.flatNumber}!`,
      ...result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/draw-batch
 * Runs complete cryptographic allocation for all remaining eligible participants & flats.
 */
async function drawBatchAllocationsHandler(req, res, next) {
  try {
    if (!req.body.confirmed) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Admin confirmation ("confirmed: true") is required before running complete allocation.'
      });
    }

    const event = await getActiveEvent();
    const idempotencyKey =
      req.headers['x-idempotency-key'] || req.body?.idempotencyKey || undefined;

    const result = await runCompleteBatchAllocation({
      eventId: event._id,
      actor: req.admin,
      req,
      idempotencyKey
    });

    return res.status(201).json({
      success: true,
      message: `Complete allocation finished: ${result.allocatedCount} random allocation(s) permanently saved in MongoDB!`,
      ...result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/allocations
 * Paginated & filterable allocations list (used by Allocation History, Winners List, and Live Show Previous/Next).
 */
async function listAllocations(req, res, next) {
  try {
    const event = await getActiveEvent();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit =
      req.query.all === 'true'
        ? 25000
        : Math.min(1000, Math.max(5, parseInt(req.query.limit, 10) || 50));

    const search = cleanString(req.query.search || '', 120);
    const allocationType = cleanString(req.query.allocationType || '', 20).toUpperCase();
    const wing = cleanString(req.query.wing || '', 60);
    const floor = cleanString(req.query.floor || '', 30);
    const dateFrom = cleanString(req.query.dateFrom || '', 30);
    const dateTo = cleanString(req.query.dateTo || '', 30);

    const filter = { eventId: event._id };
    if (['FIXED', 'RANDOM'].includes(allocationType)) {
      filter.allocationType = allocationType;
    }
    if (wing) {
      filter.wing = new RegExp(`^${wing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (floor) {
      filter.floor = floor;
    }
    if (dateFrom || dateTo) {
      filter.allocatedAt = {};
      if (dateFrom) filter.allocatedAt.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) filter.allocatedAt.$lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { participantName: rx },
        { participantId: rx },
        { flatNumber: rx },
        { allocationId: rx },
        { registrationNumber: rx }
      ];
    }

    const sortDir = req.query.order === 'asc' ? 1 : -1;
    const [totalRecords, docs] = await Promise.all([
      Allocation.countDocuments(filter),
      Allocation.find(filter)
        .sort({ sequenceNumber: sortDir, allocatedAt: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    const includeQr = req.query.includeQr === 'true' || limit <= 100;
    const allocations = includeQr ? docs.map(enrichAllocationForClient) : docs;

    return res.json({
      success: true,
      allocations,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit))
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/allocations/:id/ticket
 */
async function getSingleTicket(req, res, next) {
  try {
    const event = await getActiveEvent();
    const alloc = await resolveAllocationByIdOrCode(req.params.id, event._id);
    if (!alloc) {
      return res.status(404).json({ success: false, message: 'Allocation ticket not found.' });
    }
    return res.json({
      success: true,
      event,
      ticket: enrichAllocationForClient(alloc)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/allocations/:id/ticket.pdf
 */
async function downloadSingleTicketPdf(req, res, next) {
  try {
    const event = await getActiveEvent();
    const alloc = await resolveAllocationByIdOrCode(req.params.id, event._id);
    if (!alloc) {
      return res.status(404).json({ success: false, message: 'Allocation ticket not found.' });
    }

    const pdfBuf = generateTicketPdfBuffer(alloc, event);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="RoyalPalms_Ticket_${alloc.allocationId}_Flat_${alloc.flatNumber}.pdf"`
    );
    return res.send(pdfBuf);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/allocations/:id/authorize-correction (SUPER_ADMIN only)
 * Confirmed allocations can NEVER be silently modified or deleted.
 * Any authorized emergency correction requires SUPER_ADMIN + auditReason and writes a permanent audit record.
 */
async function authorizeAllocationCorrection(req, res, next) {
  try {
    const event = await getActiveEvent();
    const auditReason = cleanString(req.body.auditReason || '', 300);
    const newFlatId = req.body.newFlatRef;

    if (!req.body.overrideAuthorization || auditReason.length < 10) {
      return res.status(400).json({
        success: false,
        code: 'AUDIT_REASON_REQUIRED',
        message: 'Authorized corrections require "overrideAuthorization: true" and a detailed "auditReason" (min 10 characters).'
      });
    }

    const updated = await withEventLock(event._id, () =>
      runInMongoTransaction(async (session) => {
        const qOpt = session ? { session } : {};
        const alloc = await resolveAllocationByIdOrCode(req.params.id, event._id);
        if (!alloc) {
          const err = new Error('Allocation record not found.');
          err.statusCode = 404;
          throw err;
        }

        const newFlat = await Flat.findOne({ _id: newFlatId, eventId: event._id }, null, qOpt);
        if (!newFlat || newFlat.status !== 'AVAILABLE') {
          const err = new Error('Target replacement flat must exist and currently be AVAILABLE.');
          err.statusCode = 409;
          throw err;
        }

        const previousFlatNumber = alloc.flatNumber;
        const previousFlatRef = alloc.flatRef;
        const now = new Date();

        // Release old flat & assign new flat
        await Flat.updateOne(
          { _id: previousFlatRef },
          {
            $set: {
              status: 'AVAILABLE',
              allocatedParticipantRef: null,
              allocatedParticipantId: null,
              allocatedParticipantName: null,
              allocationId: null,
              allocationType: null,
              allocatedAt: null
            }
          },
          qOpt
        );

        await Flat.updateOne(
          { _id: newFlat._id, status: 'AVAILABLE' },
          {
            $set: {
              status: alloc.allocationType === 'FIXED' ? 'FIXED_MAPPED' : 'ALLOCATED',
              allocatedParticipantRef: alloc.participantRef,
              allocatedParticipantId: alloc.participantId,
              allocatedParticipantName: alloc.participantName,
              allocationId: alloc.allocationId,
              allocationType: alloc.allocationType,
              allocatedAt: now
            }
          },
          qOpt
        );

        await Participant.updateOne(
          { _id: alloc.participantRef },
          {
            $set: {
              allocatedFlatRef: newFlat._id,
              allocatedFlatNumber: newFlat.flatNumber,
              allocatedAt: now
            }
          },
          qOpt
        );

        const verification = buildAllocationVerification({
          allocationId: alloc.allocationId,
          eventCode: event.eventCode,
          participantId: alloc.participantId,
          participantName: alloc.participantName,
          flatNumber: newFlat.flatNumber,
          allocationType: alloc.allocationType,
          allocatedAt: now
        });

        alloc.flatRef = newFlat._id;
        alloc.flatNumber = newFlat.flatNumber;
        alloc.wing = newFlat.wing || '';
        alloc.floor = newFlat.floor || '';
        alloc.building = newFlat.building || '';
        alloc.status = 'AMENDED_BY_ADMIN';
        alloc.verificationHash = verification.verificationHash;
        alloc.verificationPayload = verification.verificationPayload;
        await alloc.save(qOpt);

        if (alloc.allocationType === 'FIXED') {
          await FixedMapping.updateOne(
            { eventId: event._id, allocationRef: alloc._id },
            {
              $set: {
                flatRef: newFlat._id,
                flatNumber: newFlat.flatNumber,
                wing: newFlat.wing || '',
                floor: newFlat.floor || '',
                building: newFlat.building || '',
                updatedBy: req.admin._id
              }
            },
            qOpt
          );
        }

        await recordAudit(
          {
            eventId: event._id,
            action: 'AUTHORIZED_ALLOCATION_CORRECTION',
            entityType: 'ALLOCATION',
            entityId: alloc.allocationId,
            actor: req.admin,
            req,
            summary: `Authorized correction on ${alloc.allocationId} (${alloc.participantName}): Flat ${previousFlatNumber} -> Flat ${newFlat.flatNumber}. Reason: ${auditReason}`,
            metadata: {
              allocationId: alloc.allocationId,
              participantId: alloc.participantId,
              participantName: alloc.participantName,
              previousFlatNumber,
              newFlatNumber: newFlat.flatNumber,
              auditReason
            }
          },
          session
        );

        return enrichAllocationForClient(alloc);
      })
    );

    return res.json({
      success: true,
      message: `Authorized correction recorded in audit log for ${updated.allocationId}.`,
      allocation: updated
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Builds deterministic, realistic Royal Palms dummy participants, flats, and fixed mappings
 * so the demo can be re-loaded and repeated N times in one click.
 */
function buildDemoDataset(totalCount = 25) {
  const count = Math.min(1000, Math.max(5, parseInt(totalCount, 10) || 25));

  const namedResidents = [
    { fullName: 'Rahul Sharma', wing: 'Wing A', notes: 'Senior Citizen — Ground/1st Floor Fixed Allotment' },
    { fullName: 'Amit Patel', wing: 'Wing B', notes: 'Managing Committee Fixed Allotment' },
    { fullName: 'Neha Shah', wing: 'Wing C', notes: 'Corner Flat Pre-Approved Mapping' },
    { fullName: 'Priya Deshmukh', wing: 'Wing A', notes: '' },
    { fullName: 'Vikram Iyer', wing: 'Wing B', notes: '' },
    { fullName: 'Ananya Kulkarni', wing: 'Wing C', notes: '' },
    { fullName: 'Rohan Nair', wing: 'Wing D', notes: '' },
    { fullName: 'Kavita Mehta', wing: 'Wing A', notes: '' },
    { fullName: 'Siddharth Verma', wing: 'Wing B', notes: '' },
    { fullName: 'Pooja Joshi', wing: 'Wing C', notes: '' },
    { fullName: 'Rajesh Gupta', wing: 'Wing D', notes: '' },
    { fullName: 'Meera Reddy', wing: 'Wing A', notes: '' },
    { fullName: 'Arjun Chatterjee', wing: 'Wing B', notes: '' },
    { fullName: 'Sneha Malhotra', wing: 'Wing C', notes: '' },
    { fullName: 'Karan Kapoor', wing: 'Wing D', notes: '' },
    { fullName: 'Divya Rao', wing: 'Wing A', notes: '' },
    { fullName: 'Nikhil Bhatia', wing: 'Wing B', notes: '' },
    { fullName: 'Swati Agarwal', wing: 'Wing C', notes: '' },
    { fullName: 'Aditya Chopra', wing: 'Wing D', notes: '' },
    { fullName: 'Ishita Menon', wing: 'Wing A', notes: '' },
    { fullName: 'Manish Tiwari', wing: 'Wing B', notes: '' },
    { fullName: 'Deepika Saxena', wing: 'Wing C', notes: '' },
    { fullName: 'Suresh Gokhale', wing: 'Wing D', notes: '' },
    { fullName: 'Sunita Bansal', wing: 'Wing A', notes: '' },
    { fullName: 'Gaurav Singhal', wing: 'Wing B', notes: '' }
  ];

  const firstNames = [
    'Vivek', 'Shruti', 'Harsh', 'Pallavi', 'Aakash', 'Nandini', 'Pranav', 'Tanvi', 'Mayank', 'Richa',
    'Kunal', 'komal', 'Tarun', 'Bhavna', 'Varun', 'Shweta', 'Chirag', 'Rashmi', 'Tushar', 'Payal'
  ];
  const lastNames = [
    'Sharma', 'Patel', 'Desai', 'Kulkarni', 'Joshi', 'Mehta', 'Kapoor', 'Malhotra', 'Bhatt', 'Trivedi',
    'Parekh', 'Chauhan', 'Rathore', 'Thakur', 'Pandey', 'Mishra', 'Dubey', 'Shukla', 'Khatri', 'Soni'
  ];
  const wingLetters = ['A', 'B', 'C', 'D'];

  const participants = [];
  for (let i = 0; i < count; i++) {
    const preset = namedResidents[i];
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const cleanFn = fn.charAt(0).toUpperCase() + fn.slice(1);
    const fullName = preset
      ? preset.fullName
      : `${cleanFn} ${ln}${i >= 400 ? ' ' + (Math.floor(i / 400) + 1) : ''}`;
    const wingPref = preset ? preset.wing : `Wing ${wingLetters[i % wingLetters.length]}`;

    participants.push({
      participantId: `RP-P${String(i + 1).padStart(4, '0')}`,
      fullName,
      registrationNumber: `REG-2026-${String(1001 + i)}`,
      mobileNumber: `9820${String(100001 + i).slice(-6)}`,
      wingPreference: wingPref,
      notes: preset ? preset.notes : ''
    });
  }

  // First 3 flats are 101, 203, 305 (used for fixed mapping demonstration), followed by Wing-FloorUnit numbers
  const fixedStarterFlats = [
    { flatNumber: '101', wing: 'Wing A', floor: '1', building: 'Royal Palms Tower A', notes: 'Reserved Fixed Flat 101' },
    { flatNumber: '203', wing: 'Wing B', floor: '2', building: 'Royal Palms Tower B', notes: 'Reserved Fixed Flat 203' },
    { flatNumber: '305', wing: 'Wing C', floor: '3', building: 'Royal Palms Tower C', notes: 'Reserved Fixed Flat 305' }
  ];

  const flats = [];
  for (let i = 0; i < Math.min(count, fixedStarterFlats.length); i++) {
    flats.push({ ...fixedStarterFlats[i], sequenceOrder: i + 1 });
  }

  let floor = 1;
  let seq = flats.length + 1;
  while (flats.length < count) {
    for (const w of wingLetters) {
      for (let unit = 1; unit <= 4 && flats.length < count; unit++) {
        const flatNumber = `${w}-${floor}${String(unit).padStart(2, '0')}`;
        flats.push({
          flatNumber,
          wing: `Wing ${w}`,
          floor: String(floor),
          building: `Royal Palms Tower ${w}`,
          notes: '',
          sequenceOrder: seq++
        });
      }
    }
    floor += 1;
  }

  const fixedMappings = [
    {
      participantId: 'RP-P0001',
      flatNumber: '101',
      reason: 'Senior citizen 1st floor fixed allotment (Committee Resolution #01)'
    },
    {
      participantId: 'RP-P0002',
      flatNumber: '203',
      reason: 'Pre-approved fixed flat assignment (Committee Resolution #02)'
    },
    {
      participantId: 'RP-P0003',
      flatNumber: '305',
      reason: 'Corner unit fixed mapping (Committee Resolution #03)'
    }
  ];

  return { participants, flats, fixedMappings };
}

/**
 * POST /api/lottery/demo/load
 * Wipes & seeds a complete demo dataset (e.g. 25 or 520 participants + flats + 3 fixed mappings)
 * so the presenter can demonstrate the lottery N times in one click.
 */
async function loadDemoDatasetHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    const count = Math.min(1000, Math.max(5, parseInt(req.body?.count, 10) || 25));
    const includeFixed = req.body?.includeFixed !== false;
    const autoStartLive = Boolean(req.body?.autoStartLive);

    const dataset = buildDemoDataset(count);

    await withEventLock(event._id, async () => {
      await Promise.all([
        Allocation.deleteMany({ eventId: event._id }),
        FixedMapping.deleteMany({ eventId: event._id }),
        Participant.deleteMany({ eventId: event._id }),
        Flat.deleteMany({ eventId: event._id })
      ]);

      event.status = 'DRAFT';
      event.allocationSequenceCounter = 0;
      event.startedAt = null;
      event.completedAt = null;
      event.finalizedAt = null;
      await event.save();

      await Participant.insertMany(
        dataset.participants.map((p) => ({
          ...p,
          eventId: event._id,
          isEligible: true,
          allocationStatus: 'PENDING',
          createdBy: req.admin._id
        })),
        { ordered: true }
      );

      await Flat.insertMany(
        dataset.flats.map((f) => ({
          ...f,
          eventId: event._id,
          isAvailableForLottery: true,
          status: 'AVAILABLE',
          createdBy: req.admin._id
        })),
        { ordered: true }
      );
    });

    // Apply the 3 Fixed Flat Mappings if includeFixed is enabled
    if (includeFixed && count >= 5) {
      for (const fm of dataset.fixedMappings) {
        const [pDoc, fDoc] = await Promise.all([
          Participant.findOne({ eventId: event._id, participantId: fm.participantId }),
          Flat.findOne({ eventId: event._id, flatNumber: fm.flatNumber })
        ]);
        if (pDoc && fDoc) {
          await createFixedMapping({
            eventId: event._id,
            participantRef: pDoc._id,
            flatRef: fDoc._id,
            reason: fm.reason,
            actor: req.admin,
            req
          });
        }
      }
    }

    if (autoStartLive) {
      event.status = 'LIVE';
      event.startedAt = new Date();
      event.startedBy = req.admin._id;
      await event.save();
    }

    const summary = await computeEventPoolSummary(event._id);

    await recordAudit({
      eventId: event._id,
      action: 'DEMO_DATASET_LOADED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: `Loaded repeatable demo dataset: ${count} participants, ${count} flats, ${summary.fixedAllocations} fixed mappings (Status: ${event.status}).`,
      metadata: summary
    });

    return res.status(201).json({
      success: true,
      message: `Demo ready! Loaded ${count} participants, ${count} flats, and ${summary.fixedAllocations} fixed mappings (${summary.remainingParticipants} in random draw pool).`,
      event,
      summary
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/demo/reset-draws
 * Resets ONLY the random lottery draws while keeping all existing Participants, Flats & Fixed Mappings intact!
 * Allows re-running the Live Lucky Draw demonstration N times with the exact same uploaded data.
 */
async function resetDemoDrawsHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    const autoStartLive = Boolean(req.body?.autoStartLive);

    await withEventLock(event._id, async () => {
      // 1. Delete all RANDOM allocations (preserve FIXED allocations)
      await Allocation.deleteMany({ eventId: event._id, allocationType: 'RANDOM' });

      // 2. Return all RANDOM-allocated participants back to PENDING
      await Participant.updateMany(
        { eventId: event._id, allocationStatus: 'ALLOCATED' },
        {
          $set: {
            allocationStatus: 'PENDING',
            allocatedFlatRef: null,
            allocatedFlatNumber: null,
            allocationId: null,
            allocationType: null,
            allocatedAt: null
          }
        }
      );

      // 3. Return all RANDOM-allocated flats back to AVAILABLE
      await Flat.updateMany(
        { eventId: event._id, status: 'ALLOCATED' },
        {
          $set: {
            status: 'AVAILABLE',
            allocatedParticipantRef: null,
            allocatedParticipantId: null,
            allocatedParticipantName: null,
            allocationId: null,
            allocationType: null,
            allocatedAt: null
          }
        }
      );

      // 4. Sync sequence counter to highest remaining FIXED allocation
      const maxFixed = await Allocation.findOne({ eventId: event._id })
        .sort({ sequenceNumber: -1 })
        .lean();

      event.allocationSequenceCounter = maxFixed ? maxFixed.sequenceNumber : 0;
      event.status = autoStartLive ? 'LIVE' : 'DRAFT';
      event.startedAt = autoStartLive ? new Date() : null;
      event.completedAt = null;
      event.finalizedAt = null;
      await event.save();
    });

    const summary = await computeEventPoolSummary(event._id);

    await recordAudit({
      eventId: event._id,
      action: 'DEMO_RANDOM_DRAWS_RESET',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actor: req.admin,
      req,
      summary: `Reset all random draws for repeatable demo (${summary.remainingParticipants} participants & ${summary.remainingFlats} flats ready to draw; ${summary.fixedAllocations} fixed mappings preserved).`,
      metadata: summary
    });

    return res.json({
      success: true,
      message: `Random draws reset! ${summary.remainingParticipants} participants and ${summary.remainingFlats} flats are back in the random pool (${summary.fixedAllocations} fixed mappings preserved).`,
      event,
      summary
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getLotteryOverview,
  verifyTicketPublic,
  getPreLotterySummary,
  updateLotteryConfig,
  startLotteryEvent,
  pauseLotteryEvent,
  resumeLotteryEvent,
  endOrFinalizeLotteryEvent,
  drawOneAllocationHandler,
  drawBatchAllocationsHandler,
  listAllocations,
  getSingleTicket,
  downloadSingleTicketPdf,
  authorizeAllocationCorrection,
  buildDemoDataset,
  loadDemoDatasetHandler,
  resetDemoDrawsHandler
};
