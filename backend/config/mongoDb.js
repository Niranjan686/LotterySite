const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const models = require('../models');

let connectPromise = null;
let embeddedReplSet = null;
let embeddedServer = null;
let activeConnectionMeta = {
  connected: false,
  mode: 'disconnected', // 'uri' | 'local-service' | 'embedded-replset' | 'embedded-standalone'
  uri: null,
  dbName: 'royal_palms_lottery',
  transactionsSupported: false,
  error: null
};

function findCachedMongodBinary() {
  const candidates = [
    process.env.MONGOD_SYSTEM_BINARY,
    path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-8.2.6.exe')
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch (_) {}
  }

  // Also scan ~/.cache/mongodb-binaries for any mongod*.exe / mongod* binary
  try {
    const cacheDir = path.join(os.homedir(), '.cache', 'mongodb-binaries');
    if (fs.existsSync(cacheDir)) {
      const files = fs
        .readdirSync(cacheDir)
        .filter((f) => f.startsWith('mongod') && !f.endsWith('.md5') && !f.endsWith('.lock'));
      if (files.length > 0) {
        return path.join(cacheDir, files[0]);
      }
    }
  } catch (_) {}

  return undefined;
}

async function detectTransactionSupport() {
  try {
    const adminDb = mongoose.connection.db.admin();
    const hello = await adminDb.command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch (_) {
    return false;
  }
}

async function ensureIndexesAndSeedDefaults() {
  const {
    AdminUser,
    LotteryEvent,
    Participant,
    Flat,
    FixedMapping,
    Allocation,
    AuditLog
  } = models;

  await Promise.all([
    AdminUser.createIndexes(),
    LotteryEvent.createIndexes(),
    Participant.createIndexes(),
    Flat.createIndexes(),
    FixedMapping.createIndexes(),
    Allocation.createIndexes(),
    AuditLog.createIndexes()
  ]);

  // 1. Seed initial Super Admin ONLY if AdminUsers is empty
  const adminCount = await AdminUser.countDocuments();
  let primaryAdmin = null;
  if (adminCount === 0) {
    const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim().toLowerCase();
    const defaultEmail = (
      process.env.ADMIN_DEFAULT_EMAIL || 'committee.admin@royalpalms.org'
    )
      .trim()
      .toLowerCase();
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'RoyalPalms@2026';
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    primaryAdmin = await AdminUser.create({
      username: defaultUsername,
      email: defaultEmail,
      fullName: 'Chief Lottery Administrator',
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true
    });

    await AuditLog.create({
      action: 'BOOTSTRAP_SUPER_ADMIN',
      entityType: 'ADMIN_USER',
      entityId: String(primaryAdmin._id),
      actorId: primaryAdmin._id,
      actorUsername: primaryAdmin.username,
      actorRole: primaryAdmin.role,
      summary: `Initialized default SUPER_ADMIN account (${primaryAdmin.username}).`
    });
  } else {
    primaryAdmin = await AdminUser.findOne({ role: 'SUPER_ADMIN' }).sort({ createdAt: 1 });
  }

  // 2. Ensure primary Royal Palms LotteryEvent exists
  let event = await LotteryEvent.findOne().sort({ createdAt: 1 });
  if (!event) {
    event = await LotteryEvent.create({
      eventCode: 'RP-EVENT-2026',
      eventName: 'Royal Palms Grand Flat Allocation',
      societyName: 'Royal Palms Co-operative Housing Society',
      societyAddress: 'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706',
      registrationNo: 'MUM/CHS/RP-2026',
      committeeName: 'Royal Palms Managing & Allotment Committee',
      contactPhone: '+91 98200 12345',
      status: 'DRAFT'
    });

    await AuditLog.create({
      eventId: event._id,
      action: 'LOTTERY_EVENT_INITIALIZED',
      entityType: 'LOTTERY_EVENT',
      entityId: String(event._id),
      actorId: primaryAdmin?._id || null,
      actorUsername: primaryAdmin?.username || 'system',
      actorRole: primaryAdmin?.role || 'SYSTEM',
      summary: `Initialized lottery event "${event.eventName}" (${event.eventCode}).`
    });
  }

  return { primaryAdmin, event };
}

async function startEmbeddedMongo({ isolatedTest = false } = {}) {
  const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');
  const systemBinary = findCachedMongodBinary();
  const binaryOpts = systemBinary ? { systemBinary } : {};

  if (isolatedTest) {
    embeddedReplSet = await MongoMemoryReplSet.create({
      binary: binaryOpts,
      replSet: { count: 1, storageEngine: 'wiredTiger', dbName: 'royal_palms_lottery_test' }
    });
    return {
      uri: embeddedReplSet.getUri('royal_palms_lottery_test'),
      mode: 'embedded-replset-test'
    };
  }

  const persistentDir = path.resolve(__dirname, '../data/mongodb_rs');
  if (!fs.existsSync(persistentDir)) {
    fs.mkdirSync(persistentDir, { recursive: true });
  }

  try {
    embeddedReplSet = await MongoMemoryReplSet.create({
      binary: binaryOpts,
      instanceOpts: [
        {
          dbPath: persistentDir,
          storageEngine: 'wiredTiger'
        }
      ],
      replSet: {
        name: 'rpLotteryRs',
        count: 1,
        storageEngine: 'wiredTiger',
        dbName: 'royal_palms_lottery'
      }
    });
    return {
      uri: embeddedReplSet.getUri('royal_palms_lottery'),
      mode: 'embedded-replset'
    };
  } catch (_) {
    // Fallback to standalone persistent WiredTiger instance if ReplSet lock file exists
    const standaloneDir = path.resolve(__dirname, '../data/mongodb_standalone');
    if (!fs.existsSync(standaloneDir)) {
      fs.mkdirSync(standaloneDir, { recursive: true });
    }
    embeddedServer = await MongoMemoryServer.create({
      binary: binaryOpts,
      instance: {
        dbPath: standaloneDir,
        storageEngine: 'wiredTiger',
        dbName: 'royal_palms_lottery'
      }
    });
    return {
      uri: embeddedServer.getUri('royal_palms_lottery'),
      mode: 'embedded-standalone'
    };
  }
}

/**
 * Connects Mongoose to MongoDB (external MONGODB_URI -> local 27017 -> persistent embedded mongod).
 */
async function connectMongo() {
  if (mongoose.connection.readyState === 1 && activeConnectionMeta.connected) {
    return activeConnectionMeta;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      const isolatedTest = process.env.LOTTERY_TEST_ISOLATED === 'true';
      const explicitUri = (process.env.MONGODB_URI || '').trim();
      const defaultLocalUri = 'mongodb://127.0.0.1:27017/royal_palms_lottery';

      let chosenUri = null;
      let chosenMode = 'uri';

      if (isolatedTest) {
        const started = await startEmbeddedMongo({ isolatedTest: true });
        chosenUri = started.uri;
        chosenMode = started.mode;
        await mongoose.connect(chosenUri, { serverSelectionTimeoutMS: 8000 });
      } else if (explicitUri) {
        chosenUri = explicitUri;
        chosenMode = 'configured-uri';
        await mongoose.connect(chosenUri, { serverSelectionTimeoutMS: 5000 });
      } else {
        try {
          await mongoose.connect(defaultLocalUri, { serverSelectionTimeoutMS: 1800 });
          chosenUri = defaultLocalUri;
          chosenMode = 'local-mongodb-service';
        } catch (_) {
          if (process.env.MONGODB_AUTO_EMBEDDED === 'false') {
            throw new Error(
              'Could not connect to mongodb://127.0.0.1:27017/royal_palms_lottery. Start MongoDB or set MONGODB_URI in .env.'
            );
          }
          const started = await startEmbeddedMongo({ isolatedTest: false });
          chosenUri = started.uri;
          chosenMode = started.mode;
          await mongoose.connect(chosenUri, { serverSelectionTimeoutMS: 10000 });
        }
      }

      const txSupported = await detectTransactionSupport();
      await ensureIndexesAndSeedDefaults();

      activeConnectionMeta = {
        connected: true,
        mode: chosenMode,
        uri: chosenUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'),
        dbName: mongoose.connection.name || 'royal_palms_lottery',
        transactionsSupported: txSupported,
        error: null
      };

      return activeConnectionMeta;
    } catch (err) {
      connectPromise = null;
      activeConnectionMeta = {
        connected: false,
        mode: 'error',
        uri: null,
        dbName: 'royal_palms_lottery',
        transactionsSupported: false,
        error: err.message
      };
      const wrapped = new Error(`MongoDB connection failed: ${err.message}`);
      wrapped.code = 'MONGODB_CONNECTION_FAILED';
      throw wrapped;
    }
  })();

  return connectPromise;
}

