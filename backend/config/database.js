const path = require('path');
const sql = require('mssql');
const dotenv = require('dotenv');

// Load .env from project root first, then fallback to backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Builds Microsoft SQL Server connection pool configuration from environment variables.
 */
function buildSqlConfig() {
  const rawServer = (process.env.DB_SERVER || '').trim();
  const rawPort = (process.env.DB_PORT || '1433').trim();
  const database = (process.env.DB_DATABASE || 'SocietyPlayWin').trim();
  const user = (process.env.DB_USER || '').trim();
  const password = process.env.DB_PASSWORD || '';
  const encrypt = String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true';
  const trustServerCertificate =
    String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false';

  let serverHost = rawServer;
  let instanceName = undefined;

  // Support named SQL Server instances such as localhost\SQLEXPRESS
  if (rawServer.includes('\\')) {
    const parts = rawServer.split('\\');
    serverHost = parts[0] || 'localhost';
    instanceName = parts[1] || undefined;
  }

  const config = {
    user,
    password,
    server: serverHost,
    database,
    pool: {
      max: 20,
      min: 2,
      idleTimeoutMillis: 30000
    },
    options: {
      encrypt,
      trustServerCertificate,
      enableArithAbort: true
    },
    connectionTimeout: 10000,
    requestTimeout: 30000
  };

  if (instanceName) {
    config.options.instanceName = instanceName;
    if (process.env.DB_FORCE_PORT === 'true' && rawPort) {
      config.port = parseInt(rawPort, 10);
    }
  } else if (rawPort) {
    config.port = parseInt(rawPort, 10) || 1433;
  }

  return config;
}

let poolPromise = null;
let testPoolOverride = null;
let schemaVerified = false;
let lastConnectionError = null;

/**
 * Ensures newer columns exist safely if connected to a pre-existing SocietyPlayWin database.
 */
async function ensureSchemaCompatibility(pool) {
  if (schemaVerified || testPoolOverride) return;
  try {
    await pool.request().query(`
      IF OBJECT_ID(N'dbo.Societies', N'U') IS NOT NULL
      BEGIN
        IF COL_LENGTH(N'dbo.Societies', N'SocietyImage') IS NULL
          ALTER TABLE dbo.Societies ADD SocietyImage NVARCHAR(MAX) NULL;

        IF COL_LENGTH(N'dbo.Societies', N'CommitteeName') IS NULL
          ALTER TABLE dbo.Societies ADD CommitteeName NVARCHAR(150) NOT NULL CONSTRAINT DF_Soc_Comm_Auto DEFAULT (N'Society Cultural & Events Committee');

        IF COL_LENGTH(N'dbo.Societies', N'ContactPhone') IS NULL
          ALTER TABLE dbo.Societies ADD ContactPhone NVARCHAR(30) NULL;
      END

      IF OBJECT_ID(N'dbo.Winners', N'U') IS NOT NULL
      BEGIN
        ALTER TABLE dbo.Winners ALTER COLUMN FlatID INT NULL;
      END
    `);
    schemaVerified = true;
  } catch (_) {
    // Ignore if user lacks DDL permissions; standard script already creates all columns
  }
}

/**
 * Returns a connected singleton SQL Server ConnectionPool.
 * Resets poolPromise on failure so subsequent requests retry cleanly
 * once SQL Server is started or .env credentials are updated.
 */
async function getPool() {
  if (testPoolOverride) {
    return testPoolOverride;
  }

  const config = buildSqlConfig();

  if (!config.server || !config.user) {
    const missing = [];
    if (!config.server) missing.push('DB_SERVER');
    if (!config.user) missing.push('DB_USER');
    const err = new Error(
      `SQL Server configuration incomplete. Please set ${missing.join(', ')} and DB_PASSWORD in your .env file.`
    );
    err.code = 'DB_CONFIG_MISSING';
    lastConnectionError = err.message;
    throw err;
  }

  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);

    pool.on('error', (err) => {
      console.error('[SQL Pool Error]:', err.message);
      lastConnectionError = err.message;
      poolPromise = null;
      schemaVerified = false;
    });

    poolPromise = pool
      .connect()
      .then(async (connectedPool) => {
        lastConnectionError = null;
        await ensureSchemaCompatibility(connectedPool);
        return connectedPool;
      })
      .catch((err) => {
        lastConnectionError = err.message;
        poolPromise = null;
        schemaVerified = false;
        const wrapped = new Error(`Unable to connect to SQL Server: ${err.message}`);
        wrapped.code = 'DB_CONNECTION_FAILED';
        throw wrapped;
      });
  }

  return poolPromise;
}

/**
 * Non-throwing database connectivity check for startup logs and /api/health
 */
async function checkDatabaseHealth() {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 AS ok, DB_NAME() AS databaseName');
    return {
      connected: true,
      database: result.recordset[0]?.databaseName || process.env.DB_DATABASE || 'SocietyPlayWin',
      error: null
    };
  } catch (err) {
    return {
      connected: false,
      database: process.env.DB_DATABASE || 'SocietyPlayWin',
      code: err.code || 'DB_ERROR',
      error: err.message || lastConnectionError
    };
  }
}

function isSqlConfigured() {
  if (testPoolOverride) return true;
  const server = (process.env.DB_SERVER || '').trim();
  const user = (process.env.DB_USER || '').trim();
  return Boolean(server && user);
}

function setPoolForTesting(mockPool) {
  testPoolOverride = mockPool;
}

async function closePool() {
  testPoolOverride = null;
  schemaVerified = false;
  if (poolPromise) {
    try {
      const pool = await poolPromise;
      await pool.close();
    } catch (_) {
      // Ignore close error
    } finally {
      poolPromise = null;
    }
  }
}

module.exports = {
  sql,
  getPool,
  buildSqlConfig,
  isSqlConfigured,
  checkDatabaseHealth,
  setPoolForTesting,
  closePool
};
