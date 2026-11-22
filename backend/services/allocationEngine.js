const crypto = require('crypto');
const { runInMongoTransaction } = require('../config/mongoDb');
const {
  LotteryEvent,
  Participant,
  Flat,
  FixedMapping,
  Allocation
} = require('../models');
const {
  buildAllocationVerification,
  enrichAllocationForClient,
  recordAudit
} = require('./auditService');
const { cleanString } = require('../middleware/validateMiddleware');

/**
 * Per-event async mutex queue so simultaneous requests from multiple operators
 * execute cleanly in strict serial order without WriteConflict thrashing or race conditions.
 */
const eventMutexChains = new Map();

function withEventLock(eventId, taskFn) {
  const key = String(eventId || 'global');
  const previous = eventMutexChains.get(key) || Promise.resolve();
  const runPromise = previous.then(() => taskFn());
  const tail = runPromise.catch(() => {});
  eventMutexChains.set(key, tail);
  tail.then(() => {
    if (eventMutexChains.get(key) === tail) {
      eventMutexChains.delete(key);
    }
  });
  return runPromise;
}

/**
 * Cryptographically unbiased Fisher-Yates shuffle using Node.js crypto.randomInt().
 */
function cryptoShuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Atomically reserves the next sequential Allocation ID (e.g. RP-000001).
 */
async function reserveNextAllocationCode(eventId, prefix = 'RP', session = null) {
  const opts = { new: true };
  if (session) opts.session = session;

  const updatedEvent = await LotteryEvent.findByIdAndUpdate(
    eventId,
    { $inc: { allocationSequenceCounter: 1 } },
    opts
  );
  const seq = updatedEvent.allocationSequenceCounter;
  const cleanPrefix = (prefix || 'RP').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'RP';
  return {
    sequenceNumber: seq,
    allocationId: `${cleanPrefix}-${String(seq).padStart(6, '0')}`
  };
}

/**
 * Computes real-time MongoDB lottery pool metrics and readiness warnings.
 */
async function computeEventPoolSummary(eventId) {
  const [
    totalParticipants,
    ineligibleParticipants,
    fixedParticipantsCount,
    allocatedParticipantsCount,
    remainingParticipants,
    totalFlats,
    unavailableFlats,
    fixedFlatsCount,
    allocatedFlatsCount,
    remainingFlats,
    fixedAllocations,
    randomAllocations,
    totalAllocated
  ] = await Promise.all([
    Participant.countDocuments({ eventId }),
    Participant.countDocuments({ eventId, isEligible: false }),
    Participant.countDocuments({ eventId, allocationStatus: 'FIXED_MAPPED' }),
    Participant.countDocuments({ eventId, allocationStatus: 'ALLOCATED' }),
    Participant.countDocuments({ eventId, isEligible: true, allocationStatus: 'PENDING' }),
    Flat.countDocuments({ eventId }),
    Flat.countDocuments({ eventId, isAvailableForLottery: false }),
    Flat.countDocuments({ eventId, status: 'FIXED_MAPPED' }),
    Flat.countDocuments({ eventId, status: 'ALLOCATED' }),
    Flat.countDocuments({ eventId, isAvailableForLottery: true, status: 'AVAILABLE' }),
    Allocation.countDocuments({ eventId, allocationType: 'FIXED' }),
    Allocation.countDocuments({ eventId, allocationType: 'RANDOM' }),
    Allocation.countDocuments({ eventId })
  ]);

  const pendingAllocations = Math.min(remainingParticipants, remainingFlats);
  const countDifference = remainingParticipants - remainingFlats;
  let mismatchWarning = null;

  if (remainingParticipants !== remainingFlats) {
    if (remainingParticipants > remainingFlats) {
      mismatchWarning = `Count mismatch: ${remainingParticipants} eligible remaining participants vs ${remainingFlats} remaining available flats. ${remainingParticipants - remainingFlats} participant(s) will remain pending after all available flats are allocated.`;
    } else {
      mismatchWarning = `Count mismatch: ${remainingParticipants} eligible remaining participants vs ${remainingFlats} remaining available flats. ${remainingFlats - remainingParticipants} flat(s) will remain unallocated after all eligible participants receive flats.`;
    }
  }

  return {
    totalParticipants,
    ineligibleParticipants,
    totalFlats,
    unavailableFlats,
    fixedAllocations,
    randomAllocations,
    remainingParticipants,
    remainingFlats,
    totalAllocated,
    pendingAllocations,
    fixedParticipantsCount,
    allocatedParticipantsCount,
    fixedFlatsCount,
    allocatedFlatsCount,
    hasCountMismatch: remainingParticipants !== remainingFlats,
    countDifference,
    mismatchWarning
  };
}

