const crypto = require('crypto');
const { AuditLog } = require('../models');
const { generateQrSvg } = require('../utils/qrGenerator');

function getVerificationSecret() {
  return process.env.LOTTERY_HMAC_SECRET || process.env.JWT_SECRET || 'royal-palms-lottery-audit-key-2026';
}

/**
 * Generates tamper-evident HMAC-SHA256 verification digest & QR payload for an official allocation.
 */
function buildAllocationVerification({
  allocationId,
  eventCode = 'RP-EVENT-2026',
  participantId,
  participantName,
  flatNumber,
  allocationType,
  allocatedAt
}) {
  const iso = new Date(allocatedAt || Date.now()).toISOString();
  const canonical = [
    eventCode,
    allocationId,
    participantId,
    String(participantName || '').toUpperCase(),
    flatNumber,
    allocationType,
    iso
  ].join('|');

  const verificationHash = crypto
    .createHmac('sha256', getVerificationSecret())
    .update(canonical)
    .digest('hex');

  const shortRef = verificationHash.slice(0, 12).toUpperCase();
  const verificationPayload = `RP-VERIFY|ID:${allocationId}|FLAT:${flatNumber}|PID:${participantId}|TYPE:${allocationType}|REF:${shortRef}`;

  return {
    verificationHash,
    verificationPayload,
    shortRef
  };
}

/**
 * Attaches live SVG QR code and formatted fields to an Allocation plain object for API responses.
 */
function enrichAllocationForClient(allocDoc) {
  if (!allocDoc) return null;
  const obj = typeof allocDoc.toObject === 'function' ? allocDoc.toObject() : { ...allocDoc };
  obj.qrSvg = generateQrSvg(
    obj.verificationPayload ||
      `RP-VERIFY|ID:${obj.allocationId}|FLAT:${obj.flatNumber}|PID:${obj.participantId}`,
    { sizePx: 132 }
  );
  obj.verificationRef = String(obj.verificationHash || '').slice(0, 12).toUpperCase();
  return obj;
}

/**
 * Appends an immutable AuditLog document.
 */
async function recordAudit(
  {
    eventId = null,
    action,
    entityType = 'SYSTEM',
    entityId = '',
    actor = null,
    req = null,
    summary,
    metadata = {}
  },
  session = null
) {
  const doc = {
    eventId: eventId || null,
    action,
    entityType,
    entityId: String(entityId || ''),
    actorId: actor?._id || null,
    actorUsername: actor?.username || 'system',
    actorRole: actor?.role || 'SYSTEM',
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || '127.0.0.1',
    summary,
    metadata
  };

  if (session) {
    const [created] = await AuditLog.create([doc], { session });
    return created;
  }
  return AuditLog.create(doc);
}

module.exports = {
  buildAllocationVerification,
  enrichAllocationForClient,
  recordAudit
};
