const { getPool, sql, isSqlConfigured } = require('../config/database');
const localFallback = require('../config/localFallbackDb');
const { cleanString } = require('../middleware/validateMiddleware');

/**
 * Validates optional image value (data URI or static asset/http URL).
 */
function validateImageInput(rawValue, maxChars = 6_000_000, label = 'Image') {
  if (rawValue === undefined) return { valid: true, value: undefined };
  if (rawValue === null || rawValue === '') return { valid: true, value: null };

  const str = String(rawValue).trim();
  if (str.length > maxChars) {
    return {
      valid: false,
      code: 'IMAGE_TOO_LARGE',
      message: `${label} must be smaller than 4 MB.`
    };
  }

  if (
    !str.startsWith('data:image/') &&
    !str.startsWith('/assets/') &&
    !str.startsWith('assets/') &&
    !str.startsWith('http://') &&
    !str.startsWith('https://')
  ) {
    return {
      valid: false,
      code: 'INVALID_IMAGE_FORMAT',
      message: `Invalid ${label.toLowerCase()} format. Please upload a JPG, PNG, WebP, or SVG image.`
    };
  }

  return { valid: true, value: str };
}

/**
 * Helper to fetch or create the primary Society record.
 */
async function ensurePrimarySociety(poolOrTx) {
  const req = new sql.Request(poolOrTx);
  const res = await req.query('SELECT TOP 1 * FROM dbo.Societies ORDER BY SocietyID ASC');
  if (res.recordset.length > 0) {
    return res.recordset[0];
  }

  const inserted = await new sql.Request(poolOrTx).query(`
    INSERT INTO dbo.Societies (
      SocietyName,
      SocietyAddress,
      TotalFlats,
      CommitteeName,
      ContactPhone
    )
    OUTPUT INSERTED.*
    VALUES (
      N'Royal Palms Co-operative Housing Society',
      N'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706',
      500,
      N'Society Cultural & Events Committee',
      N'+91 98200 12345'
    )
  `);
  return inserted.recordset[0];
}

/**
 * GET /api/society
 * Returns active society details, all registered societies, and game settings.
 */
