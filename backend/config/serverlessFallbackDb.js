/**
 * Zero-Config Serverless Document Store Fallback (for Vercel Serverless / Cloud Preview
 * deployments when an external MONGODB_URI is not yet configured).
 *
 * Persists collections to /tmp/royal_palms_serverless_db.json across warm invocations
 * and implements the Mongoose Model query/mutation interface used by all controllers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const STORE_FILE = path.join(os.tmpdir(), 'royal_palms_serverless_db.json');

const MODEL_DEFAULTS = {
  AdminUser: () => ({
    role: 'SUPER_ADMIN',
    isActive: true,
    lastLoginAt: null
  }),
  LotteryEvent: () => ({
    eventCode: 'RP-EVENT-2026',
    eventName: 'Royal Palms Grand Flat Allocation',
    societyName: 'Royal Palms Co-operative Housing Society',
    societyAddress: 'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706',
    registrationNo: 'MUM/CHS/RP-2026',
    committeeName: 'Royal Palms Managing & Allotment Committee',
    contactPhone: '+91 98200 12345',
    societyLogo: 'assets/images/logo.svg',
    status: 'DRAFT',
    config: {
      countdownSeconds: 3,
      nameRevealDurationMs: 2800,
      flatRevealDurationMs: 2400,
      soundEnabled: true,
      confettiEnabled: true,
      musicVolume: 0.45,
      sfxVolume: 0.85,
      ticketPrefix: 'RP'
    },
    allocationSequenceCounter: 0,
    startedAt: null,
    completedAt: null,
    finalizedAt: null
  }),
  Participant: () => ({
    registrationNumber: '',
    mobileNumber: '',
    wingPreference: '',
    notes: '',
    isEligible: true,
    allocationStatus: 'PENDING',
    allocatedFlatRef: null,
    allocatedFlatNumber: null,
    allocationId: null,
    allocationType: null,
    allocatedAt: null
  }),
  Flat: () => ({
    wing: '',
    floor: '',
    building: '',
    notes: '',
    sequenceOrder: 0,
    isAvailableForLottery: true,
    status: 'AVAILABLE',
    allocatedParticipantRef: null,
    allocatedParticipantId: null,
    allocatedParticipantName: null,
    allocationId: null,
    allocationType: null,
    allocatedAt: null
  }),
  FixedMapping: () => ({
    wing: '',
    floor: '',
    building: '',
    reason: 'Pre-approved fixed flat assignment'
  }),
  Allocation: () => ({
    registrationNumber: '',
    mobileNumber: '',
    wing: '',
    floor: '',
    building: '',
    status: 'SUCCESSFULLY_ALLOCATED',
    allocatedAt: new Date()
  }),
  AuditLog: () => ({
    entityType: 'SYSTEM',
    entityId: '',
    actorUsername: 'admin',
    actorRole: 'SUPER_ADMIN',
    ipAddress: '127.0.0.1',
    metadata: {}
  })
};

let memoryStore = {
  AdminUser: [],
  LotteryEvent: [],
  Participant: [],
  Flat: [],
  FixedMapping: [],
  Allocation: [],
  AuditLog: []
};

function loadFromDisk() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const k of Object.keys(memoryStore)) {
          if (Array.isArray(raw[k])) {
            memoryStore[k] = raw[k];
          }
        }
      }
    }
  } catch (_) {}
}

function saveToDisk() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryStore), 'utf8');
  } catch (_) {}
}

function valEquals(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

function matchesCondition(docVal, cond) {
  if (cond instanceof RegExp) {
    return cond.test(String(docVal ?? ''));
  }
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !cond._bsontype) {
    if ('$exists' in cond) {
      const ex = docVal !== undefined;
      if (Boolean(cond.$exists) !== ex) return false;
    }
    if ('$in' in cond && Array.isArray(cond.$in)) {
      if (!cond.$in.some((item) => valEquals(docVal, item))) return false;
    }
    if ('$nin' in cond && Array.isArray(cond.$nin)) {
      if (cond.$nin.some((item) => valEquals(docVal, item))) return false;
    }
    if ('$ne' in cond) {
      if (valEquals(docVal, cond.$ne)) return false;
    }
    if ('$gte' in cond) {
      const d1 = new Date(docVal).getTime();
      const d2 = new Date(cond.$gte).getTime();
      if (Number.isNaN(d1) || d1 < d2) return false;
    }
    if ('$lte' in cond) {
      const d1 = new Date(docVal).getTime();
      const d2 = new Date(cond.$lte).getTime();
      if (Number.isNaN(d1) || d1 > d2) return false;
    }
    return true;
  }
  return valEquals(docVal, cond);
}

function matchesFilter(doc, filter = {}) {
  if (!filter || typeof filter !== 'object') return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (!matchesCondition(doc[key], cond)) return false;
  }
  return true;
}

function wrapDoc(modelName, rawDoc) {
  if (!rawDoc) return null;
  Object.defineProperty(rawDoc, 'toObject', {
    enumerable: false,
    configurable: true,
    value() {
      return JSON.parse(JSON.stringify(rawDoc));
    }
  });
  Object.defineProperty(rawDoc, 'save', {
    enumerable: false,
    configurable: true,
    async value() {
      rawDoc.updatedAt = new Date();
      const col = memoryStore[modelName];
      const idx = col.findIndex((d) => valEquals(d._id, rawDoc._id));
      if (idx >= 0) {
        col[idx] = rawDoc;
      } else {
        col.push(rawDoc);
      }
      saveToDisk();
      return rawDoc;
    }
  });
  return rawDoc;
}

function createQueryChain(modelName, filter, projection, isSingle = false) {
  let sortSpec = null;
  let skipCount = 0;
  let limitCount = null;
  let isLean = false;

  const exec = async () => {
    const col = memoryStore[modelName] || [];
    let list = col.filter((d) => matchesFilter(d, filter));

    if (sortSpec && typeof sortSpec === 'object') {
      const entries = Object.entries(sortSpec);
      list = [...list].sort((a, b) => {
        for (const [field, dir] of entries) {
          const av = a[field];
          const bv = b[field];
          if (valEquals(av, bv)) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv), undefined, { numeric: true });
          return dir < 0 ? -cmp : cmp;
        }
        return 0;
      });
    }

    if (skipCount > 0) {
      list = list.slice(skipCount);
    }
    if (limitCount !== null) {
      list = list.slice(0, limitCount);
    }

    const projectDoc = (d) => {
      const copy = isLean ? JSON.parse(JSON.stringify(d)) : wrapDoc(modelName, d);
      if (projection && typeof projection === 'object') {
        const keys = Object.keys(projection);
        if (keys.length > 0 && projection[keys[0]] === 0) {
          const clone = { ...copy };
          for (const k of keys) {
            if (projection[k] === 0) delete clone[k];
          }
          return clone;
        }
      }
      return copy;
    };

    if (isSingle) {
      return list[0] ? projectDoc(list[0]) : null;
    }
    return list.map(projectDoc);
  };

  const chain = {
    sort(spec) {
      sortSpec = spec;
      return chain;
    },
    skip(n) {
      skipCount = Number(n) || 0;
      return chain;
    },
    limit(n) {
      limitCount = Number(n) || 0;
      return chain;
    },
    lean() {
      isLean = true;
      return chain;
    },
    exec,
    then(onFulfilled, onRejected) {
      return exec().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return exec().catch(onRejected);
    }
  };

  return chain;
}

function applyUpdateToDoc(doc, update = {}) {
  if (update.$set && typeof update.$set === 'object') {
    Object.assign(doc, update.$set);
  }
  if (update.$inc && typeof update.$inc === 'object') {
    for (const [k, delta] of Object.entries(update.$inc)) {
      doc[k] = (Number(doc[k]) || 0) + Number(delta);
    }
  }
  for (const [k, v] of Object.entries(update)) {
    if (!k.startsWith('$')) {
      doc[k] = v;
    }
  }
  doc.updatedAt = new Date();
}

function buildNewDoc(modelName, payload = {}) {
  const defaults = MODEL_DEFAULTS[modelName] ? MODEL_DEFAULTS[modelName]() : {};
  const now = new Date();
  const doc = {
    _id: payload._id || new mongoose.Types.ObjectId().toString(),
    ...defaults,
    ...payload,
    createdAt: payload.createdAt || now,
    updatedAt: payload.updatedAt || now
  };
  if (modelName === 'Participant' && doc.participantId) {
    doc.participantId = String(doc.participantId).trim().toUpperCase();
  }
  if (modelName === 'Flat' && doc.flatNumber) {
    doc.flatNumber = String(doc.flatNumber).trim().toUpperCase();
  }
  if (modelName === 'Allocation' && doc.allocationId) {
    doc.allocationId = String(doc.allocationId).trim().toUpperCase();
  }
  return wrapDoc(modelName, doc);
}

function attachModelAdapter(modelName, mongooseModel) {
  mongooseModel.createIndexes = async () => true;

  mongooseModel.countDocuments = async (filter = {}) => {
    const col = memoryStore[modelName] || [];
    return col.filter((d) => matchesFilter(d, filter)).length;
  };

  mongooseModel.find = (filter = {}, projection = null) =>
    createQueryChain(modelName, filter, projection, false);

  mongooseModel.findOne = (filter = {}, projection = null) =>
    createQueryChain(modelName, filter, projection, true);

  mongooseModel.findById = (id, projection = null) =>
    createQueryChain(modelName, { _id: id }, projection, true);

  mongooseModel.create = async (docOrArray) => {
    const col = memoryStore[modelName];
    if (Array.isArray(docOrArray)) {
      const created = docOrArray.map((item) => {
        const d = buildNewDoc(modelName, item);
        col.push(d);
        return d;
      });
      saveToDisk();
      return created;
    }
    const d = buildNewDoc(modelName, docOrArray);
    col.push(d);
    saveToDisk();
    return d;
  };

  mongooseModel.insertMany = async (docs = []) => {
    const col = memoryStore[modelName];
    const created = docs.map((item) => {
      const d = buildNewDoc(modelName, item);
      col.push(d);
      return d;
    });
    saveToDisk();
    return created;
  };

  mongooseModel.findOneAndUpdate = async (filter = {}, update = {}) => {
    const col = memoryStore[modelName];
    const target = col.find((d) => matchesFilter(d, filter));
    if (!target) return null;
    applyUpdateToDoc(target, update);
    saveToDisk();
    return wrapDoc(modelName, target);
  };

  mongooseModel.findByIdAndUpdate = async (id, update = {}) =>
    mongooseModel.findOneAndUpdate({ _id: id }, update);

  mongooseModel.updateOne = async (filter = {}, update = {}) => {
    const col = memoryStore[modelName];
    const target = col.find((d) => matchesFilter(d, filter));
    if (!target) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdateToDoc(target, update);
    saveToDisk();
    return { matchedCount: 1, modifiedCount: 1 };
  };

  mongooseModel.updateMany = async (filter = {}, update = {}) => {
    const col = memoryStore[modelName];
    let count = 0;
    for (const d of col) {
      if (matchesFilter(d, filter)) {
        applyUpdateToDoc(d, update);
        count += 1;
      }
    }
    if (count > 0) saveToDisk();
    return { matchedCount: count, modifiedCount: count };
  };

  mongooseModel.deleteOne = async (filter = {}) => {
    const col = memoryStore[modelName];
    const idx = col.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) return { deletedCount: 0 };
    col.splice(idx, 1);
    saveToDisk();
    return { deletedCount: 1 };
  };

  mongooseModel.deleteMany = async (filter = {}) => {
    const col = memoryStore[modelName];
    const before = col.length;
    memoryStore[modelName] = col.filter((d) => !matchesFilter(d, filter));
    const deletedCount = before - memoryStore[modelName].length;
    if (deletedCount > 0) saveToDisk();
    return { deletedCount };
  };

  mongooseModel.bulkWrite = async (ops = []) => {
    let modifiedCount = 0;
    for (const op of ops) {
      if (op.updateOne) {
        const res = await mongooseModel.updateOne(op.updateOne.filter, op.updateOne.update);
        modifiedCount += res.modifiedCount;
      }
    }
    return { modifiedCount };
  };
}

let activated = false;

function activateServerlessFallback(models) {
  if (activated) return;
  loadFromDisk();
  for (const [name, modelObj] of Object.entries(models)) {
    if (memoryStore[name]) {
      attachModelAdapter(name, modelObj);
    }
  }
  activated = true;
}

module.exports = {
  activateServerlessFallback,
  isServerlessFallbackActive: () => activated
};