/**
 * Executes `workFn(session)` inside a MongoDB ACID transaction when connected to a Replica Set / Atlas,
 * or executes `workFn(null)` directly on standalone single-node mongod (where atomic findOneAndUpdate + unique indexes apply).
 */
async function runInMongoTransaction(workFn) {
  await connectMongo();
  if (!activeConnectionMeta.transactionsSupported) {
    return workFn(null);
  }

  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      output = await workFn(session);
    });
    return output;
  } finally {
    await session.endSession();
  }
}

async function checkMongoHealth() {
  try {
    const meta = await connectMongo();
    await mongoose.connection.db.admin().ping();
    return {
      connected: true,
      engine: 'MongoDB',
      mode: meta.mode,
      database: mongoose.connection.name,
      transactionsSupported: meta.transactionsSupported,
      error: null
    };
  } catch (err) {
    return {
      connected: false,
      engine: 'MongoDB',
      mode: activeConnectionMeta.mode,
      database: 'royal_palms_lottery',
      transactionsSupported: false,
      code: err.code || 'MONGODB_ERROR',
      error: err.message
    };
  }
}

async function closeMongo() {
  connectPromise = null;
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (_) {}

  if (embeddedReplSet) {
    try {
      await embeddedReplSet.stop();
    } catch (_) {}
    embeddedReplSet = null;
  }

  if (embeddedServer) {
    try {
      await embeddedServer.stop();
    } catch (_) {}
    embeddedServer = null;
  }

  activeConnectionMeta.connected = false;
  activeConnectionMeta.mode = 'disconnected';
}

module.exports = {
  mongoose,
  connectMongo,
  runInMongoTransaction,
  checkMongoHealth,
  closeMongo,
  getConnectionMeta: () => ({ ...activeConnectionMeta })
};
