const crypto = require('crypto');
const { getPool, sql, isSqlConfigured } = require('../config/database');
const localFallback = require('../config/localFallbackDb');
const { ensurePrimarySociety } = require('./societyController');
const { cleanString } = require('../middleware/validateMiddleware');

// Official family-friendly Society Play & Win symbols (Stars, Gifts, Trophies, Lucky Icons)
const SPIN_SYMBOLS = [
  'STAR',
  'GIFT',
  'TROPHY',
  'CROWN',
  'DIAMOND',
  'CLOVER',
  'BELL',
  'MEDAL'
];

/**
 * Generates 3 reel symbols cryptographically on the backend using crypto.randomInt().
 */
function generateServerReelSymbols(matchRatePercent) {
  const rate = Math.min(100, Math.max(5, parseInt(matchRatePercent, 10) || 35));
  const roll = crypto.randomInt(0, 100);

  if (roll < rate) {
    const winningSymbol = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
    return {
      isWin: true,
      reels: [winningSymbol, winningSymbol, winningSymbol]
    };
  }

  // Non-winning spin (with occasional 2-symbol near-match for fun stage suspense)
  const nearMatchRoll = crypto.randomInt(0, 100);
  const r1 = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
  let r2 =
    nearMatchRoll < 28
      ? r1
      : SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];
  let r3 = SPIN_SYMBOLS[crypto.randomInt(0, SPIN_SYMBOLS.length)];

  if (r1 === r2 && r2 === r3) {
    r3 = SPIN_SYMBOLS[(SPIN_SYMBOLS.indexOf(r3) + 1) % SPIN_SYMBOLS.length];
  }

  return {
    isWin: false,
    reels: [r1, r2, r3]
  };
}

/**
 * GET /api/game/state
 * Fetches live slot machine configuration, eligible flat count, and recent winners ticker.
 */
