const XLSX = require('xlsx');
const { connectMongo } = require('../../config/mongoDb');
const {
  LotteryEvent,
  Participant,
  Flat,
  FixedMapping,
  Allocation,
  AuditLog,
  AdminUser
} = require('../../models');
const { computeEventPoolSummary } = require('../../services/allocationEngine');
const { enrichAllocationForClient, recordAudit } = require('../../services/auditService');
const { generateReportPdfBuffer } = require('../../utils/pdfGenerator');
const { cleanString } = require('../../middleware/validateMiddleware');

async function getActiveEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toISOString().slice(0, 10);
}

function fmtTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '-'
    : dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

/**
 * Builds structured report dataset for all 9 Official Reports + Complete Allocation Audit Report.
 */
async function buildReportDataset(reportType, query = {}) {
  const event = await getActiveEvent();
  const summary = await computeEventPoolSummary(event._id);

  const search = cleanString(query.search || query.name || '', 120);
  const flatNumber = cleanString(query.flatNumber || '', 50);
  const allocationType = cleanString(query.allocationType || '', 20).toUpperCase();
  const wing = cleanString(query.wing || '', 60);
  const floor = cleanString(query.floor || '', 30);
  const dateFrom = cleanString(query.dateFrom || '', 30);
  const dateTo = cleanString(query.dateTo || '', 30);

  const searchRx = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const flatRx = flatNumber
    ? new RegExp(flatNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : null;
  const wingRx = wing ? new RegExp(`^${wing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null;

  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
  if (dateTo) dateFilter.$lte = new Date(`${dateTo}T23:59:59.999Z`);
  const hasDate = Object.keys(dateFilter).length > 0;

  let title = '';
  let columns = [];
  let rows = [];
  let objects = [];

  switch (reportType) {
    case 'all-participants':
    case 'pending-participants': {
      title =
        reportType === 'pending-participants'
          ? 'PENDING PARTICIPANTS REPORT (UNALLOCATED)'
          : 'ALL REGISTERED PARTICIPANTS REPORT';
      const f = { eventId: event._id };
      if (reportType === 'pending-participants') {
        f.allocationStatus = 'PENDING';
        f.isEligible = true;
      }
      if (allocationType === 'FIXED') f.allocationStatus = 'FIXED_MAPPED';
      if (allocationType === 'RANDOM') f.allocationType = 'RANDOM';
      if (wingRx) f.wingPreference = wingRx;
      if (flatRx) f.allocatedFlatNumber = flatRx;
      if (searchRx) {
        f.$or = [
          { fullName: searchRx },
          { participantId: searchRx },
          { registrationNumber: searchRx },
          { mobileNumber: searchRx }
        ];
      }

      const docs = await Participant.find(f).sort({ participantId: 1 }).lean();
      columns = [
        { header: 'Sr No', width: 45 },
        { header: 'Participant ID', width: 95 },
        { header: 'Full Name', width: 165 },
        { header: 'Reg. No', width: 95 },
        { header: 'Mobile', width: 90 },
        { header: 'Wing/Bldg', width: 80 },
        { header: 'Status', width: 85 },
        { header: 'Allocated Flat', width: 80 },
        { header: 'Type', width: 65 }
      ];
      objects = docs.map((d, i) => ({
        'Sr No': i + 1,
        'Participant ID': d.participantId,
        'Full Name': d.fullName,
        'Registration Number': d.registrationNumber || '-',
        'Mobile Number': d.mobileNumber || '-',
        'Wing / Building': d.wingPreference || '-',
        Status: d.allocationStatus,
        'Allocated Flat': d.allocatedFlatNumber || '-',
        'Allocation Type': d.allocationType || '-'
      }));
      rows = objects.map((o) => Object.values(o));
      break;
    }

    case 'available-flats':
    case 'remaining-flats': {
      title =
        reportType === 'remaining-flats'
          ? 'REMAINING UNALLOCATED FLATS REPORT'
          : 'COMPLETE FLAT INVENTORY & STATUS REPORT';
      const f = { eventId: event._id };
      if (reportType === 'remaining-flats') {
        f.status = 'AVAILABLE';
        f.isAvailableForLottery = true;
      }
      if (allocationType === 'FIXED') f.status = 'FIXED_MAPPED';
      if (allocationType === 'RANDOM') f.allocationType = 'RANDOM';
      if (wingRx) f.wing = wingRx;
      if (floor) f.floor = floor;
      if (flatRx) f.flatNumber = flatRx;
      if (searchRx) {
        f.$or = [
          { flatNumber: searchRx },
          { wing: searchRx },
          { building: searchRx },
          { allocatedParticipantName: searchRx }
        ];
      }

      const docs = await Flat.find(f).sort({ sequenceOrder: 1, flatNumber: 1 }).lean();
      columns = [
        { header: 'Sr No', width: 45 },
        { header: 'Flat No', width: 80 },
        { header: 'Wing', width: 75 },
        { header: 'Floor', width: 55 },
        { header: 'Building', width: 130 },
        { header: 'Status', width: 90 },
        { header: 'Allotted To', width: 155 },
        { header: 'Participant ID', width: 90 },
        { header: 'Allocation ID', width: 85 }
      ];
      objects = docs.map((d, i) => ({
        'Sr No': i + 1,
        'Flat Number': d.flatNumber,
        Wing: d.wing || '-',
        Floor: d.floor || '-',
        Building: d.building || '-',
        Status: d.status,
        'Allotted To': d.allocatedParticipantName || '-',
        'Participant ID': d.allocatedParticipantId || '-',
        'Allocation ID': d.allocationId || '-'
      }));
      rows = objects.map((o) => Object.values(o));
      break;
    }

    case 'fixed-allocations':
    case 'random-allocations':
    case 'complete-allocations':
    case 'allocation-history': {
      const titleMap = {
        'fixed-allocations': 'FIXED FLAT ALLOCATIONS REPORT',
        'random-allocations': 'RANDOM LOTTERY ALLOCATIONS REPORT',
        'complete-allocations': 'COMPLETE OFFICIAL FLAT ALLOCATION REPORT (FIXED & RANDOM)',
        'allocation-history': 'CHRONOLOGICAL ALLOCATION HISTORY REPORT'
      };
      title = titleMap[reportType];

      const f = { eventId: event._id };
      if (reportType === 'fixed-allocations') f.allocationType = 'FIXED';
      else if (reportType === 'random-allocations') f.allocationType = 'RANDOM';
      else if (['FIXED', 'RANDOM'].includes(allocationType)) f.allocationType = allocationType;

      if (wingRx) f.wing = wingRx;
      if (floor) f.floor = floor;
      if (flatRx) f.flatNumber = flatRx;
      if (hasDate) f.allocatedAt = dateFilter;
      if (searchRx) {
        f.$or = [
          { participantName: searchRx },
          { participantId: searchRx },
          { flatNumber: searchRx },
          { allocationId: searchRx }
        ];
      }

      const sortSpec =
        reportType === 'allocation-history'
          ? { allocatedAt: -1, sequenceNumber: -1 }
          : { flatNumber: 1, sequenceNumber: 1 };

      const docs = await Allocation.find(f).sort(sortSpec).lean();
      columns = [
        { header: 'Sr No', width: 42 },
        { header: 'Allocation ID', width: 88 },
        { header: 'Type', width: 62 },
        { header: 'Participant ID', width: 86 },
        { header: 'Participant Name', width: 150 },
        { header: 'Flat No', width: 68 },
        { header: 'Wing', width: 64 },
        { header: 'Floor', width: 48 },
        { header: 'Date', width: 76 },
        { header: 'Time', width: 76 },
        { header: 'Initiated By', width: 95 }
      ];
      objects = docs.map((d, i) => ({
        'Sr No': i + 1,
        'Allocation ID': d.allocationId,
        'Allocation Type': d.allocationType,
        'Participant ID': d.participantId,
        'Participant Name': d.participantName,
        'Flat Number': d.flatNumber,
        Wing: d.wing || '-',
        Floor: d.floor || '-',
        Date: fmtDate(d.allocatedAt),
        Time: fmtTime(d.allocatedAt),
        'Initiated By': d.initiatedByName || '-'
      }));
      rows = objects.map((o) => Object.values(o));
      break;
    }

    case 'date-wise-allocations': {
      title = 'DATE-WISE FLAT ALLOCATION REPORT';
      const f = { eventId: event._id };
      if (['FIXED', 'RANDOM'].includes(allocationType)) f.allocationType = allocationType;
      if (wingRx) f.wing = wingRx;
      if (floor) f.floor = floor;
      if (flatRx) f.flatNumber = flatRx;
      if (hasDate) f.allocatedAt = dateFilter;
      if (searchRx) {
        f.$or = [
          { participantName: searchRx },
          { participantId: searchRx },
          { flatNumber: searchRx },
          { allocationId: searchRx }
        ];
      }

      const docs = await Allocation.find(f).sort({ allocatedAt: 1, sequenceNumber: 1 }).lean();
      columns = [
        { header: 'Date', width: 85 },
        { header: 'Allocation ID', width: 90 },
        { header: 'Time', width: 82 },
        { header: 'Type', width: 65 },
        { header: 'Participant Name', width: 165 },
        { header: 'Participant ID', width: 92 },
        { header: 'Flat No', width: 72 },
        { header: 'Wing / Floor', width: 90 },
        { header: 'Verify Ref', width: 85 }
      ];
      objects = docs.map((d) => ({
        Date: fmtDate(d.allocatedAt),
        'Allocation ID': d.allocationId,
        Time: fmtTime(d.allocatedAt),
        'Allocation Type': d.allocationType,
        'Participant Name': d.participantName,
        'Participant ID': d.participantId,
        'Flat Number': d.flatNumber,
        'Wing / Floor': [d.wing, d.floor ? `Flr ${d.floor}` : ''].filter(Boolean).join(' / ') || '-',
        'Verification Ref': String(d.verificationHash || '').slice(0, 10).toUpperCase()
      }));
      rows = objects.map((o) => Object.values(o));
      break;
    }

    case 'audit-report': {
      title = 'COMPLETE ALLOCATION & SECURITY AUDIT REPORT';
      const f = {};
      if (hasDate) f.createdAt = dateFilter;
      if (searchRx) {
        f.$or = [{ action: searchRx }, { actorUsername: searchRx }, { summary: searchRx }, { entityId: searchRx }];
      }

      const logs = await AuditLog.find(f).sort({ createdAt: -1 }).limit(5000).lean();
      columns = [
        { header: 'Sr No', width: 42 },
        { header: 'Date', width: 78 },
        { header: 'Time', width: 80 },
        { header: 'Action', width: 150 },
        { header: 'Entity', width: 80 },
        { header: 'Admin User', width: 95 },
        { header: 'Role', width: 90 },
        { header: 'Audit Summary', width: 210 }
      ];
      objects = logs.map((l, i) => ({
        'Sr No': i + 1,
        Date: fmtDate(l.createdAt),
        Time: fmtTime(l.createdAt),
        Action: l.action,
        Entity: l.entityType,
        'Admin User': l.actorUsername,
        Role: l.actorRole,
        Summary: l.summary
      }));
      rows = objects.map((o) => Object.values(o));
      break;
    }

    default: {
      const err = new Error(`Unsupported report type: "${reportType}".`);
      err.statusCode = 400;
      throw err;
    }
  }

  const summaryItems = [
    { label: 'Total Participants', value: summary.totalParticipants },
    { label: 'Total Flats', value: summary.totalFlats },
    { label: 'Fixed', value: summary.fixedAllocations },
    { label: 'Random', value: summary.randomAllocations },
    { label: 'Total Allocated', value: summary.totalAllocated },
    { label: 'Filtered Rows', value: rows.length }
  ];

  return {
    event,
    summary,
    reportType,
    title,
    summaryItems,
    columns,
    rows,
    objects
  };
}

/**
 * GET /api/lottery/reports/:reportType
 */
async function getReportJson(req, res, next) {
  try {
    const dataset = await buildReportDataset(req.params.reportType, req.query);
    return res.json({
      success: true,
      reportType: dataset.reportType,
      title: dataset.title,
      societyName: dataset.event.societyName,
      eventName: dataset.event.eventName,
      summaryItems: dataset.summaryItems,
      columns: dataset.columns.map((c) => c.header),
      totalRows: dataset.objects.length,
      rows: dataset.objects
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/reports/:reportType/export?format=xlsx|csv|pdf
 */
async function exportReportFile(req, res, next) {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const dataset = await buildReportDataset(req.params.reportType, req.query);
    const stamp = new Date().toISOString().slice(0, 10);
    const safeSlug = dataset.reportType.replace(/[^a-z0-9_-]/gi, '_');

    await recordAudit({
      eventId: dataset.event._id,
      action: 'REPORT_EXPORTED',
      entityType: 'SYSTEM',
      entityId: dataset.reportType,
      actor: req.admin,
      req,
      summary: `Exported ${dataset.title} as ${format.toUpperCase()} (${dataset.rows.length} rows).`
    });

    if (format === 'pdf') {
      const pdfBuf = generateReportPdfBuffer({
        title: dataset.title,
        event: dataset.event,
        summaryItems: dataset.summaryItems,
        columns: dataset.columns,
        rows: dataset.rows
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="RoyalPalms_${safeSlug}_${stamp}.pdf"`
      );
      return res.send(pdfBuf);
    }

    const wb = XLSX.utils.book_new();
    const sheetRows =
      dataset.objects.length > 0
        ? dataset.objects
        : [Object.fromEntries(dataset.columns.map((c) => [c.header, '']))];
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = dataset.columns.map((c) => ({ wch: Math.max(12, Math.round((c.width || 80) / 4.5)) }));
    XLSX.utils.book_append_sheet(wb, ws, safeSlug.slice(0, 31));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="RoyalPalms_${safeSlug}_${stamp}.csv"`
      );
      return res.send('\uFEFF' + XLSX.utils.sheet_to_csv(ws));
    }

    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="RoyalPalms_${safeSlug}_${stamp}.xlsx"`
    );
    return res.send(xlsxBuf);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/tickets/print-all
 * Returns all filtered allocations enriched with vector SVG QR codes for Print All Tickets.
 */
