const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Load .env from project root first, then backend/.env fallback
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const { connectMongo, checkMongoHealth, closeMongo } = require('./config/mongoDb');
const { closePool } = require('./config/database');
const lotteryRoutes = require('./routes/lotteryRoutes');
const societyRoutes = require('./routes/societyRoutes');
const flatRoutes = require('./routes/flatRoutes');
const gameRoutes = require('./routes/gameRoutes');
const winnerRoutes = require('./routes/winnerRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

// Trust reverse proxy headers (Render, Railway, Nginx, Cloudflare, AWS ALB)
app.set('trust proxy', 1);

// 1. Secure HTTP Headers via Helmet (configured for approved frontend CDNs)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://cdn.sheetjs.com'
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://fonts.googleapis.com'
        ],
        fontSrc: [
          "'self'",
          'data:',
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net'
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*']
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// 2. CORS support
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        process.env.NODE_ENV !== 'production' ||
        allowedOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    }
  })
);

// 3. Body Parsers (16mb limit supports 5000+ Excel rows & Society Logo uploads)
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

// 4. Global API Rate Limiting (sized for 500+ live event draws & reports)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests from this IP. Please try again shortly.'
  }
});
app.use('/api', apiLimiter);

// 5. Primary Health Check Endpoint (MongoDB Primary Database)
app.get('/api/health', async (_req, res) => {
  const mongo = await checkMongoHealth();
  res.status(mongo.connected ? 200 : 503).json({
    success: mongo.connected,
    app: 'Royal Palms Flat Allocation & Live Lucky Draw Portal',
    timestamp: new Date().toISOString(),
    database: mongo
  });
});

// 6. Primary MongoDB Flat Allocation & Live Lottery Routes + Preserved Legacy Routes
app.use('/api/lottery', lotteryRoutes);
app.use('/api/society', societyRoutes);
app.use('/api/flats', flatRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/winners', winnerRoutes);

// 7. Serve Frontend Static Assets & Clean Routes
const frontendDir = path.resolve(__dirname, '../frontend');
app.use(
  express.static(frontendDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true
  })
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'admin.html'));
});

app.get('/live', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'live-lottery.html'));
});

// 8. 404 & Centralized Error Middleware
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  const server = app.listen(PORT, HOST, async () => {
    console.log('==================================================================');
    console.log('  ROYAL PALMS — FLAT ALLOCATION & LIVE LUCKY DRAW LOTTERY PORTAL');
    console.log(`  Portal Home:  http://localhost:${PORT}`);
    console.log(`  Admin Portal: http://localhost:${PORT}/admin.html`);
    console.log(`  Live Show:    http://localhost:${PORT}/live-lottery.html`);
    console.log('==================================================================');

    try {
      const meta = await connectMongo();
      console.log(
        `  [MongoDB] Connected (${meta.mode}) -> db "${meta.dbName}" | ACID Transactions: ${meta.transactionsSupported ? 'ENABLED' : 'ATOMIC-CAS'}`
      );
    } catch (err) {
      console.error(`  [MongoDB] Startup warning: ${err.message}`);
    }
  });

  const shutdown = async () => {
    console.log('\nShutting down Royal Palms Lottery Portal...');
    await closeMongo();
    await closePool();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