async function getGameState(req, res, next) {
  if (!isSqlConfigured()) return localFallback.getGameState(req, res, next);
  try {
    const pool = await getPool();
    const primarySociety = await ensurePrimarySociety(pool);
    const filterSocietyId = parseInt(req.query.societyId, 10) || null;

    let settingsRes = await pool
      .request()
      .input('SocietyID', sql.Int, primarySociety.SocietyID)
      .query('SELECT TOP 1 * FROM dbo.GameSettings WHERE SocietyID = @SocietyID');

    if (settingsRes.recordset.length === 0) {
      settingsRes = await pool
        .request()
        .input('SocietyID', sql.Int, primarySociety.SocietyID)
        .query(`
          INSERT INTO dbo.GameSettings (SocietyID, NoRepeatWinner, SoundEnabled, ConfettiEnabled)
          OUTPUT INSERTED.*
          VALUES (@SocietyID, 1, 1, 1)
        `);
    }

    const settings = settingsRes.recordset[0];

    const countsRes = await pool
      .request()
      .input('FilterSocietyID', sql.Int, filterSocietyId)
      .input('NoRepeat', sql.Bit, settings.NoRepeatWinner ? 1 : 0)
      .query(`
        SELECT
          (
            SELECT COUNT(1)
            FROM dbo.Flats f
            WHERE f.ParticipationStatus = 1
              AND (@FilterSocietyID IS NULL OR f.SocietyID = @FilterSocietyID)
              AND (
                @NoRepeat = 0
                OR NOT EXISTS (
                  SELECT 1
                  FROM dbo.Winners w
                  WHERE w.FlatID = f.FlatID
                     OR (w.SocietyID = f.SocietyID AND UPPER(w.FlatNumber) = UPPER(f.FlatNumber))
                )
              )
          ) AS eligibleFlatsCount,
          (
            SELECT COUNT(1)
            FROM dbo.Flats f
            WHERE f.ParticipationStatus = 1
              AND (@FilterSocietyID IS NULL OR f.SocietyID = @FilterSocietyID)
          ) AS totalParticipatingCount,
          (SELECT COUNT(1) FROM dbo.Flats) AS totalRegisteredCount,
          (SELECT COUNT(1) FROM dbo.Winners) AS totalWinnersCount,
          (SELECT COUNT(1) FROM dbo.GameSessions) AS totalSpinsCount
      `);

    const societiesRes = await pool
      .request()
      .query('SELECT SocietyID, SocietyName, SocietyLogo FROM dbo.Societies ORDER BY SocietyID ASC');

    const tickerRes = await pool.request().query(`
      SELECT TOP 10
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

    return res.json({
      success: true,
      society: primarySociety,
      societies: societiesRes.recordset,
      settings,
      counts: countsRes.recordset[0],
      recentWinners: tickerRes.recordset
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/game/settings
 * Updates GameSettings including NoRepeatWinner, SoundEnabled, ConfettiEnabled,
 * SpinDurationMs, MatchRatePercent, EventTitle, and PrizeTitle.
 */
async function updateGameSettings(req, res, next) {
  if (!isSqlConfigured()) return localFallback.updateGameSettings(req, res, next);
  try {
    const pool = await getPool();
    const primarySociety = await ensurePrimarySociety(pool);

    const noRepeatWinner = Boolean(req.body.noRepeatWinner);
    const soundEnabled = req.body.soundEnabled === undefined ? true : Boolean(req.body.soundEnabled);
    const confettiEnabled =
      req.body.confettiEnabled === undefined ? true : Boolean(req.body.confettiEnabled);
    const spinDurationMs = Math.min(
      10000,
      Math.max(1500, parseInt(req.body.spinDurationMs, 10) || 3200)
    );
    const matchRatePercent = Math.min(
      100,
      Math.max(5, parseInt(req.body.matchRatePercent, 10) || 35)
    );
    const eventTitle = cleanString(
      req.body.eventTitle || 'Annual Society Family Festival & Lucky Draw',
      150
    );
    const prizeTitle = cleanString(
      req.body.prizeTitle || 'Official Society Play & Win Winner',
      150
    );

    const updatedRes = await pool
      .request()
      .input('SocietyID', sql.Int, primarySociety.SocietyID)
      .input('NoRepeatWinner', sql.Bit, noRepeatWinner ? 1 : 0)
      .input('SoundEnabled', sql.Bit, soundEnabled ? 1 : 0)
      .input('ConfettiEnabled', sql.Bit, confettiEnabled ? 1 : 0)
      .input('SpinDurationMs', sql.Int, spinDurationMs)
      .input('MatchRatePercent', sql.Int, matchRatePercent)
      .input('EventTitle', sql.NVarChar(150), eventTitle)
      .input('PrizeTitle', sql.NVarChar(150), prizeTitle)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.GameSettings WHERE SocietyID = @SocietyID)
        BEGIN
          UPDATE dbo.GameSettings
          SET NoRepeatWinner = @NoRepeatWinner,
              SoundEnabled = @SoundEnabled,
              ConfettiEnabled = @ConfettiEnabled,
              SpinDurationMs = @SpinDurationMs,
              MatchRatePercent = @MatchRatePercent,
              EventTitle = @EventTitle,
              PrizeTitle = @PrizeTitle,
              UpdatedAt = SYSDATETIME()
          OUTPUT INSERTED.*
          WHERE SocietyID = @SocietyID;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.GameSettings (
            SocietyID,
            NoRepeatWinner,
            SoundEnabled,
            ConfettiEnabled,
            SpinDurationMs,
            MatchRatePercent,
            EventTitle,
            PrizeTitle
          )
          OUTPUT INSERTED.*
          VALUES (
            @SocietyID,
            @NoRepeatWinner,
            @SoundEnabled,
            @ConfettiEnabled,
            @SpinDurationMs,
            @MatchRatePercent,
            @EventTitle,
            @PrizeTitle
          );
        END
      `);

    return res.json({
      success: true,
      message: 'Slot machine & draw rules saved successfully!',
      settings: updatedRes.recordset[0]
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/game/spin
 * 100% Backend-Authoritative Cryptographic Spin & Winner Selection!
 * - Generates all 3 reel symbols on the backend using crypto.randomInt()
 * - Executes inside a SERIALIZABLE SQL Server transaction with UPDLOCK + HOLDLOCK
 * - When all 3 symbols match, selects an actual eligible flat via crypto.randomInt()
 *   and saves both GameSession and Winner atomically, preventing fake or duplicate winners.
 */
async function spinSlotMachine(req, res, next) {
  if (!isSqlConfigured()) return localFallback.spinSlotMachine(req, res, next);
  let transaction;
  try {
    const filterSocietyId = parseInt(req.body.societyId, 10) || null;
    const pool = await getPool();
    const primarySociety = await ensurePrimarySociety(pool);

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    // 1. Read authoritative GameSettings under UPDLOCK + HOLDLOCK
    const settingsRes = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, primarySociety.SocietyID)
      .query(`
        SELECT TOP 1 NoRepeatWinner, MatchRatePercent, PrizeTitle, EventTitle
        FROM dbo.GameSettings WITH (UPDLOCK, HOLDLOCK)
        WHERE SocietyID = @SocietyID
      `);

    const settingsRow = settingsRes.recordset[0] || {};
    const noRepeatWinner =
      settingsRow.NoRepeatWinner !== undefined ? Boolean(settingsRow.NoRepeatWinner) : true;
    const matchRatePercent = settingsRow.MatchRatePercent || 35;
    const prizeTitle = cleanString(
      settingsRow.PrizeTitle || 'Official Society Play & Win Winner',
      150
    );

    // 2. Lock eligible Flats & Winners range so concurrent requests can NEVER pick the same flat
    const eligibleRes = await new sql.Request(transaction)
      .input('FilterSocietyID', sql.Int, filterSocietyId)
      .input('NoRepeatWinner', sql.Bit, noRepeatWinner ? 1 : 0)
      .query(`
        SELECT
          f.FlatID,
          f.SocietyID,
          f.SocietyName,
          f.FlatNumber,
          f.OwnerName,
          f.MobileNumber
        FROM dbo.Flats f WITH (UPDLOCK, HOLDLOCK)
        WHERE f.ParticipationStatus = 1
          AND (@FilterSocietyID IS NULL OR f.SocietyID = @FilterSocietyID)
          AND (
            @NoRepeatWinner = 0
            OR NOT EXISTS (
              SELECT 1
              FROM dbo.Winners w WITH (UPDLOCK, HOLDLOCK)
              WHERE w.FlatID = f.FlatID
                 OR (w.SocietyID = f.SocietyID AND UPPER(w.FlatNumber) = UPPER(f.FlatNumber))
            )
          )
        ORDER BY f.FlatID ASC
      `);

    const eligibleFlats = eligibleRes.recordset;

    if (eligibleFlats.length === 0) {
      await transaction.rollback();
      transaction = null;
      return res.status(409).json({
        success: false,
        code: 'NO_ELIGIBLE_FLATS',
        message: noRepeatWinner
          ? 'All participating flats have already won! Add more participating flats or disable "No-Repeat Winner" in Settings.'
          : 'No participating flats found! Please add or import society flats in Flat Management.'
      });
    }

    // 3. Determine reel symbols cryptographically via crypto.randomInt()
    const outcome = generateServerReelSymbols(matchRatePercent);
    const [r1, r2, r3] = outcome.reels;

    if (!outcome.isWin) {
      const targetSocietyId = filterSocietyId || primarySociety.SocietyID;
      const nonWinSessionRes = await new sql.Request(transaction)
        .input('SocietyID', sql.Int, targetSocietyId)
        .input('Reel1', sql.NVarChar(50), r1)
        .input('Reel2', sql.NVarChar(50), r2)
        .input('Reel3', sql.NVarChar(50), r3)
        .query(`
          INSERT INTO dbo.GameSessions (
            SocietyID,
            Reel1Symbol,
            Reel2Symbol,
            Reel3Symbol,
            IsWinningMatch
          )
          OUTPUT INSERTED.GameID, INSERTED.SessionCode, INSERTED.PlayedAt
          VALUES (@SocietyID, @Reel1, @Reel2, @Reel3, 0)
        `);

      await transaction.commit();
      transaction = null;

      return res.status(200).json({
        success: true,
        isWin: false,
        reels: [r1, r2, r3],
        session: nonWinSessionRes.recordset[0],
        winner: null,
        poolStats: {
          eligibleFlatsCount: eligibleFlats.length,
          remainingEligibleFlats: eligibleFlats.length,
          noRepeatWinner
        }
      });
    }

    // 4. Three matching symbols! Select official eligible flat using crypto.randomInt()
    const winnerIndex = crypto.randomInt(0, eligibleFlats.length);
    const chosenFlat = eligibleFlats[winnerIndex];

    const winSessionRes = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, chosenFlat.SocietyID)
      .input('Reel1', sql.NVarChar(50), r1)
      .input('Reel2', sql.NVarChar(50), r2)
      .input('Reel3', sql.NVarChar(50), r3)
      .query(`
        INSERT INTO dbo.GameSessions (
          SocietyID,
          Reel1Symbol,
          Reel2Symbol,
          Reel3Symbol,
          IsWinningMatch
        )
        OUTPUT INSERTED.GameID, INSERTED.SessionCode, INSERTED.PlayedAt
        VALUES (@SocietyID, @Reel1, @Reel2, @Reel3, 1)
      `);

    const gameSession = winSessionRes.recordset[0];

    const winnerInsert = await new sql.Request(transaction)
      .input('GameID', sql.Int, gameSession.GameID)
      .input('FlatID', sql.Int, chosenFlat.FlatID)
      .input('SocietyID', sql.Int, chosenFlat.SocietyID)
      .input('OwnerName', sql.NVarChar(150), chosenFlat.OwnerName)
      .input('FlatNumber', sql.NVarChar(50), chosenFlat.FlatNumber)
      .input('SocietyName', sql.NVarChar(150), chosenFlat.SocietyName)
      .input('MobileNumber', sql.NVarChar(25), chosenFlat.MobileNumber || null)
      .input('MatchedSymbol', sql.NVarChar(50), r1)
      .input('PrizeTitle', sql.NVarChar(150), prizeTitle)
      .query(`
        INSERT INTO dbo.Winners (
          GameID,
          FlatID,
          SocietyID,
          OwnerName,
          FlatNumber,
          SocietyName,
          MobileNumber,
          MatchedSymbol,
          PrizeTitle
        )
        OUTPUT
          INSERTED.WinnerID,
          INSERTED.CertificateNo,
          INSERTED.GameID,
          INSERTED.FlatID,
          INSERTED.SocietyID,
          INSERTED.OwnerName,
          INSERTED.FlatNumber,
          INSERTED.SocietyName,
          INSERTED.MobileNumber,
          INSERTED.MatchedSymbol,
          INSERTED.PrizeTitle,
          INSERTED.DrawDateTime
        VALUES (
          @GameID,
          @FlatID,
          @SocietyID,
          @OwnerName,
          @FlatNumber,
          @SocietyName,
          @MobileNumber,
          @MatchedSymbol,
          @PrizeTitle
        )
      `);

    await transaction.commit();
    transaction = null;

    const officialWinner = winnerInsert.recordset[0];
    const remainingPool = noRepeatWinner
      ? Math.max(0, eligibleFlats.length - 1)
      : eligibleFlats.length;

    return res.status(201).json({
      success: true,
      isWin: true,
      message: 'CONGRATULATIONS! OFFICIAL SOCIETY WINNER SELECTED!',
      reels: [r1, r2, r3],
      session: gameSession,
      winner: {
        ...officialWinner,
        SessionCode: gameSession.SessionCode
      },
      poolStats: {
        previousPoolSize: eligibleFlats.length,
        remainingEligibleFlats: remainingPool,
        noRepeatWinner
      }
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

module.exports = {
  SPIN_SYMBOLS,
  generateServerReelSymbols,
  getGameState,
  updateGameSettings,
  spinSlotMachine
};