async function getSocietyProfile(req, res, next) {
  if (!isSqlConfigured()) return localFallback.getSocietyProfile(req, res, next);
  try {
    const pool = await getPool();
    const primary = await ensurePrimarySociety(pool);

    const requestedId = parseInt(req.query.societyId, 10) || null;
    const societiesRes = await pool
      .request()
      .query('SELECT * FROM dbo.Societies ORDER BY SocietyID ASC');

    const activeSociety =
      (requestedId && societiesRes.recordset.find((s) => s.SocietyID === requestedId)) || primary;

    let settingsRes = await pool
      .request()
      .input('SocietyID', sql.Int, activeSociety.SocietyID)
      .query('SELECT TOP 1 * FROM dbo.GameSettings WHERE SocietyID = @SocietyID');

    if (settingsRes.recordset.length === 0) {
      settingsRes = await pool
        .request()
        .input('SocietyID', sql.Int, activeSociety.SocietyID)
        .query(`
          INSERT INTO dbo.GameSettings (SocietyID, NoRepeatWinner, SoundEnabled, ConfettiEnabled)
          OUTPUT INSERTED.*
          VALUES (@SocietyID, 1, 1, 1)
        `);
    }

    return res.json({
      success: true,
      society: activeSociety,
      societies: societiesRes.recordset,
      settings: settingsRes.recordset[0]
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/society
 * Adds a new Society record and initializes its GameSettings.
 */
async function createSociety(req, res, next) {
  if (!isSqlConfigured()) return localFallback.createSociety(req, res, next);
  let transaction;
  try {
    const societyName = cleanString(req.body.societyName, 150);
    const societyAddress =
      cleanString(req.body.societyAddress, 500) || 'Main Residential Avenue, India';
    const committeeName =
      cleanString(req.body.committeeName, 150) || 'Society Cultural & Events Committee';
    const contactPhone = cleanString(req.body.contactPhone, 30) || null;
    const totalFlats = Math.max(1, Math.min(50000, parseInt(req.body.totalFlats, 10) || 500));

    const pool = await getPool();

    const dupRes = await pool
      .request()
      .input('SocietyName', sql.NVarChar(150), societyName)
      .query(
        'SELECT TOP 1 SocietyID, SocietyName FROM dbo.Societies WHERE LOWER(SocietyName) = LOWER(@SocietyName)'
      );

    if (dupRes.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_SOCIETY',
        message: `Society "${dupRes.recordset[0].SocietyName}" is already registered.`
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const insertRes = await new sql.Request(transaction)
      .input('SocietyName', sql.NVarChar(150), societyName)
      .input('SocietyAddress', sql.NVarChar(500), societyAddress)
      .input('TotalFlats', sql.Int, totalFlats)
      .input('CommitteeName', sql.NVarChar(150), committeeName)
      .input('ContactPhone', sql.NVarChar(30), contactPhone)
      .query(`
        INSERT INTO dbo.Societies (
          SocietyName,
          SocietyAddress,
          TotalFlats,
          CommitteeName,
          ContactPhone
        )
        OUTPUT INSERTED.*
        VALUES (
          @SocietyName,
          @SocietyAddress,
          @TotalFlats,
          @CommitteeName,
          @ContactPhone
        )
      `);

    const createdSociety = insertRes.recordset[0];

    await new sql.Request(transaction)
      .input('SocietyID', sql.Int, createdSociety.SocietyID)
      .query(`
        INSERT INTO dbo.GameSettings (SocietyID, NoRepeatWinner, SoundEnabled, ConfettiEnabled)
        VALUES (@SocietyID, 1, 1, 1)
      `);

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Society "${societyName}" added successfully!`,
      society: createdSociety
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }
    return next(err);
  }
}

/**
 * PUT /api/society
 * Updates Society Name, Address, Branding Logo, Hero Building Image, Total Flats & Committee Details.
 */
async function updateSocietyProfile(req, res, next) {
  if (!isSqlConfigured()) return localFallback.updateSocietyProfile(req, res, next);
  let transaction;
  try {
    const societyName = cleanString(req.body.societyName, 150);
    const societyAddress =
      cleanString(req.body.societyAddress, 500) || 'Main Residential Avenue, India';
    const committeeName =
      cleanString(req.body.committeeName, 150) || 'Society Cultural & Events Committee';
    const contactPhone = cleanString(req.body.contactPhone, 30) || null;
    const totalFlats = Math.max(1, Math.min(50000, parseInt(req.body.totalFlats, 10) || 500));

    const logoCheck = validateImageInput(req.body.societyLogo, 3_000_000, 'Society logo');
    if (!logoCheck.valid) {
      return res.status(400).json({
        success: false,
        code: logoCheck.code,
        message: logoCheck.message
      });
    }

    const heroCheck = validateImageInput(req.body.societyImage, 6_500_000, 'Society building photo');
    if (!heroCheck.valid) {
      return res.status(400).json({
        success: false,
        code: heroCheck.code,
        message: heroCheck.message
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const primary = await ensurePrimarySociety(transaction);
    const targetSocietyId = parseInt(req.body.societyId, 10) || primary.SocietyID;

    const currentRes = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, targetSocietyId)
      .query('SELECT TOP 1 * FROM dbo.Societies WHERE SocietyID = @SocietyID');

    const current = currentRes.recordset[0] || primary;
    const finalLogo = logoCheck.value === undefined ? current.SocietyLogo : logoCheck.value;
    const finalHeroImage = heroCheck.value === undefined ? current.SocietyImage : heroCheck.value;

    const updatedRes = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, current.SocietyID)
      .input('SocietyName', sql.NVarChar(150), societyName)
      .input('SocietyAddress', sql.NVarChar(500), societyAddress)
      .input('SocietyLogo', sql.NVarChar(sql.MAX), finalLogo)
      .input('SocietyImage', sql.NVarChar(sql.MAX), finalHeroImage)
      .input('TotalFlats', sql.Int, totalFlats)
      .input('CommitteeName', sql.NVarChar(150), committeeName)
      .input('ContactPhone', sql.NVarChar(30), contactPhone)
      .query(`
        UPDATE dbo.Societies
        SET SocietyName = @SocietyName,
            SocietyAddress = @SocietyAddress,
            SocietyLogo = @SocietyLogo,
            SocietyImage = @SocietyImage,
            TotalFlats = @TotalFlats,
            CommitteeName = @CommitteeName,
            ContactPhone = @ContactPhone,
            UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE SocietyID = @SocietyID
      `);

    // Keep denormalized SocietyName in Flats and Winners synchronized
    await new sql.Request(transaction)
      .input('SocietyID', sql.Int, current.SocietyID)
      .input('SocietyName', sql.NVarChar(150), societyName)
      .query(`
        UPDATE dbo.Flats
        SET SocietyName = @SocietyName,
            UpdatedAt = SYSDATETIME()
        WHERE SocietyID = @SocietyID;

        UPDATE dbo.Winners
        SET SocietyName = @SocietyName
        WHERE SocietyID = @SocietyID;
      `);

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Society profile updated successfully!',
      society: updatedRes.recordset[0]
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }
    return next(err);
  }
}

/**
 * GET /api/society/dashboard
 * Aggregated metrics for Homepage & Dashboard:
 * - Total Flats
 * - Total Registered Owners
 * - Total Games Played
 * - Total Winners
 * - Recent Winners
 */
async function getDashboardSummary(req, res, next) {
  if (!isSqlConfigured()) return localFallback.getDashboardSummary(req, res, next);
  try {
    const pool = await getPool();
    const society = await ensurePrimarySociety(pool);

    const kpiRes = await pool
      .request()
      .input('SocietyID', sql.Int, society.SocietyID)
      .query(`
        DECLARE @NoRepeat BIT = ISNULL(
          (SELECT TOP 1 NoRepeatWinner FROM dbo.GameSettings WHERE SocietyID = @SocietyID),
          1
        );

        SELECT
          (SELECT COUNT(1) FROM dbo.Flats) AS totalRegisteredFlats,
          (SELECT COUNT(DISTINCT UPPER(LTRIM(RTRIM(OwnerName)))) FROM dbo.Flats WHERE LTRIM(RTRIM(OwnerName)) <> N'') AS totalRegisteredOwners,
          (SELECT COUNT(1) FROM dbo.Flats WHERE ParticipationStatus = 1) AS participatingFlats,
          (SELECT COUNT(1) FROM dbo.Flats WHERE ParticipationStatus = 0) AS excludedFlats,
          (
            SELECT COUNT(1)
            FROM dbo.Flats f
            WHERE f.ParticipationStatus = 1
              AND (
                @NoRepeat = 0
                OR NOT EXISTS (
                  SELECT 1
                  FROM dbo.Winners w
                  WHERE w.FlatID = f.FlatID
                     OR (w.SocietyID = f.SocietyID AND UPPER(w.FlatNumber) = UPPER(f.FlatNumber))
                )
              )
          ) AS eligibleDrawPool,
          (SELECT COUNT(1) FROM dbo.GameSessions) AS totalSpins,
          (SELECT COUNT(1) FROM dbo.GameSessions WHERE IsWinningMatch = 1) AS winningSpins,
          (SELECT COUNT(1) FROM dbo.Winners) AS totalWinners,
          (SELECT COUNT(1) FROM dbo.Societies) AS totalSocieties,
          @NoRepeat AS noRepeatWinner
      `);

    const recentWinnersRes = await pool.request().query(`
      SELECT TOP 8
        w.WinnerID,
        w.CertificateNo,
        w.GameID,
        gs.SessionCode,
        w.OwnerName,
        w.FlatNumber,
        w.SocietyName,
        w.MatchedSymbol,
        w.PrizeTitle,
        w.DrawDateTime
      FROM dbo.Winners w
      LEFT JOIN dbo.GameSessions gs ON gs.GameID = w.GameID
      ORDER BY w.DrawDateTime DESC, w.WinnerID DESC
    `);

    const settingsRes = await pool
      .request()
      .input('SocietyID', sql.Int, society.SocietyID)
      .query('SELECT TOP 1 * FROM dbo.GameSettings WHERE SocietyID = @SocietyID');

    return res.json({
      success: true,
      society,
      settings: settingsRes.recordset[0] || null,
      stats: {
        ...kpiRes.recordset[0],
        societyCapacity: society.TotalFlats
      },
      recentWinners: recentWinnersRes.recordset
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  ensurePrimarySociety,
  getSocietyProfile,
  createSociety,
  updateSocietyProfile,
  getDashboardSummary
};
