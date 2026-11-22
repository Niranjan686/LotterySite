const bcrypt = require('bcryptjs');
const { connectMongo } = require('../../config/mongoDb');
const { AdminUser, LotteryEvent } = require('../../models');
const { signAdminToken } = require('../../middleware/authMiddleware');
const { recordAudit } = require('../../services/auditService');
const { cleanString } = require('../../middleware/validateMiddleware');

function sanitizeAdmin(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    username: doc.username,
    email: doc.email,
    fullName: doc.fullName,
    role: doc.role,
    isActive: doc.isActive,
    lastLoginAt: doc.lastLoginAt,
    createdAt: doc.createdAt
  };
}

async function getPrimaryEvent() {
  await connectMongo();
  return LotteryEvent.findOne().sort({ createdAt: 1 });
}

/**
 * POST /api/lottery/auth/login
 */
async function loginAdmin(req, res, next) {
  try {
    await connectMongo();
    const identifier = cleanString(req.body.username || req.body.email || '', 120).toLowerCase();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Username/email and password are required.'
      });
    }

    const admin = await AdminUser.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid administrator credentials or inactive account.'
      });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      await recordAudit({
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'ADMIN_USER',
        entityId: String(admin._id),
        req,
        summary: `Failed login attempt for username "${admin.username}".`
      });
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid administrator credentials.'
      });
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const event = await getPrimaryEvent();
    await recordAudit({
      eventId: event?._id || null,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'ADMIN_USER',
      entityId: String(admin._id),
      actor: admin,
      req,
      summary: `Admin "${admin.username}" (${admin.role}) signed in.`
    });

    const token = signAdminToken(admin);
    return res.json({
      success: true,
      message: `Welcome back, ${admin.fullName}!`,
      token,
      admin: sanitizeAdmin(admin)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/auth/me
 */
async function getCurrentAdmin(req, res) {
  return res.json({
    success: true,
    admin: sanitizeAdmin(req.admin)
  });
}

/**
 * POST /api/lottery/auth/change-password
 */
async function changeOwnPassword(req, res, next) {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.'
      });
    }

    const valid = await bcrypt.compare(currentPassword, req.admin.passwordHash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.'
      });
    }

    req.admin.passwordHash = await bcrypt.hash(newPassword, 12);
    await req.admin.save();

    const event = await getPrimaryEvent();
    await recordAudit({
      eventId: event?._id || null,
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'ADMIN_USER',
      entityId: String(req.admin._id),
      actor: req.admin,
      req,
      summary: `Admin "${req.admin.username}" updated their password.`
    });

    return res.json({
      success: true,
      message: 'Password updated successfully.'
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/lottery/admins
 */
async function listAdminUsers(_req, res, next) {
  try {
    await connectMongo();
    const users = await AdminUser.find().sort({ createdAt: 1 });
    return res.json({
      success: true,
      admins: users.map(sanitizeAdmin)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/lottery/admins (SUPER_ADMIN only)
 */
async function createAdminUser(req, res, next) {
  try {
    await connectMongo();
    const username = cleanString(req.body.username || '', 60).toLowerCase();
    const email = cleanString(req.body.email || '', 120).toLowerCase();
    const fullName = cleanString(req.body.fullName || '', 120);
    const password = String(req.body.password || 'RoyalPalms@2026');
    const role = ['SUPER_ADMIN', 'LOTTERY_OPERATOR', 'AUDITOR'].includes(req.body.role)
      ? req.body.role
      : 'LOTTERY_OPERATOR';

    if (!username || username.length < 3 || !email || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Username (min 3 chars), full name, and email are required.'
      });
    }

    const dup = await AdminUser.findOne({ $or: [{ username }, { email }] });
    if (dup) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_ADMIN',
        message: 'An admin user with that username or email already exists.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await AdminUser.create({
      username,
      email,
      fullName,
      passwordHash,
      role,
      isActive: true,
      createdBy: req.admin._id
    });

    const event = await getPrimaryEvent();
    await recordAudit({
      eventId: event?._id || null,
      action: 'ADMIN_USER_CREATED',
      entityType: 'ADMIN_USER',
      entityId: String(created._id),
      actor: req.admin,
      req,
      summary: `Created admin user "${created.username}" with role ${created.role}.`,
      metadata: { username: created.username, email: created.email, role: created.role }
    });

    return res.status(201).json({
      success: true,
      message: `Admin user "${created.username}" (${created.role}) created.`,
      admin: sanitizeAdmin(created)
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/lottery/admins/:id (SUPER_ADMIN only)
 */
async function updateAdminUser(req, res, next) {
  try {
    await connectMongo();
    const target = await AdminUser.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    const nextRole =
      req.body.role && ['SUPER_ADMIN', 'LOTTERY_OPERATOR', 'AUDITOR'].includes(req.body.role)
        ? req.body.role
        : target.role;
    const nextActive =
      req.body.isActive !== undefined ? Boolean(req.body.isActive) : target.isActive;

    // Prevent deactivating or demoting the last active SUPER_ADMIN
    if (target.role === 'SUPER_ADMIN' && (nextRole !== 'SUPER_ADMIN' || !nextActive)) {
      const otherSuperCount = await AdminUser.countDocuments({
        _id: { $ne: target._id },
        role: 'SUPER_ADMIN',
        isActive: true
      });
      if (otherSuperCount === 0) {
        return res.status(409).json({
          success: false,
          code: 'LAST_SUPER_ADMIN',
          message: 'Cannot deactivate or demote the last active SUPER_ADMIN account.'
        });
      }
    }

    if (req.body.fullName) target.fullName = cleanString(req.body.fullName, 120);
    if (req.body.email) target.email = cleanString(req.body.email, 120).toLowerCase();
    target.role = nextRole;
    target.isActive = nextActive;

    if (req.body.newPassword && String(req.body.newPassword).length >= 8) {
      target.passwordHash = await bcrypt.hash(String(req.body.newPassword), 12);
    }

    await target.save();

    const event = await getPrimaryEvent();
    await recordAudit({
      eventId: event?._id || null,
      action: 'ADMIN_USER_UPDATED',
      entityType: 'ADMIN_USER',
      entityId: String(target._id),
      actor: req.admin,
      req,
      summary: `Updated admin user "${target.username}" (role: ${target.role}, active: ${target.isActive}).`
    });

    return res.json({
      success: true,
      message: `Admin user "${target.username}" updated.`,
      admin: sanitizeAdmin(target)
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getPrimaryEvent,
  loginAdmin,
  getCurrentAdmin,
  changeOwnPassword,
  listAdminUsers,
  createAdminUser,
  updateAdminUser
};
