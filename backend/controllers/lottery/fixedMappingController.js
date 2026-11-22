const { connectMongo } = require('../../config/mongoDb');
const { LotteryEvent, Participant, Flat, FixedMapping } = require('../../models');
const {
  createFixedMapping,
  updateFixedMapping,
  deleteFixedMapping
} = require('../../services/allocationEngine');
const { cleanString, normalizeFlatNumber } = require('../../middleware/validateMiddleware');

async function getActiveEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

/**
 * GET /api/lottery/fixed-mappings
 * Returns all fixed mappings + unallocated eligible participants & available flats for selection.
 */
async function listFixedMappings(req, res, next) {
  try {
    const event = await getActiveEvent();
    const search = cleanString(req.query.search || '', 120);

    const filter = { eventId: event._id };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { participantName: rx },
        { participantId: rx },
        { flatNumber: rx },
        { allocationId: rx },
        { reason: rx }
      ];
    }

    const [mappings, availableParticipants, availableFlats] = await Promise.all([
      FixedMapping.find(filter).sort({ flatNumber: 1, createdAt: -1 }).lean(),
      Participant.find(
        { eventId: event._id, allocationStatus: 'PENDING', isEligible: true },
        { _id: 1, participantId: 1, fullName: 1, registrationNumber: 1, wingPreference: 1 }
      )
        .sort({ fullName: 1 })
        .limit(3000)
        .lean(),
      Flat.find(
        { eventId: event._id, status: 'AVAILABLE', isAvailableForLottery: true },
        { _id: 1, flatNumber: 1, wing: 1, floor: 1, building: 1 }
      )
        .sort({ sequenceOrder: 1, flatNumber: 1 })
        .limit(3000)
        .lean()
    ]);

    return res.json({
      success: true,
      eventStatus: event.status,
      mappings,
      availableParticipants,
      availableFlats
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/fixed-mappings
 * Supports mapping by Mongo _id (participantRef, flatRef) OR by business codes (participantId, flatNumber).
 */
async function createMappingHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    let { participantRef, flatRef } = req.body;

    if (!participantRef && req.body.participantId) {
      const p = await Participant.findOne({
        eventId: event._id,
        participantId: cleanString(req.body.participantId, 60).toUpperCase()
      });
      if (!p) {
        return res.status(404).json({
          success: false,
          message: `Participant ID "${req.body.participantId}" not found.`
        });
      }
      participantRef = p._id;
    }

    if (!flatRef && req.body.flatNumber) {
      const f = await Flat.findOne({
        eventId: event._id,
        flatNumber: normalizeFlatNumber(req.body.flatNumber)
      });
      if (!f) {
        return res.status(404).json({
          success: false,
          message: `Flat Number "${req.body.flatNumber}" not found in inventory.`
        });
      }
      flatRef = f._id;
    }

    if (!participantRef || !flatRef) {
      return res.status(400).json({
        success: false,
        message: 'Both Participant and Flat selection are required for fixed mapping.'
      });
    }

    const result = await createFixedMapping({
      eventId: event._id,
      participantRef,
      flatRef,
      reason: req.body.reason,
      actor: req.admin,
      req,
      body: req.body
    });

    return res.status(201).json({
      success: true,
      message: `Fixed flat mapping saved: ${result.mapping.participantName} -> Flat ${result.mapping.flatNumber}`,
      ...result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/lottery/fixed-mappings/:id
 */
async function updateMappingHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    let newFlatRef = req.body.flatRef;

    if (!newFlatRef && req.body.flatNumber) {
      const f = await Flat.findOne({
        eventId: event._id,
        flatNumber: normalizeFlatNumber(req.body.flatNumber)
      });
      if (!f) {
        return res.status(404).json({
          success: false,
          message: `Flat "${req.body.flatNumber}" not found.`
        });
      }
      newFlatRef = f._id;
    }

    const result = await updateFixedMapping({
      mappingId: req.params.id,
      eventId: event._id,
      newFlatRef,
      reason: req.body.reason,
      actor: req.admin,
      req,
      body: req.body
    });

    return res.json({
      success: true,
      message: `Fixed mapping updated for ${result.mapping.participantName}.`,
      ...result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/lottery/fixed-mappings/:id
 */
async function deleteMappingHandler(req, res, next) {
  try {
    const event = await getActiveEvent();
    await deleteFixedMapping({
      mappingId: req.params.id,
      eventId: event._id,
      actor: req.admin,
      req,
      body: req.body || {}
    });

    return res.json({
      success: true,
      message: 'Fixed mapping removed. Participant and flat returned to the available pools.'
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listFixedMappings,
  createMappingHandler,
  updateMappingHandler,
  deleteMappingHandler
};
