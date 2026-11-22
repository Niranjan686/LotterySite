const { validationResult } = require('express-validator');

/**
 * Express middleware that checks express-validator results and halts with 400 on invalid input.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: e.path || e.param,
      message: e.msg
    }));
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: formatted[0].message,
      errors: formatted
    });
  }
  return next();
}

/**
 * Trims and removes control characters from user strings.
 */
function cleanString(value, maxLength = 255) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalizes flat numbers (e.g. " a - 101 " -> "A-101") for consistent duplicate checks.
 */
function normalizeFlatNumber(value) {
  return cleanString(value, 50)
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .toUpperCase();
}

module.exports = {
  handleValidationErrors,
  cleanString,
  normalizeFlatNumber
};
