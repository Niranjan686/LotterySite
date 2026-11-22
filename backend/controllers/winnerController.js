const XLSX = require('xlsx');
const { getPool, sql, isSqlConfigured } = require('../config/database');
const localFallback = require('../config/localFallbackDb');
const { cleanString } = require('../middleware/validateMiddleware');

/**
 * Helper to bind filter inputs for Winners queries.
 */
function bindWinnerFilters(request, queryParams) {
  const search = cleanString(queryParams.search || '', 150);
  const societyId = parseInt(queryParams.societyId, 10) || null;
  const symbol = cleanString(queryParams.symbol || '', 50).toUpperCase();
  const dateFrom = cleanString(queryParams.dateFrom || '', 30);
  const dateTo = cleanString(queryParams.dateTo || '', 30);

  request.input('Search', sql.NVarChar(160), search ? `%${search}%` : '');
  request.input('SocietyID', sql.Int, societyId);
  request.input('Symbol', sql.NVarChar(50), symbol);
  request.input('DateFrom', sql.NVarChar(30), dateFrom);
  request.input('DateTo', sql.NVarChar(30), dateTo);

  return request;
}

const WINNERS_WHERE_CLAUSE = `
  WHERE (@SocietyID IS NULL OR w.SocietyID = @SocietyID)
    AND (@Symbol = N'' OR w.MatchedSymbol = @Symbol)
    AND (@DateFrom = N'' OR CAST(w.DrawDateTime AS DATE) >= TRY_CAST(@DateFrom AS DATE))
    AND (@DateTo = N'' OR CAST(w.DrawDateTime AS DATE) <= TRY_CAST(@DateTo AS DATE))
    AND (
      @Search = N''
      OR w.OwnerName LIKE @Search
      OR w.FlatNumber LIKE @Search
      OR w.SocietyName LIKE @Search
      OR w.CertificateNo LIKE @Search
      OR ISNULL(gs.SessionCode, N'') LIKE @Search
      OR CAST(w.GameID AS NVARCHAR(20)) LIKE @Search
    )
`;

/**
 * GET /api/winners
 * Lists winners with search, date/society/symbol filters, and pagination (or all=true for printing).
 */