/**
 * Enforces event lock rules for Fixed Mappings & Post-Finalization Changes.
 */
function assertMappingMutableOrAuthorized(event, actor, body = {}) {
  const lockedStates = ['LIVE', 'PAUSED', 'COMPLETED', 'FINALIZED'];
  if (!lockedStates.includes(event.status)) {
    return { isOverride: false, auditReason: '' };
  }

  if (actor.role !== 'SUPER_ADMIN') {
    const err = new Error(
      `Lottery event is currently ${event.status}. Only a SUPER_ADMIN with explicit audit authorization can modify mappings now.`
    );
    err.statusCode = 403;
    err.code = 'EVENT_LOCKED';
    throw err;
  }

  const auditReason = cleanString(body.auditReason || '', 300);
  if (!body.overrideAuthorization || auditReason.length < 8) {
    const err = new Error(
      `Lottery event is ${event.status}. Authorized changes require "overrideAuthorization: true" and a detailed "auditReason" (minimum 8 characters) for the permanent audit log.`
    );
    err.statusCode = 409;
    err.code = 'OVERRIDE_CONFIRMATION_REQUIRED';
    throw err;
  }

  return { isOverride: true, auditReason };
}

/**
 * Creates a Fixed Flat Mapping (and its corresponding permanent FIXED Allocation record),
 * immediately locking both the Participant and Flat out of the random pools.
 */
async function createFixedMapping({ eventId, participantRef, flatRef, reason, actor, req, body = {} }) {
  return withEventLock(eventId, () =>
    runInMongoTransaction(async (session) => {
      const qOpt = session ? { session } : {};
      const event = await LotteryEvent.findById(eventId, null, qOpt);
      if (!event) {
        const err = new Error('Lottery event not found.');
        err.statusCode = 404;
        throw err;
      }

      const authOverride = assertMappingMutableOrAuthorized(event, actor, body);

      const participant = await Participant.findOne({ _id: participantRef, eventId }, null, qOpt);
      if (!participant) {
        const err = new Error('Selected participant does not exist.');
        err.statusCode = 404;
        throw err;
      }
      if (!participant.fullName || !participant.participantId) {
        const err = new Error('Cannot map an incomplete participant record.');
        err.statusCode = 400;
        throw err;
      }
      if (participant.allocationStatus !== 'PENDING') {
        const err = new Error(
          `Conflict: Participant "${participant.fullName}" (${participant.participantId}) is already ${participant.allocationStatus} to Flat ${participant.allocatedFlatNumber || 'N/A'}.`
        );
        err.statusCode = 409;
        err.code = 'PARTICIPANT_CONFLICT';
        throw err;
      }

      const flat = await Flat.findOne({ _id: flatRef, eventId }, null, qOpt);
      if (!flat) {
        const err = new Error('Selected flat does not exist.');
        err.statusCode = 404;
        throw err;
      }
      if (!flat.isAvailableForLottery) {
        const err = new Error(`Flat "${flat.flatNumber}" is marked unavailable for lottery.`);
        err.statusCode = 409;
        err.code = 'FLAT_UNAVAILABLE';
        throw err;
      }
      if (flat.status !== 'AVAILABLE') {
        const err = new Error(
          `Conflict: Flat "${flat.flatNumber}" is already ${flat.status} (${flat.allocatedParticipantName || 'assigned'}). Two people cannot be mapped to the same flat.`
        );
        err.statusCode = 409;
        err.code = 'FLAT_CONFLICT';
        throw err;
      }

      const now = new Date();
      const { sequenceNumber, allocationId } = await reserveNextAllocationCode(
        event._id,
        event.config?.ticketPrefix || 'RP',
        session
      );

      const verification = buildAllocationVerification({
        allocationId,
        eventCode: event.eventCode,
        participantId: participant.participantId,
        participantName: participant.fullName,
        flatNumber: flat.flatNumber,
        allocationType: 'FIXED',
        allocatedAt: now
      });

      // Atomically claim Participant & Flat
      const claimedP = await Participant.findOneAndUpdate(
        { _id: participant._id, allocationStatus: 'PENDING' },
        {
          $set: {
            allocationStatus: 'FIXED_MAPPED',
            allocatedFlatRef: flat._id,
            allocatedFlatNumber: flat.flatNumber,
            allocationId,
            allocationType: 'FIXED',
            allocatedAt: now
          }
        },
        { new: true, ...qOpt }
      );

      const claimedF = await Flat.findOneAndUpdate(
        { _id: flat._id, status: 'AVAILABLE' },
        {
          $set: {
            status: 'FIXED_MAPPED',
            allocatedParticipantRef: participant._id,
            allocatedParticipantId: participant.participantId,
            allocatedParticipantName: participant.fullName,
            allocationId,
            allocationType: 'FIXED',
            allocatedAt: now
          }
        },
        { new: true, ...qOpt }
      );

      if (!claimedP || !claimedF) {
        const err = new Error('Concurrent mapping conflict detected. Please refresh and try again.');
        err.statusCode = 409;
        err.code = 'CONCURRENT_CONFLICT';
        throw err;
      }

      const allocPayload = {
        eventId: event._id,
        allocationId,
        sequenceNumber,
        allocationType: 'FIXED',
        participantRef: participant._id,
        participantId: participant.participantId,
        participantName: participant.fullName,
        registrationNumber: participant.registrationNumber || '',
        mobileNumber: participant.mobileNumber || '',
        flatRef: flat._id,
        flatNumber: flat.flatNumber,
        wing: flat.wing || participant.wingPreference || '',
        floor: flat.floor || '',
        building: flat.building || '',
        societyName: event.societyName,
        status: 'SUCCESSFULLY_ALLOCATED',
        verificationHash: verification.verificationHash,
        verificationPayload: verification.verificationPayload,
        initiatedBy: actor._id,
        initiatedByName: actor.fullName || actor.username,
        allocatedAt: now
      };

      const [allocation] = session
        ? await Allocation.create([allocPayload], { session })
        : [await Allocation.create(allocPayload)];

      const cleanReason = cleanString(reason || 'Pre-approved fixed flat assignment', 300);
      const mappingPayload = {
        eventId: event._id,
        participantRef: participant._id,
        participantId: participant.participantId,
        participantName: participant.fullName,
        flatRef: flat._id,
        flatNumber: flat.flatNumber,
        wing: flat.wing || '',
        floor: flat.floor || '',
        building: flat.building || '',
        reason: cleanReason,
        allocationRef: allocation._id,
        allocationId,
        createdBy: actor._id,
        createdByName: actor.fullName || actor.username
      };

      const [mapping] = session
        ? await FixedMapping.create([mappingPayload], { session })
        : [await FixedMapping.create(mappingPayload)];

      await recordAudit(
        {
          eventId: event._id,
          action: authOverride.isOverride
            ? 'FIXED_MAPPING_CREATED_WITH_OVERRIDE'
            : 'FIXED_MAPPING_CREATED',
          entityType: 'FIXED_MAPPING',
          entityId: String(mapping._id),
          actor,
          req,
          summary: `Mapped ${participant.fullName} (${participant.participantId}) -> Flat ${flat.flatNumber} [${allocationId}]`,
          metadata: {
            allocationId,
            participantId: participant.participantId,
            participantName: participant.fullName,
            flatNumber: flat.flatNumber,
            reason: cleanReason,
            overrideReason: authOverride.auditReason || undefined
          }
        },
        session
      );

      return {
        mapping,
        allocation: enrichAllocationForClient(allocation)
      };
    })
  );
}

