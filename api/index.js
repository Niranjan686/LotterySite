/**
 * Vercel Serverless Function Entry Point (/api/*)
 * Routes all /api/* requests to the Royal Palms Express + MongoDB backend.
 */
const app = require('../backend/server');

module.exports = app;