async function listWinners(req, res, next) {
  if (!isSqlConfigured()) return localFallback.listWinners(req, res, next);
  try {
    const pool = await getPool();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit =
      req.query.all === 'true'
        ? 10000
        : Math.min(500, Math.max(5, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const countReq = bindWinnerFilters(pool.request(), req.query);
    const countRes = await countReq.query(`
      SELECT COUNT(1) AS totalFiltered
      FROM dbo.Winners w
      LEFT JOIN dbo.GameSessions gs ON gs.GameID = w.GameID
      ${WINNERS_WHERE_CLAUSE}
    `);

    const dataReq = bindWinnerFilters(pool.request(), req.query);
    dataReq.input('Offset', sql.Int, offset);
    dataReq.input('Limit', sql.Int, limit);

    const dataRes = await dataReq.query(`
      SELECT
        w.WinnerID,
        w.CertificateNo,
        w.GameID,
        gs.SessionCode,
        w.FlatID,
        w.SocietyID,
        w.OwnerName,
        w.FlatNumber,
        w.SocietyName,
        w.MobileNumber,
        w.MatchedSymbol,
        w.PrizeTitle,
        w.DrawDateTime,
        s.SocietyAddress,
        s.SocietyLogo
      FROM dbo.Winners w
      LEFT JOIN dbo.GameSessions gs ON gs.GameID = w.GameID
      LEFT JOIN dbo.Societies s ON s.SocietyID = w.SocietyID
      ${WINNERS_WHERE_CLAUSE}
      ORDER BY w.DrawDateTime DESC, w.WinnerID DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
    `);

    const summaryRes = await pool.request().query(`
      SELECT
        COUNT(1) AS totalWinners,
        COUNT(DISTINCT UPPER(SocietyName + N'::' + FlatNumber)) AS uniqueWinningFlats,
        COUNT(DISTINCT SocietyID) AS societiesWithWinners,
        MAX(DrawDateTime) AS latestDrawAt
      FROM dbo.Winners
    `);

    const totalFiltered = countRes.recordset[0]?.totalFiltered || 0;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));

    return res.json({
      success: true,
      winners: dataRes.recordset,
      pagination: {
        page,
        limit,
        totalRecords: totalFiltered,
        totalPages
      },
      summary: summaryRes.recordset[0] || {
        totalWinners: 0,
        uniqueWinningFlats: 0,
        societiesWithWinners: 0,
        latestDrawAt: null
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/winners/:id
 * Returns full details of a single winner for View Details & Certificate printing.
 */
async function getWinnerById(req, res, next) {
  if (!isSqlConfigured()) return localFallback.getWinnerById(req, res, next);
  try {
    const winnerId = parseInt(req.params.id, 10);
    if (!winnerId) {
      return res.status(400).json({ success: false, message: 'Invalid Winner ID.' });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('WinnerID', sql.Int, winnerId)
      .query(`
        SELECT
          w.WinnerID,
          w.CertificateNo,
          w.GameID,
          gs.SessionCode,
          gs.Reel1Symbol,
          gs.Reel2Symbol,
          gs.Reel3Symbol,
          w.FlatID,
          w.SocietyID,
          w.OwnerName,
          w.FlatNumber,
          w.SocietyName,
          w.MobileNumber,
          w.MatchedSymbol,
          w.PrizeTitle,
          w.DrawDateTime,
          s.SocietyAddress,
          s.SocietyLogo,
          s.CommitteeName AS AuthorizedBy
        FROM dbo.Winners w
        LEFT JOIN dbo.GameSessions gs ON gs.GameID = w.GameID
        LEFT JOIN dbo.Societies s ON s.SocietyID = w.SocietyID
        WHERE w.WinnerID = @WinnerID
      `);

    if (!result.recordset.length) {
      return res.status(404).json({
        success: false,
        code: 'WINNER_NOT_FOUND',
        message: 'Winner record not found.'
      });
    }

    return res.json({
      success: true,
      winner: result.recordset[0]
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/winners/export?format=xlsx|csv
 * Exports filtered Winner History to Excel (.xlsx) or CSV (.csv) using SheetJS.
 */
async function exportWinners(req, res, next) {
  if (!isSqlConfigured()) return localFallback.exportWinners(req, res, next);
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const pool = await getPool();

    const dataReq = bindWinnerFilters(pool.request(), req.query);
    const result = await dataReq.query(`
      SELECT
        w.WinnerID,
        w.CertificateNo,
        w.GameID,
        gs.SessionCode,
        w.OwnerName,
        w.FlatNumber,
        w.SocietyName,
        w.MobileNumber,
        w.MatchedSymbol,
        w.PrizeTitle,
        w.DrawDateTime
      FROM dbo.Winners w
      LEFT JOIN dbo.GameSessions gs ON gs.GameID = w.GameID
      ${WINNERS_WHERE_CLAUSE}
      ORDER BY w.DrawDateTime DESC, w.WinnerID DESC
    `);

    const rows = result.recordset.map((w, idx) => {
      const dt = w.DrawDateTime ? new Date(w.DrawDateTime) : null;
      return {
        'Sr No': idx + 1,
        'Certificate No': w.CertificateNo,
        'Game ID': w.SessionCode || `SPW-${String(w.GameID).padStart(6, '0')}`,
        'Winner Name': w.OwnerName,
        'Flat Number': w.FlatNumber,
        'Society Name': w.SocietyName,
        'Mobile Number': w.MobileNumber || '',
        'Matched Symbol': w.MatchedSymbol,
        'Prize Title': w.PrizeTitle,
        'Draw Date': dt ? dt.toLocaleDateString('en-CA') : '',
        'Draw Time': dt ? dt.toLocaleTimeString('en-US', { hour12: true }) : ''
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      rows.length > 0
        ? rows
        : [
            {
              'Sr No': '',
              'Certificate No': '',
              'Game ID': '',
              'Winner Name': '',
              'Flat Number': '',
              'Society Name': '',
              'Mobile Number': '',
              'Matched Symbol': '',
              'Prize Title': '',
              'Draw Date': '',
              'Draw Time': ''
            }
          ]
    );

    ws['!cols'] = [
      { wch: 8 },
      { wch: 16 },
      { wch: 14 },
      { wch: 25 },
      { wch: 14 },
      { wch: 30 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: 14 },
      { wch: 14 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Winner History');

    const dateStamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Society_Winners_${dateStamp}.csv"`
      );
      return res.send('\uFEFF' + csv);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Society_Winners_${dateStamp}.xlsx"`
    );
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/winners/reset
 * Resets the draw pool (clears Winners & GameSessions inside a transaction) when starting a new season.
 */
async function resetWinnerHistory(req, res, next) {
  if (!isSqlConfigured()) return localFallback.resetWinnerHistory(req, res, next);
  let transaction;
  try {
    if (String(req.body.confirmText || '').trim().toUpperCase() !== 'RESET') {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Type RESET to confirm clearing winner history.'
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction).query('DELETE FROM dbo.Winners');
    await new sql.Request(transaction).query('DELETE FROM dbo.GameSessions');

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Winner history and spin sessions have been reset for a new society event.'
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
  listWinners,
  getWinnerById,
  exportWinners,
  resetWinnerHistory
};