/**
 * Updates an existing Fixed Mapping (allowing flat or reason change before lottery starts,
 * or with SUPER_ADMIN audit override if finalized).
 */
async function updateFixedMapping({ mappingId, eventId, newFlatRef, reason, actor, req, body = {} }) {
  return withEventLock(eventId, () =>
    runInMongoTransaction(async (session) => {
      const qOpt = session ? { session } : {};
      const event = await LotteryEvent.findById(eventId, null, qOpt);
      if (!event) {
        const err = new Error('Lottery event not found.');
        err.statusCode = 404;
        throw err;
      }

      const authOverride = assertMappingMutableOrAuthorized(event, actor, body);
      const existing = await FixedMapping.findOne({ _id: mappingId, eventId }, null, qOpt);
      if (!existing) {
        const err = new Error('Fixed mapping record not found.');
        err.statusCode = 404;
        throw err;
      }

      const beforeSnapshot = {
        participantId: existing.participantId,
        participantName: existing.participantName,
        flatNumber: existing.flatNumber,
        reason: existing.reason
      };

      const cleanReason =
        reason !== undefined ? cleanString(reason, 300) : existing.reason;

      // If flat changed, release old flat and claim new flat atomically
      if (newFlatRef && String(newFlatRef) !== String(existing.flatRef)) {
        const targetFlat = await Flat.findOne({ _id: newFlatRef, eventId }, null, qOpt);
        if (!targetFlat) {
          const err = new Error('Target flat not found.');
          err.statusCode = 404;
          throw err;
        }
        if (targetFlat.status !== 'AVAILABLE' || !targetFlat.isAvailableForLottery) {
          const err = new Error(
            `Conflict: Flat "${targetFlat.flatNumber}" is already ${targetFlat.status} (${targetFlat.allocatedParticipantName || 'unavailable'}).`
          );
          err.statusCode = 409;
          err.code = 'FLAT_CONFLICT';
          throw err;
        }

        // Release old flat back to AVAILABLE
        await Flat.updateOne(
          { _id: existing.flatRef },
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

        const now = new Date();
        await Flat.updateOne(
          { _id: targetFlat._id, status: 'AVAILABLE' },
          {
            $set: {
              status: 'FIXED_MAPPED',
              allocatedParticipantRef: existing.participantRef,
              allocatedParticipantId: existing.participantId,
              allocatedParticipantName: existing.participantName,
              allocationId: existing.allocationId,
              allocationType: 'FIXED',
              allocatedAt: now
            }
          },
          qOpt
        );

        await Participant.updateOne(
          { _id: existing.participantRef },
          {
            $set: {
              allocatedFlatRef: targetFlat._id,
              allocatedFlatNumber: targetFlat.flatNumber,
              allocatedAt: now
            }
          },
          qOpt
        );

        const verification = buildAllocationVerification({
          allocationId: existing.allocationId,
          eventCode: event.eventCode,
          participantId: existing.participantId,
          participantName: existing.participantName,
          flatNumber: targetFlat.flatNumber,
          allocationType: 'FIXED',
          allocatedAt: now
        });

        await Allocation.updateOne(
          { _id: existing.allocationRef },
          {
            $set: {
              flatRef: targetFlat._id,
              flatNumber: targetFlat.flatNumber,
              wing: targetFlat.wing || '',
              floor: targetFlat.floor || '',
              building: targetFlat.building || '',
              status: authOverride.isOverride ? 'AMENDED_BY_ADMIN' : 'SUCCESSFULLY_ALLOCATED',
              verificationHash: verification.verificationHash,
              verificationPayload: verification.verificationPayload,
              allocatedAt: now
            }
          },
          qOpt
        );

        existing.flatRef = targetFlat._id;
        existing.flatNumber = targetFlat.flatNumber;
        existing.wing = targetFlat.wing || '';
        existing.floor = targetFlat.floor || '';
        existing.building = targetFlat.building || '';
      }

      existing.reason = cleanReason;
      existing.updatedBy = actor._id;
      await existing.save(qOpt);

      await recordAudit(
        {
          eventId: event._id,
          action: authOverride.isOverride
            ? 'AUTHORIZED_ADMIN_MAPPING_CORRECTION'
            : 'FIXED_MAPPING_UPDATED',
          entityType: 'FIXED_MAPPING',
          entityId: String(existing._id),
          actor,
          req,
          summary: `Updated fixed mapping for ${existing.participantName}: Flat ${beforeSnapshot.flatNumber} -> Flat ${existing.flatNumber}`,
          metadata: {
            before: beforeSnapshot,
            after: {
              flatNumber: existing.flatNumber,
              reason: existing.reason
            },
            auditReason: authOverride.auditReason || undefined
          }
        },
        session
      );

      const updatedAlloc = await Allocation.findById(existing.allocationRef, null, qOpt);
      return {
        mapping: existing,
        allocation: enrichAllocationForClient(updatedAlloc)
      };
    })
  );
}

/**
 * Deletes a Fixed Mapping before the lottery starts (or with SUPER_ADMIN audit override),
 * returning both Participant and Flat to the open pools.
 */
async function deleteFixedMapping({ mappingId, eventId, actor, req, body = {} }) {
  return withEventLock(eventId, () =>
    runInMongoTransaction(async (session) => {
      const qOpt = session ? { session } : {};
      const event = await LotteryEvent.findById(eventId, null, qOpt);
      if (!event) {
        const err = new Error('Lottery event not found.');
        err.statusCode = 404;
        throw err;
      }

      const authOverride = assertMappingMutableOrAuthorized(event, actor, body);
      const existing = await FixedMapping.findOne({ _id: mappingId, eventId }, null, qOpt);
      if (!existing) {
        const err = new Error('Fixed mapping not found.');
        err.statusCode = 404;
        throw err;
      }

      await Participant.updateOne(
        { _id: existing.participantRef },
        {
          $set: {
            allocationStatus: 'PENDING',
            allocatedFlatRef: null,
            allocatedFlatNumber: null,
            allocationId: null,
            allocationType: null,
            allocatedAt: null
          }
        },
        qOpt
      );

      await Flat.updateOne(
        { _id: existing.flatRef },
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

      if (existing.allocationRef) {
        await Allocation.deleteOne({ _id: existing.allocationRef }, qOpt);
      }
      await FixedMapping.deleteOne({ _id: existing._id }, qOpt);

      await recordAudit(
        {
          eventId: event._id,
          action: authOverride.isOverride
            ? 'FIXED_MAPPING_REMOVED_WITH_OVERRIDE'
            : 'FIXED_MAPPING_REMOVED',
          entityType: 'FIXED_MAPPING',
          entityId: String(mappingId),
          actor,
          req,
          summary: `Removed fixed mapping: ${existing.participantName} (${existing.participantId}) <-> Flat ${existing.flatNumber}`,
          metadata: {
            participantId: existing.participantId,
            participantName: existing.participantName,
            flatNumber: existing.flatNumber,
            auditReason: authOverride.auditReason || undefined
          }
        },
        session
      );

      return { removed: true };
    })
  );
}

/**
 * Draws ONE random eligible Participant and assigns ONE random available Flat atomically.
 * - Uses Node.js CSPRNG crypto.randomInt()
 * - Strictly excludes FIXED_MAPPED and ALLOCATED participants & flats
 * - Protects against repeated clicks via idempotencyKey
 * - Protects against concurrent requests via per-event mutex + MongoDB transaction + conditional updates + unique indexes
 */
async function drawSingleRandomAllocation({ eventId, actor, req, idempotencyKey }) {
  const cleanKey = cleanString(idempotencyKey || '', 120) || undefined;

  return withEventLock(eventId, () =>
    runInMongoTransaction(async (session) => {
      const qOpt = session ? { session } : {};

      // 1. Idempotency protection against accidental repeated clicks
      if (cleanKey) {
        const prior = await Allocation.findOne({ idempotencyKey: cleanKey }, null, qOpt);
        if (prior) {
          const summary = await computeEventPoolSummary(eventId);
          return {
            replayedIdempotent: true,
            allocation: enrichAllocationForClient(prior),
            drumCandidates: { names: [prior.participantName], flats: [prior.flatNumber] },
            summary
          };
        }
      }

      const event = await LotteryEvent.findById(eventId, null, qOpt);
      if (!event) {
        const err = new Error('Lottery event not found.');
        err.statusCode = 404;
        throw err;
      }

      if (event.status === 'FINALIZED') {
        const err = new Error('This lottery event has been finalized and locked. No further allocations can be drawn.');
        err.statusCode = 409;
        err.code = 'EVENT_FINALIZED';
        throw err;
      }

      if (event.status === 'PAUSED') {
        const err = new Error('The live lottery presentation is currently PAUSED. Click Resume Presentation before drawing.');
        err.statusCode = 409;
        err.code = 'EVENT_PAUSED';
        throw err;
      }

      if (event.status !== 'LIVE') {
        const err = new Error(
          'Please confirm the Pre-Lottery Summary and click Start Lottery Event before drawing allocations.'
        );
        err.statusCode = 409;
        err.code = 'LOTTERY_NOT_STARTED';
        throw err;
      }

      // 2. Explicit exclusion of all FixedMapping participants & flats (belt-and-suspenders safety)
      const fixedMappings = await FixedMapping.find(
        { eventId: event._id },
        { participantRef: 1, flatRef: 1 },
        qOpt
      ).lean();
      const fixedParticipantIds = fixedMappings.map((m) => m.participantRef);
      const fixedFlatIds = fixedMappings.map((m) => m.flatRef);

      // 3. Query eligible unallocated Participants & available unallocated Flats (excluding incomplete records)
      const [eligibleParticipants, availableFlats] = await Promise.all([
        Participant.find(
          {
            eventId: event._id,
            isEligible: true,
            allocationStatus: 'PENDING',
            _id: { $nin: fixedParticipantIds },
            fullName: { $exists: true, $nin: ['', null] },
            participantId: { $exists: true, $nin: ['', null] }
          },
          null,
          qOpt
        ).lean(),
        Flat.find(
          {
            eventId: event._id,
            isAvailableForLottery: true,
            status: 'AVAILABLE',
            _id: { $nin: fixedFlatIds },
            flatNumber: { $exists: true, $nin: ['', null] }
          },
          null,
          qOpt
        ).lean()
      ]);

      if (eligibleParticipants.length === 0 || availableFlats.length === 0) {
        if (event.status === 'LIVE') {
          event.status = 'COMPLETED';
          event.completedAt = new Date();
          await event.save(qOpt);
        }
        const err = new Error(
          eligibleParticipants.length === 0 && availableFlats.length === 0
            ? 'All eligible participants and available flats have been allocated!'
            : eligibleParticipants.length === 0
              ? `All eligible participants have received flats (${availableFlats.length} flat(s) remain unallocated).`
              : `All available flats have been allocated (${eligibleParticipants.length} participant(s) remain pending).`
        );
        err.statusCode = 409;
        err.code = 'POOL_EXHAUSTED';
        throw err;
      }

      // 4. Cryptographic Server-Side Selection via crypto.randomInt()
      const chosenParticipant =
        eligibleParticipants[crypto.randomInt(0, eligibleParticipants.length)];
      const chosenFlat = availableFlats[crypto.randomInt(0, availableFlats.length)];

      const now = new Date();
      const { sequenceNumber, allocationId } = await reserveNextAllocationCode(
        event._id,
        event.config?.ticketPrefix || 'RP',
        session
      );

      // 5. Atomic Conditional Updates (prevents duplicate selection even across distributed nodes)
      const lockedParticipant = await Participant.findOneAndUpdate(
        {
          _id: chosenParticipant._id,
          allocationStatus: 'PENDING',
          isEligible: true
        },
        {
          $set: {
            allocationStatus: 'ALLOCATED',
            allocatedFlatRef: chosenFlat._id,
            allocatedFlatNumber: chosenFlat.flatNumber,
            allocationId,
            allocationType: 'RANDOM',
            allocatedAt: now
          }
        },
        { new: true, ...qOpt }
      );

      if (!lockedParticipant) {
        const err = new Error('Concurrent draw contention on participant — please retry draw.');
        err.statusCode = 409;
        err.code = 'CONCURRENT_RETRY';
        throw err;
      }

      const lockedFlat = await Flat.findOneAndUpdate(
        {
          _id: chosenFlat._id,
          status: 'AVAILABLE',
          isAvailableForLottery: true
        },
        {
          $set: {
            status: 'ALLOCATED',
            allocatedParticipantRef: chosenParticipant._id,
            allocatedParticipantId: chosenParticipant.participantId,
            allocatedParticipantName: chosenParticipant.fullName,
            allocationId,
            allocationType: 'RANDOM',
            allocatedAt: now
          }
        },
        { new: true, ...qOpt }
      );

      if (!lockedFlat) {
        // Compensating rollback if running on standalone mongod without ReplSet session
        if (!session) {
          await Participant.updateOne(
            { _id: chosenParticipant._id },
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
        }
        const err = new Error('Concurrent draw contention on flat — please retry draw.');
        err.statusCode = 409;
        err.code = 'CONCURRENT_RETRY';
        throw err;
      }

      const verification = buildAllocationVerification({
        allocationId,
        eventCode: event.eventCode,
        participantId: chosenParticipant.participantId,
        participantName: chosenParticipant.fullName,
        flatNumber: chosenFlat.flatNumber,
        allocationType: 'RANDOM',
        allocatedAt: now
      });

      const allocDoc = {
        eventId: event._id,
        allocationId,
        sequenceNumber,
        allocationType: 'RANDOM',
        participantRef: chosenParticipant._id,
        participantId: chosenParticipant.participantId,
        participantName: chosenParticipant.fullName,
        registrationNumber: chosenParticipant.registrationNumber || '',
        mobileNumber: chosenParticipant.mobileNumber || '',
        flatRef: chosenFlat._id,
        flatNumber: chosenFlat.flatNumber,
        wing: chosenFlat.wing || chosenParticipant.wingPreference || '',
        floor: chosenFlat.floor || '',
        building: chosenFlat.building || '',
        societyName: event.societyName,
        status: 'SUCCESSFULLY_ALLOCATED',
        verificationHash: verification.verificationHash,
        verificationPayload: verification.verificationPayload,
        idempotencyKey: cleanKey,
        initiatedBy: actor._id,
        initiatedByName: actor.fullName || actor.username,
        allocatedAt: now
      };

      const [savedAllocation] = session
        ? await Allocation.create([allocDoc], { session })
        : [await Allocation.create(allocDoc)];

      // Auto-mark COMPLETED if that was the final possible pair
      const remainingPairsAfter = Math.min(
        eligibleParticipants.length - 1,
        availableFlats.length - 1
      );
      if (remainingPairsAfter === 0) {
        event.status = 'COMPLETED';
        event.completedAt = now;
        await event.save(qOpt);
      }

      await recordAudit(
        {
          eventId: event._id,
          action: 'RANDOM_ALLOCATION_DRAWN',
          entityType: 'ALLOCATION',
          entityId: allocationId,
          actor,
          req,
          summary: `Live random draw: ${chosenParticipant.fullName} (${chosenParticipant.participantId}) allocated Flat ${chosenFlat.flatNumber} [${allocationId}]`,
          metadata: {
            allocationId,
            participantId: chosenParticipant.participantId,
            participantName: chosenParticipant.fullName,
            flatNumber: chosenFlat.flatNumber,
            remainingParticipantsAfter: eligibleParticipants.length - 1,
            remainingFlatsAfter: availableFlats.length - 1
          }
        },
        session
      );

      // Candidate sample from actual pool for dramatic reel cycling prior to reveal
      const sampleNames = cryptoShuffle(eligibleParticipants)
        .slice(0, 24)
        .map((p) => ({ name: p.fullName, id: p.participantId }));
      const sampleFlats = cryptoShuffle(availableFlats)
        .slice(0, 24)
        .map((f) => ({ flatNumber: f.flatNumber, wing: f.wing || '', floor: f.floor || '' }));

      const summaryAfter = session ? null : await computeEventPoolSummary(event._id);

      return {
        replayedIdempotent: false,
        allocation: enrichAllocationForClient(savedAllocation),
        drumCandidates: {
          participants: sampleNames,
          flats: sampleFlats
        },
        eventStatus: event.status,
        summary: summaryAfter
      };
    })
  ).then(async (res) => {
    if (!res.summary) {
      res.summary = await computeEventPoolSummary(eventId);
    }
    return res;
  });
}

/**
 * Runs complete cryptographic random allocation for all remaining eligible participants & available flats.
 */
async function runCompleteBatchAllocation({ eventId, actor, req, idempotencyKey }) {
  const cleanKey = cleanString(idempotencyKey || '', 120) || undefined;

  return withEventLock(eventId, () =>
    runInMongoTransaction(async (session) => {
      const qOpt = session ? { session } : {};

      if (cleanKey) {
        const prior = await Allocation.findOne({ idempotencyKey: cleanKey }, null, qOpt);
        if (prior) {
          return {
            replayedIdempotent: true,
            allocatedCount: 1,
            firstAllocationId: prior.allocationId,
            lastAllocationId: prior.allocationId,
            latestAllocation: enrichAllocationForClient(prior)
          };
        }
      }

      const event = await LotteryEvent.findById(eventId, null, qOpt);
      if (!event) {
        const err = new Error('Lottery event not found.');
        err.statusCode = 404;
        throw err;
      }

      if (event.status === 'FINALIZED') {
        const err = new Error('Lottery event is already finalized.');
        err.statusCode = 409;
        err.code = 'EVENT_FINALIZED';
        throw err;
      }

      if (!['LIVE', 'READY'].includes(event.status)) {
        const err = new Error('Confirm and start the lottery event before running complete allocation.');
        err.statusCode = 409;
        err.code = 'LOTTERY_NOT_STARTED';
        throw err;
      }

      const fixedMappings = await FixedMapping.find(
        { eventId: event._id },
        { participantRef: 1, flatRef: 1 },
        qOpt
      ).lean();
      const fixedParticipantIds = fixedMappings.map((m) => m.participantRef);
      const fixedFlatIds = fixedMappings.map((m) => m.flatRef);

      const [eligibleParticipants, availableFlats] = await Promise.all([
        Participant.find(
          {
            eventId: event._id,
            isEligible: true,
            allocationStatus: 'PENDING',
            _id: { $nin: fixedParticipantIds },
            fullName: { $exists: true, $nin: ['', null] },
            participantId: { $exists: true, $nin: ['', null] }
          },
          null,
          qOpt
        ).lean(),
        Flat.find(
          {
            eventId: event._id,
            isAvailableForLottery: true,
            status: 'AVAILABLE',
            _id: { $nin: fixedFlatIds },
            flatNumber: { $exists: true, $nin: ['', null] }
          },
          null,
          qOpt
        ).lean()
      ]);

      const pairCount = Math.min(eligibleParticipants.length, availableFlats.length);
      if (pairCount === 0) {
        const err = new Error('No remaining eligible participant + available flat pairs to allocate.');
        err.statusCode = 409;
        err.code = 'POOL_EXHAUSTED';
        throw err;
      }

      const shuffledParticipants = cryptoShuffle(eligibleParticipants);
      const shuffledFlats = cryptoShuffle(availableFlats);

      // Atomically bump sequence counter by pairCount
      const updatedEvent = await LotteryEvent.findByIdAndUpdate(
        event._id,
        {
          $inc: { allocationSequenceCounter: pairCount },
          $set: {
            status: 'COMPLETED',
            startedAt: event.startedAt || new Date(),
            startedBy: event.startedBy || actor._id,
            completedAt: new Date()
          }
        },
        { new: true, ...qOpt }
      );

      const startSeq = updatedEvent.allocationSequenceCounter - pairCount + 1;
      const prefix =
        (event.config?.ticketPrefix || 'RP').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'RP';
      const now = new Date();

      const allocDocs = [];
      const participantBulkOps = [];
      const flatBulkOps = [];

      for (let i = 0; i < pairCount; i++) {
        const p = shuffledParticipants[i];
        const f = shuffledFlats[i];
        const seq = startSeq + i;
        const allocationId = `${prefix}-${String(seq).padStart(6, '0')}`;
        const itemTime = new Date(now.getTime() + i);

        const verification = buildAllocationVerification({
          allocationId,
          eventCode: event.eventCode,
          participantId: p.participantId,
          participantName: p.fullName,
          flatNumber: f.flatNumber,
          allocationType: 'RANDOM',
          allocatedAt: itemTime
        });

        allocDocs.push({
          eventId: event._id,
          allocationId,
          sequenceNumber: seq,
          allocationType: 'RANDOM',
          participantRef: p._id,
          participantId: p.participantId,
          participantName: p.fullName,
          registrationNumber: p.registrationNumber || '',
          mobileNumber: p.mobileNumber || '',
          flatRef: f._id,
          flatNumber: f.flatNumber,
          wing: f.wing || p.wingPreference || '',
          floor: f.floor || '',
          building: f.building || '',
          societyName: event.societyName,
          status: 'SUCCESSFULLY_ALLOCATED',
          verificationHash: verification.verificationHash,
          verificationPayload: verification.verificationPayload,
          idempotencyKey: i === 0 && cleanKey ? cleanKey : undefined,
          initiatedBy: actor._id,
          initiatedByName: actor.fullName || actor.username,
          allocatedAt: itemTime
        });

        participantBulkOps.push({
          updateOne: {
            filter: { _id: p._id, allocationStatus: 'PENDING' },
            update: {
              $set: {
                allocationStatus: 'ALLOCATED',
                allocatedFlatRef: f._id,
                allocatedFlatNumber: f.flatNumber,
                allocationId,
                allocationType: 'RANDOM',
                allocatedAt: itemTime
              }
            }
          }
        });

        flatBulkOps.push({
          updateOne: {
            filter: { _id: f._id, status: 'AVAILABLE' },
            update: {
              $set: {
                status: 'ALLOCATED',
                allocatedParticipantRef: p._id,
                allocatedParticipantId: p.participantId,
                allocatedParticipantName: p.fullName,
                allocationId,
                allocationType: 'RANDOM',
                allocatedAt: itemTime
              }
            }
          }
        });
      }

      const pBulkRes = await Participant.bulkWrite(participantBulkOps, qOpt);
      const fBulkRes = await Flat.bulkWrite(flatBulkOps, qOpt);

      if (pBulkRes.modifiedCount !== pairCount || fBulkRes.modifiedCount !== pairCount) {
        const err = new Error('Concurrent modification detected during batch allocation. Operation aborted safely.');
        err.statusCode = 409;
        throw err;
      }

      await Allocation.insertMany(allocDocs, { ordered: true, ...qOpt });

      await recordAudit(
        {
          eventId: event._id,
          action: 'BATCH_RANDOM_ALLOCATION_COMPLETED',
          entityType: 'LOTTERY_EVENT',
          entityId: String(event._id),
          actor,
          req,
          summary: `Completed batch random allocation of ${pairCount} flat(s) (${allocDocs[0].allocationId} to ${allocDocs[allocDocs.length - 1].allocationId}).`,
          metadata: {
            allocatedCount: pairCount,
            firstAllocationId: allocDocs[0].allocationId,
            lastAllocationId: allocDocs[allocDocs.length - 1].allocationId,
            unallocatedParticipantsRemaining: eligibleParticipants.length - pairCount,
            unallocatedFlatsRemaining: availableFlats.length - pairCount
          }
        },
        session
      );

      return {
        allocatedCount: pairCount,
        firstAllocationId: allocDocs[0].allocationId,
        lastAllocationId: allocDocs[allocDocs.length - 1].allocationId,
        latestAllocation: enrichAllocationForClient(allocDocs[allocDocs.length - 1])
      };
    })
  ).then(async (res) => {
    res.summary = await computeEventPoolSummary(eventId);
    return res;
  });
}

module.exports = {
  withEventLock,
  cryptoShuffle,
  computeEventPoolSummary,
  createFixedMapping,
  updateFixedMapping,
  deleteFixedMapping,
  drawSingleRandomAllocation,
  runCompleteBatchAllocation
};
