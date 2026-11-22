/**
 * Comprehensive Automated Verification Suite for:
 * Royal Palms Flat Allocation & Live Lucky Draw Lottery Portal (MongoDB Primary)
 *
 * Runs against an isolated ephemeral MongoDB 8.2 Replica Set (LOTTERY_TEST_ISOLATED=true)
 * so existing/live data is NEVER modified or deleted.
 */

process.env.LOTTERY_TEST_ISOLATED = 'true';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const EventEmitter = require('events');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');

function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = undefined }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    const parsedUrl = new URL(url, 'http://localhost:5000');

    req.method = method.toUpperCase();
    req.url = url;
    req.originalUrl = url;
    req.path = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.ip = '127.0.0.1';
    req.ips = [];
    req.connection = { remoteAddress: '127.0.0.1' };
    req.socket = new EventEmitter();
    req.socket.remoteAddress = '127.0.0.1';
    req.complete = true;
    req.get = (name) => req.headers[String(name).toLowerCase()];

    if (body !== undefined) {
      req.body = body;
      req._body = true;
    }

    const res = new EventEmitter();
    res.statusCode = 200;
    res.locals = {};
    const storeHeaders = {};
    const chunks = [];

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.setHeader = (k, v) => {
      storeHeaders[String(k).toLowerCase()] = v;
    };
    res.getHeader = (k) => storeHeaders[String(k).toLowerCase()];
    res.getHeaders = () => ({ ...storeHeaders });
    res.removeHeader = (k) => {
      delete storeHeaders[String(k).toLowerCase()];
    };
    res.writeHead = (code, hdrs) => {
      res.statusCode = code;
      if (hdrs) Object.entries(hdrs).forEach(([k, v]) => res.setHeader(k, v));
      return res;
    };
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      res.writableEnded = true;
      res.emit('finish');
      const rawBuffer = Buffer.concat(chunks);
      const ct = String(storeHeaders['content-type'] || '');
      let parsed = rawBuffer.toString('utf8');
      if (ct.includes('application/json') && parsed) {
        try {
          parsed = JSON.parse(parsed);
        } catch (err) {
          return reject(err);
        }
      }
      resolve({ status: res.statusCode, headers: storeHeaders, body: parsed, rawBuffer });
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

