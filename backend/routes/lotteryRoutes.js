const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const authCtrl = require('../controllers/lottery/authAdminController');
const partCtrl = require('../controllers/lottery/participantsController');
const flatCtrl = require('../controllers/lottery/flatsInventoryController');
const mapCtrl = require('../controllers/lottery/fixedMappingController');
const liveCtrl = require('../controllers/lottery/liveLotteryController');
const repCtrl = require('../controllers/lottery/reportsBackupController');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_LOGIN_ATTEMPTS',
    message: 'Too many login attempts. Please wait a few minutes and try again.'
  }
});

/* =========================================================================
   PUBLIC / DISPLAY ENDPOINTS (Read-only overview & QR Ticket Verification)
   ========================================================================= */
router.get('/overview', liveCtrl.getLotteryOverview);
router.get('/verify/:allocationId', liveCtrl.verifyTicketPublic);
router.get('/allocations/:id/ticket', liveCtrl.getSingleTicket);
router.get('/allocations/:id/ticket.pdf', liveCtrl.downloadSingleTicketPdf);

/* =========================================================================
   AUTHENTICATION & ADMIN USERS
   ========================================================================= */
router.post('/auth/login', loginLimiter, authCtrl.loginAdmin);
router.get('/auth/me', requireAuth, authCtrl.getCurrentAdmin);
router.post('/auth/change-password', requireAuth, authCtrl.changeOwnPassword);

router.get(
  '/admins',
  requireAuth,
  requireRole('SUPER_ADMIN', 'AUDITOR'),
  authCtrl.listAdminUsers
);
router.post('/admins', requireAuth, requireRole('SUPER_ADMIN'), authCtrl.createAdminUser);
router.patch('/admins/:id', requireAuth, requireRole('SUPER_ADMIN'), authCtrl.updateAdminUser);

/* =========================================================================
   PARTICIPANTS MANAGEMENT (500+ Upload, Preview, Validation, CRUD)
   ========================================================================= */
router.get('/participants', requireAuth, partCtrl.listParticipants);
router.get('/participants/existing-ids', requireAuth, partCtrl.getExistingParticipantIds);
router.get('/participants/template', requireAuth, partCtrl.downloadParticipantsTemplate);
router.post(
  '/participants/preview',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  partCtrl.previewParticipantsUpload
);
router.post(
  '/participants/bulk-import',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  partCtrl.bulkImportParticipants
);
router.post(
  '/participants',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  partCtrl.createParticipant
);
router.put(
  '/participants/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  partCtrl.updateParticipant
);
router.delete(
  '/participants/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  partCtrl.deleteParticipant
);

/* =========================================================================
   FLAT NUMBERS INVENTORY (Excel/CSV Upload, Sequence, Wing/Floor, CRUD)
   ========================================================================= */
router.get('/flats', requireAuth, flatCtrl.listLotteryFlats);
router.get('/flats/existing-numbers', requireAuth, flatCtrl.getExistingFlatNumbers);
router.get('/flats/template', requireAuth, flatCtrl.downloadFlatsTemplate);
router.post(
  '/flats/bulk-import',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  flatCtrl.bulkImportLotteryFlats
);
router.post(
  '/flats',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  flatCtrl.createLotteryFlat
);
router.put(
  '/flats/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  flatCtrl.updateLotteryFlat
);
router.delete(
  '/flats/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  flatCtrl.deleteLotteryFlat
);

/* =========================================================================
   FIXED FLAT MAPPING / MANUAL ALLOCATION
   ========================================================================= */
router.get('/fixed-mappings', requireAuth, mapCtrl.listFixedMappings);
router.post(
  '/fixed-mappings',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  mapCtrl.createMappingHandler
);
router.put(
  '/fixed-mappings/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  mapCtrl.updateMappingHandler
);
router.delete(
  '/fixed-mappings/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  mapCtrl.deleteMappingHandler
);

/* =========================================================================
   LOTTERY CONFIGURATION, LIVE SHOW ENGINE & ALLOCATIONS
   ========================================================================= */
router.get('/precheck', requireAuth, liveCtrl.getPreLotterySummary);
router.put(
  '/config',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.updateLotteryConfig
);
router.post(
  '/start',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.startLotteryEvent
);
router.post(
  '/pause',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.pauseLotteryEvent
);
router.post(
  '/resume',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.resumeLotteryEvent
);
router.post(
  '/end',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.endOrFinalizeLotteryEvent
);

router.post(
  '/draw-one',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.drawOneAllocationHandler
);
router.post(
  '/draw-batch',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.drawBatchAllocationsHandler
);

router.get('/allocations', requireAuth, liveCtrl.listAllocations);
router.post(
  '/allocations/:id/authorize-correction',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  liveCtrl.authorizeAllocationCorrection
);

/* =========================================================================
   REPEATABLE DEMO SEEDING & 1-CLICK DRAW RESET (DEMONSTRATE N TIMES)
   ========================================================================= */
router.post(
  '/demo/load',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.loadDemoDatasetHandler
);
router.post(
  '/demo/reset-draws',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LOTTERY_OPERATOR'),
  liveCtrl.resetDemoDrawsHandler
);

/* =========================================================================
   REPORTS, TICKETS, AUDIT LOGS & MONGODB BACKUP
   ========================================================================= */
router.get('/reports/:reportType', requireAuth, repCtrl.getReportJson);
router.get('/reports/:reportType/export', requireAuth, repCtrl.exportReportFile);
router.get('/tickets/print-all', requireAuth, repCtrl.getAllTicketsForPrint);
router.get('/audit-logs', requireAuth, repCtrl.listAuditLogs);
router.get(
  '/backup/export',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  repCtrl.exportDatabaseBackup
);

module.exports = router;
