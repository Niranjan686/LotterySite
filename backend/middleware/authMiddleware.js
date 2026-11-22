const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { connectMongo } = require('../config/mongoDb');
const { AdminUser } = require('../models');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'royal-palms-jwt-secret-key-2026-change-in-production';
}

function signAdminToken(adminUser) {
  return jwt.sign(
    {
      sub: String(adminUser._id),
      username: adminUser.username,
      role: adminUser.role,
      fullName: adminUser.fullName
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

function extractToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.query && typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

async function getOrCreateDefaultAdmin() {
  let admin = await AdminUser.findOne({ role: 'SUPER_ADMIN', isActive: true }).sort({
    createdAt: 1
  });
  if (!admin) {
    admin = await AdminUser.findOne({ isActive: true }).sort({ createdAt: 1 });
  }
  if (!admin) {
    const passwordHash = await bcrypt.hash('RoyalPalms@2026', 10);
    admin = await AdminUser.create({
      username: 'admin',
      email: 'committee.admin@royalpalms.org',
      fullName: 'Royal Palms Lottery Committee',
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true
    });
  }
  return admin;
}

/**
 * Direct Open Access Middleware (No Sign-In Required):
 * Automatically resolves the default committee SUPER_ADMIN when no token is supplied,
 * while still honoring explicit operator/auditor tokens if provided.
 */
async function requireAuth(req, _res, next) {
  try {
    await connectMongo();
    const token = extractToken(req);

    if (token) {
      try {
        const decoded = jwt.verify(token, getJwtSecret());
        const found = await AdminUser.findById(decoded.sub);
        if (found && found.isActive) {
          req.admin = found;
          return next();
        }
      } catch (_) {
        // Fall through to default committee admin when no sign-in is used
      }
    }

    req.admin = await getOrCreateDefaultAdmin();
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Role check middleware (default open-access admin has SUPER_ADMIN role).
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) {
      return next();
    }
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}.`
      });
    }
    return next();
  };
}

module.exports = {
  signAdminToken,
  extractToken,
  requireAuth,
  requireRole
};