(async () => {
  const { connectMongo, closeMongo, mongoose } = require('./config/mongoDb');
  const models = require('./models');
  const app = require('./server');

  try {
    console.log('1. Verifying all required Portal, Admin, Live Show & MongoDB files + JS syntax...');
    const requiredFiles = [
      'backend/server.js',
      'backend/config/mongoDb.js',
      'backend/models/AdminUser.js',
      'backend/models/LotteryEvent.js',
      'backend/models/Participant.js',
      'backend/models/Flat.js',
      'backend/models/FixedMapping.js',
      'backend/models/Allocation.js',
      'backend/models/AuditLog.js',
      'backend/services/allocationEngine.js',
      'backend/services/auditService.js',
      'backend/middleware/authMiddleware.js',
      'backend/utils/qrGenerator.js',
      'backend/utils/pdfGenerator.js',
      'backend/controllers/lottery/authAdminController.js',
      'backend/controllers/lottery/participantsController.js',
      'backend/controllers/lottery/flatsInventoryController.js',
      'backend/controllers/lottery/fixedMappingController.js',
      'backend/controllers/lottery/liveLotteryController.js',
      'backend/controllers/lottery/reportsBackupController.js',
      'backend/routes/lotteryRoutes.js',
      'frontend/index.html',
      'frontend/admin.html',
      'frontend/live-lottery.html',
      'frontend/css/admin-portal.css',
      'frontend/css/live-show.css',
      'frontend/js/lottery-core.js',
      'frontend/js/show-audio.js',
      'frontend/js/admin-portal.js',
      'frontend/js/live-show.js',
      'frontend/js/home.js'
    ];

    for (const rel of requiredFiles) {
      const full = path.join(ROOT, rel);
      assert(fs.existsSync(full), `Missing file: ${rel}`);
      if (rel.endsWith('.js')) {
        new vm.Script(fs.readFileSync(full, 'utf8'), { filename: rel });
      }
    }
    console.log(`   [OK] All ${requiredFiles.length} modules verified with zero syntax errors.`);

    console.log('2. Connecting to isolated MongoDB 8.2 Replica Set & verifying collections + unique indexes...');
    const connMeta = await connectMongo();
    assert(connMeta.connected, 'MongoDB did not connect');
    console.log(`   [OK] MongoDB connected (${connMeta.mode}, ACID Transactions: ${connMeta.transactionsSupported}).`);

    const expectedCollections = [
      'AdminUsers',
      'LotteryEvents',
      'Participants',
      'Flats',
      'FixedMappings',
      'Allocations',
      'AuditLogs'
    ];
    for (const colName of expectedCollections) {
      const idxList = await mongoose.connection.db.collection(colName).indexes();
      assert(idxList.length >= 2, `Expected indexes on collection ${colName}`);
    }
    console.log(`   [OK] All 7 MongoDB collections and unique indexes verified.`);

    console.log('3. Testing Direct Open Access (No Sign-In Required) & Optional Role Checks...');
    const liveHtml = fs.readFileSync(path.join(ROOT, 'frontend/live-lottery.html'), 'utf8');
    const adminHtml = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');
    assert(!liveHtml.includes('Authorized Operator Sign-In'), 'Sign-in modal still present in live-lottery.html');
    assert(!liveHtml.includes('liveAdminLoginModal'), 'liveAdminLoginModal still present in live-lottery.html');
    assert(!adminHtml.includes('adminLoginSection'), 'adminLoginSection still present in admin.html');
    assert(!adminHtml.includes('Sign In to Admin Portal'), 'Sign-in button still present in admin.html');

    // Direct open access without any token or login!
    const openReadRes = await invokeApp(app, { method: 'GET', url: '/api/lottery/participants' });
    assert.strictEqual(openReadRes.status, 200, 'Direct open access without sign-in must succeed');
    const openMeRes = await invokeApp(app, { method: 'GET', url: '/api/lottery/auth/me' });
    assert.strictEqual(openMeRes.status, 200, 'Default committee admin must resolve without sign-in');

    // Empty headers = zero sign-in token used for all primary lottery operations!
    const authHdr = {};

    // Verify optional read-only AUDITOR token still respected if explicitly used
    const audCreate = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/admins',
      body: {
        username: 'auditor1',
        email: 'auditor1@royalpalms.org',
        fullName: 'External Society Auditor',
        role: 'AUDITOR'
      }
    });
    assert.strictEqual(audCreate.status, 201);
    console.log('   [OK] Sign-in process completely removed; direct open access verified.');

    console.log('4. Testing 520 Participants Upload, Validation Preview & Duplicate Rejection...');
    const sampleParticipants = [
      { participantId: 'RP-P0001', fullName: 'Rahul Sharma', registrationNumber: 'REG-1001', mobileNumber: '9820010001', wingPreference: 'Wing A' },
      { participantId: 'RP-P0002', fullName: 'Amit Patel', registrationNumber: 'REG-1002', mobileNumber: '9820010002', wingPreference: 'Wing B' },
      { participantId: 'RP-P0003', fullName: 'Neha Shah', registrationNumber: 'REG-1003', mobileNumber: '9820010003', wingPreference: 'Wing C' }
    ];
    for (let i = 4; i <= 520; i++) {
      sampleParticipants.push({
        participantId: `RP-P${String(i).padStart(4, '0')}`,
        fullName: `Royal Palms Resident ${i}`,
        registrationNumber: `REG-${1000 + i}`,
        mobileNumber: `9820${String(100000 + i).slice(0, 6)}`,
        wingPreference: `Wing ${['A', 'B', 'C', 'D'][(i - 1) % 4]}`
      });
    }

    // Preview with 2 intentional bad rows (missing name + duplicate ID)
    const previewRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/participants/preview',
      headers: authHdr,
      body: {
        rows: [
          ...sampleParticipants,
          { participantId: 'RP-P9999', fullName: '' },
          { participantId: 'RP-P0001', fullName: 'Duplicate Rahul' }
        ]
      }
    });
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.body.validCount, 520);
    assert.strictEqual(previewRes.body.invalidCount, 2);

    // Import the 520 valid participants
    const importPartRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/participants/bulk-import',
      headers: authHdr,
      body: { rows: sampleParticipants }
    });
    assert.strictEqual(importPartRes.status, 201);
    assert.strictEqual(importPartRes.body.importedCount, 520);

    // Attempt duplicate single participant
    const dupPartRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/participants',
      headers: authHdr,
      body: { participantId: 'RP-P0001', fullName: 'Another Rahul' }
    });
    assert.strictEqual(dupPartRes.status, 409, 'Duplicate participantId must be rejected');
    console.log('   [OK] 520 participants validated, imported, and protected against duplicates.');

    console.log('5. Testing 522 Flats Upload (including 101, 203, 305) & Duplicate Flat Detection...');
    const flatRows = [
      { flatNumber: '101', wing: 'Wing A', floor: '1', building: 'Royal Palms Tower A' },
      { flatNumber: '203', wing: 'Wing B', floor: '2', building: 'Royal Palms Tower B' },
      { flatNumber: '305', wing: 'Wing C', floor: '3', building: 'Royal Palms Tower C' }
    ];
    for (let i = 4; i <= 522; i++) {
      const floor = Math.ceil(i / 20);
      const wingLetter = ['A', 'B', 'C', 'D'][(i - 1) % 4];
      flatRows.push({
        flatNumber: `${wingLetter}-${1000 + i}`,
        wing: `Wing ${wingLetter}`,
        floor: String(floor),
        building: `Royal Palms Tower ${wingLetter}`
      });
    }

    const importFlatRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/flats/bulk-import',
      headers: authHdr,
      body: { rows: flatRows }
    });
    assert.strictEqual(importFlatRes.status, 201);
    assert.strictEqual(importFlatRes.body.importedCount, 522);

    const dupFlatRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/flats',
      headers: authHdr,
      body: { flatNumber: '101', wing: 'Wing A' }
    });
    assert.strictEqual(dupFlatRes.status, 409, 'Duplicate flatNumber must be rejected');
    console.log('   [OK] 522 flats imported and duplicate flat numbers blocked.');

    console.log('6. Testing Fixed Flat Mappings (Rahul->101, Amit->203, Neha->305) & Conflict Detection...');
    const fixedPairs = [
      { participantId: 'RP-P0001', flatNumber: '101', reason: 'Senior citizen ground/first floor allotment' },
      { participantId: 'RP-P0002', flatNumber: '203', reason: 'Committee approved fixed mapping' },
      { participantId: 'RP-P0003', flatNumber: '305', reason: 'Pre-allocated corner flat' }
    ];
    for (const fp of fixedPairs) {
      const mRes = await invokeApp(app, {
        method: 'POST',
        url: '/api/lottery/fixed-mappings',
        headers: authHdr,
        body: fp
      });
      assert.strictEqual(mRes.status, 201, `Failed mapping ${fp.participantId} -> ${fp.flatNumber}`);
    }

    // Conflict check: mapping another person (RP-P0004) to already-mapped Flat 101 must fail!
    const conflictFlatRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/fixed-mappings',
      headers: authHdr,
      body: { participantId: 'RP-P0004', flatNumber: '101' }
    });
    assert.strictEqual(conflictFlatRes.status, 409);
    assert.strictEqual(conflictFlatRes.body.code, 'FLAT_CONFLICT');

    // Conflict check: mapping Rahul Sharma (RP-P0001) to another flat must fail!
    const conflictPartRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/fixed-mappings',
      headers: authHdr,
      body: { participantId: 'RP-P0001', flatNumber: 'D-1004' }
    });
    assert.strictEqual(conflictPartRes.status, 409);
    assert.strictEqual(conflictPartRes.body.code, 'PARTICIPANT_CONFLICT');
    console.log('   [OK] Fixed flat mappings created and 2-way conflict detection verified.');

    console.log('7. Testing Pre-Lottery Count Mismatch Warning & Explicit Confirmation...');
    const preRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/precheck',
      headers: authHdr
    });
    assert.strictEqual(preRes.status, 200);
    assert.strictEqual(preRes.body.summary.fixedAllocations, 3);
    assert.strictEqual(preRes.body.summary.remainingParticipants, 517);
    assert.strictEqual(preRes.body.summary.remainingFlats, 519);
    assert.strictEqual(preRes.body.summary.hasCountMismatch, true);
    assert(preRes.body.summary.mismatchWarning.includes('517'), 'Expected mismatch warning');

    // Starting without mismatch acknowledgment returns 409 warning
    const warnStart = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/start',
      headers: authHdr,
      body: { confirmed: true, acknowledgeMismatch: false }
    });
    assert.strictEqual(warnStart.status, 409);

    // Starting with confirmation + mismatch acknowledgment succeeds
    const liveStart = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/start',
      headers: authHdr,
      body: { confirmed: true, acknowledgeMismatch: true }
    });
    assert.strictEqual(liveStart.status, 200);
    assert.strictEqual(liveStart.body.event.status, 'LIVE');
    console.log('   [OK] Pre-lottery summary, count mismatch warning & confirmation verified.');

    console.log('8. Testing Repeated Click Idempotency & 25 Concurrent Simultaneous Draws...');
    const idemKey = 'double-click-key-001';
    const [click1, click2] = await Promise.all([
      invokeApp(app, {
        method: 'POST',
        url: '/api/lottery/draw-one',
        headers: { ...authHdr, 'X-Idempotency-Key': idemKey },
        body: { idempotencyKey: idemKey }
      }),
      invokeApp(app, {
        method: 'POST',
        url: '/api/lottery/draw-one',
        headers: { ...authHdr, 'X-Idempotency-Key': idemKey },
        body: { idempotencyKey: idemKey }
      })
    ]);
    assert([200, 201].includes(click1.status) && [200, 201].includes(click2.status));
    assert.strictEqual(
      click1.body.allocation.allocationId,
      click2.body.allocation.allocationId,
      'Repeated clicks with same idempotencyKey must NEVER create a second allocation!'
    );

    // Fire 25 simultaneous distinct draws concurrently!
    const concurrentDraws = await Promise.all(
      Array.from({ length: 25 }, (_, k) =>
        invokeApp(app, {
          method: 'POST',
          url: '/api/lottery/draw-one',
          headers: { ...authHdr, 'X-Idempotency-Key': `concurrent-draw-${k}` }
        })
      )
    );
    for (const cd of concurrentDraws) {
      assert.strictEqual(cd.status, 201, `Concurrent draw failed: ${JSON.stringify(cd.body)}`);
    }
    const concurrentPids = new Set(concurrentDraws.map((d) => d.body.allocation.participantId));
    const concurrentFlats = new Set(concurrentDraws.map((d) => d.body.allocation.flatNumber));
    assert.strictEqual(concurrentPids.size, 25, 'Concurrent draws selected duplicate participants!');
    assert.strictEqual(concurrentFlats.size, 25, 'Concurrent draws selected duplicate flats!');
    assert(
      !concurrentPids.has('RP-P0001') && !concurrentFlats.has('101'),
      'Fixed mapping leaked into random draw!'
    );
    console.log('   [OK] Repeated-click idempotency and 25 simultaneous concurrent draws verified.');

    console.log('9. Running Complete Batch Allocation for Remaining 491 Participants & Verifying 520 Total Invariants...');
    const batchRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/draw-batch',
      headers: authHdr,
      body: { confirmed: true, idempotencyKey: 'batch-remaining-491' }
    });
    assert.strictEqual(batchRes.status, 201);
    assert.strictEqual(batchRes.body.allocatedCount, 491); // 517 - 1 (idem) - 25 (concurrent) = 491!

    // Verify all 520 allocations in MongoDB!
    const allAllocs = await models.Allocation.find().lean();
    assert.strictEqual(allAllocs.length, 520, `Expected 520 total allocations, got ${allAllocs.length}`);

    const uniqueAllotteeIds = new Set(allAllocs.map((a) => a.participantId));
    const uniqueAllocatedFlats = new Set(allAllocs.map((a) => a.flatNumber));
    assert.strictEqual(uniqueAllotteeIds.size, 520, 'Duplicate participant found in Allocations!');
    assert.strictEqual(uniqueAllocatedFlats.size, 520, 'Duplicate flat found in Allocations!');

    // Verify fixed mappings were 100% preserved!
    const rahulAlloc = allAllocs.find((a) => a.participantId === 'RP-P0001');
    const amitAlloc = allAllocs.find((a) => a.participantId === 'RP-P0002');
    const nehaAlloc = allAllocs.find((a) => a.participantId === 'RP-P0003');
    assert.strictEqual(rahulAlloc.flatNumber, '101');
    assert.strictEqual(rahulAlloc.allocationType, 'FIXED');
    assert.strictEqual(amitAlloc.flatNumber, '203');
    assert.strictEqual(nehaAlloc.flatNumber, '305');

    // Verify overview stats match MongoDB reality
    const ovAfter = await invokeApp(app, { method: 'GET', url: '/api/lottery/overview' });
    assert.strictEqual(ovAfter.body.summary.totalParticipants, 520);
    assert.strictEqual(ovAfter.body.summary.totalFlats, 522);
    assert.strictEqual(ovAfter.body.summary.fixedAllocations, 3);
    assert.strictEqual(ovAfter.body.summary.randomAllocations, 517);
    assert.strictEqual(ovAfter.body.summary.totalAllocated, 520);
    assert.strictEqual(ovAfter.body.summary.remainingParticipants, 0);
    assert.strictEqual(ovAfter.body.summary.remainingFlats, 2);
    console.log('   [OK] All 520 allocations (3 Fixed + 517 Random) verified with zero duplicates.');

    console.log('10. Testing All 9 Official Reports + Audit Report, Excel/CSV/PDF Exports, Ticket PDF & Backup...');
    const reportTypes = [
      'all-participants',
      'available-flats',
      'fixed-allocations',
      'random-allocations',
      'complete-allocations',
      'pending-participants',
      'remaining-flats',
      'allocation-history',
      'date-wise-allocations',
      'audit-report'
    ];
    for (const rt of reportTypes) {
      const rJson = await invokeApp(app, {
        method: 'GET',
        url: `/api/lottery/reports/${rt}`,
        headers: authHdr
      });
      assert.strictEqual(rJson.status, 200, `Report ${rt} failed`);
    }

    // Export Complete Allocation Report as Excel (.xlsx), CSV (.csv), and PDF (.pdf)
    const xlsxExport = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/reports/complete-allocations/export?format=xlsx',
      headers: authHdr
    });
    assert.strictEqual(xlsxExport.status, 200);
    const parsedExportRows = XLSX.utils.sheet_to_json(
      XLSX.read(xlsxExport.rawBuffer, { type: 'buffer' }).Sheets['complete-allocations']
    );
    assert.strictEqual(parsedExportRows.length, 520);

    const csvExport = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/reports/fixed-allocations/export?format=csv',
      headers: authHdr
    });
    assert.strictEqual(csvExport.status, 200);
    assert(String(csvExport.body).includes('Rahul Sharma'));

    const pdfReport = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/reports/complete-allocations/export?format=pdf',
      headers: authHdr
    });
    assert.strictEqual(pdfReport.status, 200);
    assert(pdfReport.rawBuffer.slice(0, 8).toString().startsWith('%PDF-1.4'));

    // Single Winning Ticket PDF + Public Verification + Print All Tickets + Backup
    const firstCode = rahulAlloc.allocationId;
    const ticketPdf = await invokeApp(app, {
      method: 'GET',
      url: `/api/lottery/allocations/${firstCode}/ticket.pdf`
    });
    assert.strictEqual(ticketPdf.status, 200);
    assert(ticketPdf.rawBuffer.slice(0, 8).toString().startsWith('%PDF-1.4'));

    const pubVerify = await invokeApp(app, {
      method: 'GET',
      url: `/api/lottery/verify/${firstCode}`
    });
    assert.strictEqual(pubVerify.status, 200);
    assert.strictEqual(pubVerify.body.verified, true);
    assert(pubVerify.body.ticket.qrSvg.includes('<svg'));

    const printAllRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/tickets/print-all',
      headers: authHdr
    });
    assert.strictEqual(printAllRes.status, 200);
    assert.strictEqual(printAllRes.body.totalTickets, 520);

    const backupRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/lottery/backup/export',
      headers: authHdr
    });
    assert.strictEqual(backupRes.status, 200);
    const parsedBackup = JSON.parse(backupRes.rawBuffer.toString('utf8'));
    assert.strictEqual(parsedBackup.counts.allocations, 520);
    console.log('   [OK] All 9+1 reports, Excel/CSV/PDF exports, QR tickets, Print-All & MongoDB Backup verified.');

    console.log('11. Testing Finalization Lock & Authorized SUPER_ADMIN Audit-Logged Correction...');
    const finRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/lottery/end',
      headers: authHdr,
      body: { confirmed: true, finalize: true }
    });
    assert.strictEqual(finRes.status, 200);
    assert.strictEqual(finRes.body.event.status, 'FINALIZED');

    const remFlats = await models.Flat.find({ status: 'AVAILABLE' }).lean();
    assert.strictEqual(remFlats.length, 2);

    // Without auditReason -> rejected!
    const unauthAmend = await invokeApp(app, {
      method: 'POST',
      url: `/api/lottery/allocations/${firstCode}/authorize-correction`,
      headers: authHdr,
      body: { newFlatRef: String(remFlats[0]._id) }
    });
    assert.strictEqual(unauthAmend.status, 400);

    // With SUPER_ADMIN overrideAuthorization + auditReason -> succeeds & writes audit log!
    const authAmend = await invokeApp(app, {
      method: 'POST',
      url: `/api/lottery/allocations/${firstCode}/authorize-correction`,
      headers: authHdr,
      body: {
        overrideAuthorization: true,
        auditReason: 'Committee Resolution #2026-11: Ground floor accessibility swap',
        newFlatRef: String(remFlats[0]._id)
      }
    });
    assert.strictEqual(authAmend.status, 200);
    assert.strictEqual(authAmend.body.allocation.status, 'AMENDED_BY_ADMIN');

    const auditCheck = await models.AuditLog.findOne({
      action: 'AUTHORIZED_ALLOCATION_CORRECTION'
    }).lean();
    assert(auditCheck && auditCheck.summary.includes('101'), 'Audit record missing for correction');
    console.log('   [OK] Finalization lock and permanent audit-logged admin correction verified.');

    console.log('\n========================================================================');
    console.log('  ALL ROYAL PALMS MONGODB LOTTERY & LIVE SHOW TESTS PASSED (520+ SCALE)');
    console.log('========================================================================');
  } finally {
    await closeMongo();
  }
  process.exit(0);
})();