async function getAllTicketsForPrint(req, res, next) {
  try {
    const event = await getActiveEvent();
    const allocationType = cleanString(req.query.allocationType || '', 20).toUpperCase();
    const filter = { eventId: event._id };
    if (['FIXED', 'RANDOM'].includes(allocationType)) {
      filter.allocationType = allocationType;
    }

    const docs = await Allocation.find(filter).sort({ sequenceNumber: 1 }).lean();
    return res.json({
      success: true,
      event,
      totalTickets: docs.length,
      tickets: docs.map(enrichAllocationForClient)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/audit-logs
 */
async function listAuditLogs(req, res, next) {
  try {
    await connectMongo();
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 100));
    const search = cleanString(req.query.search || '', 120);
    const filter = {};
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ action: rx }, { actorUsername: rx }, { summary: rx }, { entityId: rx }];
    }

    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({
      success: true,
      logs
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/backup/export (SUPER_ADMIN only)
 * Exports a complete MongoDB snapshot of all collections (AdminUsers password hashes omitted).
 */
async function exportDatabaseBackup(req, res, next) {
  try {
    const event = await getActiveEvent();
    const [events, participants, flats, fixedMappings, allocations, admins, auditLogs] =
      await Promise.all([
        LotteryEvent.find().lean(),
        Participant.find().lean(),
        Flat.find().lean(),
        FixedMapping.find().lean(),
        Allocation.find().lean(),
        AdminUser.find({}, { passwordHash: 0 }).lean(),
        AuditLog.find().sort({ createdAt: -1 }).limit(10000).lean()
      ]);

    await recordAudit({
      eventId: event?._id || null,
      action: 'DATABASE_BACKUP_EXPORTED',
      entityType: 'BACKUP',
      actor: req.admin,
      req,
      summary: `Exported complete MongoDB lottery backup (${participants.length} participants, ${flats.length} flats, ${allocations.length} allocations).`
    });

    const payload = {
      backupVersion: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: req.admin.username,
      database: 'MongoDB',
      counts: {
        lotteryEvents: events.length,
        participants: participants.length,
        flats: flats.length,
        fixedMappings: fixedMappings.length,
        allocations: allocations.length,
        adminUsers: admins.length,
        auditLogs: auditLogs.length
      },
      collections: {
        LotteryEvents: events,
        Participants: participants,
        Flats: flats,
        FixedMappings: fixedMappings,
        Allocations: allocations,
        AdminUsers: admins,
        AuditLogs: auditLogs
      }
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="RoyalPalms_MongoDB_Backup_${stamp}.json"`
    );
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getReportJson,
  exportReportFile,
  getAllTicketsForPrint,
  listAuditLogs,
  exportDatabaseBackup
};
