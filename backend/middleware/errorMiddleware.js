/**
 * 404 handler for unknown API routes.
 */
function notFoundHandler(req, res, next) {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
  }
  return next();
}

/**
 * Centralized error handler. Never leaks database credentials or sensitive stack traces.
 */
function errorHandler(err, req, res, _next) {
  console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err.message);

  if (err.code === 'DB_CONFIG_MISSING' || err.code === 'DB_CONNECTION_FAILED') {
    return res.status(503).json({
      success: false,
      code: err.code,
      message:
        'SQL Server database is not connected yet. Please verify your .env database settings and ensure SQL Server is running.',
      details: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }

  if (err.code === 'MONGODB_CONNECTION_FAILED') {
    return res.status(503).json({
      success: false,
      code: err.code,
      message: 'MongoDB database is not reachable. Verify MONGODB_URI in .env or ensure MongoDB is running.',
      details: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }

  // MongoDB duplicate key constraint violation (E11000) or SQL Server (2601 / 2627)
  if (err.code === 11000 || err.number === 2601 || err.number === 2627) {
    const keyField = err.keyValue ? Object.keys(err.keyValue).join(', ') : 'unique field';
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_RECORD',
      message: `Duplicate value rejected by unique index (${keyField}). Duplicate allocations or IDs are strictly prohibited.`
    });
  }

  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.statusCode ? err.message : 'An unexpected server error occurred.'
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
