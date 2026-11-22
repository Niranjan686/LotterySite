const XLSX = require('xlsx');
const { getPool, sql, isSqlConfigured } = require('../config/database');
const localFallback = require('../config/localFallbackDb');
const { ensurePrimarySociety } = require('./societyController');
const { cleanString, normalizeFlatNumber } = require('../middleware/validateMiddleware');

/**
 * Validates optional mobile number format.
 */
function cleanMobile(val) {
  const cleaned = cleanString(val, 25);
  if (!cleaned) return null;
  return cleaned;
}

function isValidMobile(val) {
  if (!val) return true;
  return /^[+]?[0-9\s()-]{7,20}$/.test(val);
}

/**
 * Resolves an existing Society or creates a new Society + default GameSettings inside a transaction.
 */
async function resolveOrCreateSociety(txOrPool, requestedSocietyId, requestedSocietyName, primarySociety) {
  const cleanName = cleanString(requestedSocietyName, 150);

  if (cleanName) {
    const byName = await new sql.Request(txOrPool)
      .input('SocietyName', sql.NVarChar(150), cleanName)
      .query(
        'SELECT TOP 1 SocietyID, SocietyName FROM dbo.Societies WHERE LOWER(SocietyName) = LOWER(@SocietyName)'
      );

    if (byName.recordset.length > 0) {
      return byName.recordset[0];
    }

    // Create the new society automatically
    const created = await new sql.Request(txOrPool)
      .input('SocietyName', sql.NVarChar(150), cleanName)
      .input('SocietyAddress', sql.NVarChar(500), primarySociety.SocietyAddress || 'Main Residential Avenue, India')
      .input('TotalFlats', sql.Int, 500)
      .input('CommitteeName', sql.NVarChar(150), primarySociety.CommitteeName || 'Society Cultural & Events Committee')
      .query(`
        INSERT INTO dbo.Societies (SocietyName, SocietyAddress, TotalFlats, CommitteeName)
        OUTPUT INSERTED.SocietyID, INSERTED.SocietyName
        VALUES (@SocietyName, @SocietyAddress, @TotalFlats, @CommitteeName)
      `);

    const newSoc = created.recordset[0];
    await new sql.Request(txOrPool)
      .input('SocietyID', sql.Int, newSoc.SocietyID)
      .query(`
        INSERT INTO dbo.GameSettings (SocietyID, NoRepeatWinner, SoundEnabled, ConfettiEnabled)
        VALUES (@SocietyID, 1, 1, 1)
      `);

    return newSoc;
  }

  if (requestedSocietyId) {
    const byId = await new sql.Request(txOrPool)
      .input('SocietyID', sql.Int, requestedSocietyId)
      .query('SELECT TOP 1 SocietyID, SocietyName FROM dbo.Societies WHERE SocietyID = @SocietyID');

    if (byId.recordset.length > 0) {
      return byId.recordset[0];
    }
  }

  return {
    SocietyID: primarySociety.SocietyID,
    SocietyName: primarySociety.SocietyName
  };
}

/**
 * GET /api/flats
 * Supports pagination, search by ownerName, search by flatNumber, general search,
 * participationStatus filter, societyId filter, and print/export all mode.
 */
async function listFlats(req, res, next) {
  if (!isSqlConfigured()) return localFallback.listFlats(req, res, next);
  try {
    const pool = await getPool();
    await ensurePrimarySociety(pool);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit =
      req.query.all === 'true'
        ? 20000
        : Math.min(500, Math.max(5, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const ownerSearch = cleanString(req.query.ownerName || '', 150);
    const flatSearch = cleanString(req.query.flatNumber || '', 50);
    const generalSearch = cleanString(req.query.search || '', 150);
    const statusFilter = cleanString(req.query.status || 'all', 20).toLowerCase();
    const societyId = parseInt(req.query.societyId, 10) || null;

    const buildFilterInputs = (request) => {
      request.input('OwnerSearch', sql.NVarChar(160), ownerSearch ? `%${ownerSearch}%` : '');
      request.input('FlatSearch', sql.NVarChar(60), flatSearch ? `%${flatSearch}%` : '');
      request.input('GeneralSearch', sql.NVarChar(160), generalSearch ? `%${generalSearch}%` : '');
      request.input('StatusFilter', sql.NVarChar(20), statusFilter);
      request.input('SocietyID', sql.Int, societyId);
      return request;
    };

    const whereClause = `
      WHERE (@SocietyID IS NULL OR f.SocietyID = @SocietyID)
        AND (@OwnerSearch = N'' OR f.OwnerName LIKE @OwnerSearch)
        AND (@FlatSearch = N'' OR f.FlatNumber LIKE @FlatSearch)
        AND (
          @GeneralSearch = N''
          OR f.OwnerName LIKE @GeneralSearch
          OR f.FlatNumber LIKE @GeneralSearch
          OR f.SocietyName LIKE @GeneralSearch
          OR ISNULL(f.MobileNumber, N'') LIKE @GeneralSearch
        )
        AND (
          @StatusFilter = N'all'
          OR (@StatusFilter = N'active' AND f.ParticipationStatus = 1)
          OR (@StatusFilter = N'participating' AND f.ParticipationStatus = 1)
          OR (@StatusFilter = N'inactive' AND f.ParticipationStatus = 0)
          OR (@StatusFilter = N'excluded' AND f.ParticipationStatus = 0)
          OR (
            @StatusFilter = N'winners'
            AND EXISTS (
              SELECT 1 FROM dbo.Winners w
              WHERE w.FlatID = f.FlatID
                 OR (w.SocietyID = f.SocietyID AND UPPER(w.FlatNumber) = UPPER(f.FlatNumber))
            )
          )
        )
    `;

    const countReq = buildFilterInputs(pool.request());
    const countRes = await countReq.query(`
      SELECT
        COUNT(1) AS totalFiltered,
        ISNULL(SUM(CASE WHEN f.ParticipationStatus = 1 THEN 1 ELSE 0 END), 0) AS activeFiltered
      FROM dbo.Flats f
      ${whereClause}
    `);

    const summaryRes = await pool.request().query(`
      SELECT
        COUNT(1) AS totalAll,
        COUNT(DISTINCT UPPER(LTRIM(RTRIM(OwnerName)))) AS totalOwners,
        ISNULL(SUM(CASE WHEN ParticipationStatus = 1 THEN 1 ELSE 0 END), 0) AS participatingAll,
        ISNULL(SUM(CASE WHEN ParticipationStatus = 0 THEN 1 ELSE 0 END), 0) AS excludedAll
      FROM dbo.Flats
    `);

    const dataReq = buildFilterInputs(pool.request());
    dataReq.input('Offset', sql.Int, offset);
    dataReq.input('Limit', sql.Int, limit);

    const dataRes = await dataReq.query(`
      SELECT
        f.FlatID,
        f.SocietyID,
        f.SocietyName,
        f.FlatNumber,
        f.OwnerName,
        f.MobileNumber,
        f.ParticipationStatus,
        f.CreatedAt,
        f.UpdatedAt,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.Winners w
          WHERE w.FlatID = f.FlatID
             OR (w.SocietyID = f.SocietyID AND UPPER(w.FlatNumber) = UPPER(f.FlatNumber))
        ) THEN 1 ELSE 0 END AS HasWon
      FROM dbo.Flats f
      ${whereClause}
      ORDER BY f.SocietyID ASC, f.FlatNumber ASC, f.FlatID ASC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
    `);

    const totalFiltered = countRes.recordset[0]?.totalFiltered || 0;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));

    return res.json({
      success: true,
      flats: dataRes.recordset,
      pagination: {
        page,
        limit,
        totalRecords: totalFiltered,
        totalPages
      },
      summary: summaryRes.recordset[0] || {
        totalAll: 0,
        totalOwners: 0,
        participatingAll: 0,
        excludedAll: 0
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/flats/existing-keys
 * Returns existing (SocietyName, FlatNumber) pairs so frontend SheetJS preview
 * can flag database duplicates row-by-row BEFORE confirming import.
 */
async function getExistingFlatKeys(req, res, next) {
  if (!isSqlConfigured()) return localFallback.getExistingFlatKeys(req, res, next);
  try {
    const pool = await getPool();
    const society = await ensurePrimarySociety(pool);
    const result = await pool.request().query(`
      SELECT SocietyID, SocietyName, FlatNumber
      FROM dbo.Flats
    `);

    return res.json({
      success: true,
      defaultSocietyName: society.SocietyName,
      existing: result.recordset
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/flats
 * Creates a single flat (and auto-registers the Society if new) with duplicate FlatNumber check.
 */
async function createFlat(req, res, next) {
  if (!isSqlConfigured()) return localFallback.createFlat(req, res, next);
  let transaction;
  try {
    const flatNumber = normalizeFlatNumber(req.body.flatNumber);
    const ownerName = cleanString(req.body.ownerName, 150);
    const mobileNumber = cleanMobile(req.body.mobileNumber);
    const participationStatus =
      req.body.participationStatus === undefined
        ? true
        : Boolean(
            req.body.participationStatus === true ||
              req.body.participationStatus === 1 ||
              String(req.body.participationStatus).toLowerCase() === 'true' ||
              String(req.body.participationStatus) === '1'
          );

    if (!isValidMobile(mobileNumber)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MOBILE',
        message: 'Please enter a valid mobile number (7-20 digits).'
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const primarySociety = await ensurePrimarySociety(transaction);
    const targetSoc = await resolveOrCreateSociety(
      transaction,
      parseInt(req.body.societyId, 10) || null,
      req.body.societyName,
      primarySociety
    );

    // Check duplicate FlatNumber in this Society
    const dupCheck = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, targetSoc.SocietyID)
      .input('FlatNumber', sql.NVarChar(50), flatNumber)
      .query(`
        SELECT TOP 1 FlatID
        FROM dbo.Flats
        WHERE SocietyID = @SocietyID AND UPPER(FlatNumber) = UPPER(@FlatNumber)
      `);

    if (dupCheck.recordset.length > 0) {
      await transaction.rollback();
      transaction = null;
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_FLAT',
        message: `Flat Number "${flatNumber}" is already registered in ${targetSoc.SocietyName}.`
      });
    }

    const insertRes = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, targetSoc.SocietyID)
      .input('SocietyName', sql.NVarChar(150), targetSoc.SocietyName)
      .input('FlatNumber', sql.NVarChar(50), flatNumber)
      .input('OwnerName', sql.NVarChar(150), ownerName)
      .input('MobileNumber', sql.NVarChar(25), mobileNumber)
      .input('ParticipationStatus', sql.Bit, participationStatus ? 1 : 0)
      .query(`
        INSERT INTO dbo.Flats (
          SocietyID,
          SocietyName,
          FlatNumber,
          OwnerName,
          MobileNumber,
          ParticipationStatus
        )
        OUTPUT INSERTED.*
        VALUES (
          @SocietyID,
          @SocietyName,
          @FlatNumber,
          @OwnerName,
          @MobileNumber,
          @ParticipationStatus
        )
      `);

    await transaction.commit();
    transaction = null;

    return res.status(201).json({
      success: true,
      message: `Flat ${flatNumber} (${ownerName}) added successfully!`,
      flat: insertRes.recordset[0]
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
 * PUT /api/flats/:id
 * Updates flat details and checks for duplicate FlatNumber conflicts.
 */
async function updateFlat(req, res, next) {
  if (!isSqlConfigured()) return localFallback.updateFlat(req, res, next);
  let transaction;
  try {
    const flatId = parseInt(req.params.id, 10);
    if (!flatId) {
      return res.status(400).json({ success: false, message: 'Invalid Flat ID.' });
    }

    const flatNumber = normalizeFlatNumber(req.body.flatNumber);
    const ownerName = cleanString(req.body.ownerName, 150);
    const mobileNumber = cleanMobile(req.body.mobileNumber);
    const participationStatus = Boolean(
      req.body.participationStatus === true ||
        req.body.participationStatus === 1 ||
        String(req.body.participationStatus).toLowerCase() === 'true' ||
        String(req.body.participationStatus) === '1'
    );

    if (!isValidMobile(mobileNumber)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MOBILE',
        message: 'Please enter a valid mobile number (7-20 digits).'
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const existingRes = await new sql.Request(transaction)
      .input('FlatID', sql.Int, flatId)
      .query('SELECT TOP 1 * FROM dbo.Flats WHERE FlatID = @FlatID');

    if (existingRes.recordset.length === 0) {
      await transaction.rollback();
      transaction = null;
      return res.status(404).json({
        success: false,
        code: 'FLAT_NOT_FOUND',
        message: 'Flat record not found.'
      });
    }

    const existing = existingRes.recordset[0];
    const primarySociety = await ensurePrimarySociety(transaction);
    const targetSoc = req.body.societyName
      ? await resolveOrCreateSociety(transaction, null, req.body.societyName, primarySociety)
      : {
          SocietyID: parseInt(req.body.societyId, 10) || existing.SocietyID,
          SocietyName: existing.SocietyName
        };

    const dupCheck = await new sql.Request(transaction)
      .input('SocietyID', sql.Int, targetSoc.SocietyID)
      .input('FlatNumber', sql.NVarChar(50), flatNumber)
      .input('FlatID', sql.Int, flatId)
      .query(`
        SELECT TOP 1 FlatID
        FROM dbo.Flats
        WHERE SocietyID = @SocietyID
          AND UPPER(FlatNumber) = UPPER(@FlatNumber)
          AND FlatID <> @FlatID
      `);

    if (dupCheck.recordset.length > 0) {
      await transaction.rollback();
      transaction = null;
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_FLAT',
        message: `Another flat with number "${flatNumber}" already exists in ${targetSoc.SocietyName}.`
      });
    }

    const updatedRes = await new sql.Request(transaction)
      .input('FlatID', sql.Int, flatId)
      .input('SocietyID', sql.Int, targetSoc.SocietyID)
      .input('SocietyName', sql.NVarChar(150), targetSoc.SocietyName)
      .input('FlatNumber', sql.NVarChar(50), flatNumber)
      .input('OwnerName', sql.NVarChar(150), ownerName)
      .input('MobileNumber', sql.NVarChar(25), mobileNumber)
      .input('ParticipationStatus', sql.Bit, participationStatus ? 1 : 0)
      .query(`
        UPDATE dbo.Flats
        SET SocietyID = @SocietyID,
            SocietyName = @SocietyName,
            FlatNumber = @FlatNumber,
            OwnerName = @OwnerName,
            MobileNumber = @MobileNumber,
            ParticipationStatus = @ParticipationStatus,
            UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE FlatID = @FlatID
      `);

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: `Flat ${flatNumber} updated successfully!`,
      flat: updatedRes.recordset[0]
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
 * PATCH /api/flats/:id/status
 * Quick toggle for participation status.
 */
async function toggleParticipation(req, res, next) {
  if (!isSqlConfigured()) return localFallback.toggleParticipation(req, res, next);
  try {
    const flatId = parseInt(req.params.id, 10);
    const status = Boolean(req.body.participationStatus);
    const pool = await getPool();

    const updated = await pool
      .request()
      .input('FlatID', sql.Int, flatId)
      .input('Status', sql.Bit, status ? 1 : 0)
      .query(`
        UPDATE dbo.Flats
        SET ParticipationStatus = @Status, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE FlatID = @FlatID
      `);

    if (!updated.recordset.length) {
      return res.status(404).json({ success: false, message: 'Flat not found.' });
    }

    return res.json({
      success: true,
      message: `Participation status updated for Flat ${updated.recordset[0].FlatNumber}.`,
      flat: updated.recordset[0]
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/flats/:id
 * Deletes a flat inside a transaction while preserving historical Winner records.
 */
async function deleteFlat(req, res, next) {
  if (!isSqlConfigured()) return localFallback.deleteFlat(req, res, next);
  let transaction;
  try {
    const flatId = parseInt(req.params.id, 10);
    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // Detach FlatID pointer on any past Winners row so historical WinnerName/FlatNumber stays intact
    await new sql.Request(transaction)
      .input('FlatID', sql.Int, flatId)
      .query('UPDATE dbo.Winners SET FlatID = NULL WHERE FlatID = @FlatID');

    const delRes = await new sql.Request(transaction)
      .input('FlatID', sql.Int, flatId)
      .query('DELETE FROM dbo.Flats OUTPUT DELETED.FlatNumber WHERE FlatID = @FlatID');

    if (!delRes.recordset.length) {
      await transaction.rollback();
      transaction = null;
      return res.status(404).json({ success: false, message: 'Flat not found.' });
    }

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: `Flat ${delRes.recordset[0].FlatNumber} deleted successfully.`
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
 * POST /api/flats/bulk-import
 * Validates and imports flats atomically inside a SQL Server transaction.
 */
async function bulkImportFlats(req, res, next) {
  if (!isSqlConfigured()) return localFallback.bulkImportFlats(req, res, next);
  let transaction;
  try {
    const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const skipDuplicates = Boolean(req.body.skipDuplicates);

    if (rawRows.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_IMPORT',
        message: 'No flat records provided for import.'
      });
    }

    if (rawRows.length > 10000) {
      return res.status(400).json({
        success: false,
        code: 'IMPORT_LIMIT_EXCEEDED',
        message: 'Maximum 10,000 rows can be imported in a single batch.'
      });
    }

    const pool = await getPool();
    const primarySociety = await ensurePrimarySociety(pool);

    const societiesRes = await pool.request().query('SELECT SocietyID, SocietyName FROM dbo.Societies');
    const societyByLowerName = new Map();
    for (const s of societiesRes.recordset) {
      societyByLowerName.set(s.SocietyName.toLowerCase(), s);
    }

    const existingFlatsRes = await pool.request().query(`
      SELECT SocietyID, SocietyName, UPPER(FlatNumber) AS UpperFlatNo
      FROM dbo.Flats
    `);
    const existingSet = new Set(
      existingFlatsRes.recordset.map((f) => `${f.SocietyName.toLowerCase()}::${f.UpperFlatNo}`)
    );

    const seenInBatch = new Set();
    const rowErrors = [];
    const validRows = [];
    let skippedCount = 0;

    rawRows.forEach((row, idx) => {
      const rowNum = parseInt(row.rowNumber, 10) || idx + 2;
      const societyName = cleanString(row.societyName, 150) || primarySociety.SocietyName;
      const flatNumber = normalizeFlatNumber(row.flatNumber);
      const ownerName = cleanString(row.ownerName, 150);
      const mobileNumber = cleanMobile(row.mobileNumber);

      let participationStatus = true;
      if (
        row.participationStatus !== undefined &&
        row.participationStatus !== null &&
        row.participationStatus !== ''
      ) {
        const s = String(row.participationStatus).trim().toLowerCase();
        participationStatus = !['false', '0', 'no', 'inactive', 'excluded', 'n'].includes(s);
      }

      const errs = [];
      if (!societyName) errs.push('Society Name is required');
      if (!flatNumber) errs.push('Flat No is required');
      if (!ownerName) errs.push('Owner Name is required');
      if (mobileNumber && !isValidMobile(mobileNumber)) {
        errs.push('Invalid Mobile Number format');
      }

      const compositeKey = `${societyName.toLowerCase()}::${flatNumber}`;
      if (societyName && flatNumber) {
        if (seenInBatch.has(compositeKey)) {
          errs.push(`Duplicate Flat No "${flatNumber}" within uploaded file`);
        } else {
          seenInBatch.add(compositeKey);
        }

        if (existingSet.has(compositeKey)) {
          if (skipDuplicates) {
            skippedCount += 1;
            return;
          }
          errs.push(`Flat No "${flatNumber}" already exists in database for "${societyName}"`);
        }
      }

      if (errs.length > 0) {
        rowErrors.push({
          rowNumber: rowNum,
          societyName,
          flatNumber,
          ownerName,
          errors: errs
        });
      } else {
        validRows.push({
          rowNumber: rowNum,
          societyName,
          flatNumber,
          ownerName,
          mobileNumber,
          participationStatus
        });
      }
    });

    if (rowErrors.length > 0 && !req.body.importValidOnly) {
      return res.status(422).json({
        success: false,
        code: 'IMPORT_VALIDATION_ERRORS',
        message: `Found validation/duplicate issues in ${rowErrors.length} row(s). Please fix them or choose to import valid rows only.`,
        totalRows: rawRows.length,
        validCount: validRows.length,
        skippedCount,
        rowErrors
      });
    }

    if (validRows.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_VALID_ROWS',
        message:
          skippedCount > 0
            ? `All ${skippedCount} row(s) already exist in the database.`
            : 'No valid rows available to import.',
        skippedCount,
        rowErrors
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // Ensure every referenced Society exists
    for (const item of validRows) {
      const key = item.societyName.toLowerCase();
      if (!societyByLowerName.has(key)) {
        const createdSoc = await new sql.Request(transaction)
          .input('SocietyName', sql.NVarChar(150), item.societyName)
          .input('SocietyAddress', sql.NVarChar(500), primarySociety.SocietyAddress)
          .input('TotalFlats', sql.Int, Math.max(500, validRows.length))
          .input(
            'CommitteeName',
            sql.NVarChar(150),
            primarySociety.CommitteeName || 'Society Cultural & Events Committee'
          )
          .query(`
            INSERT INTO dbo.Societies (SocietyName, SocietyAddress, TotalFlats, CommitteeName)
            OUTPUT INSERTED.SocietyID, INSERTED.SocietyName
            VALUES (@SocietyName, @SocietyAddress, @TotalFlats, @CommitteeName)
          `);
        const newSoc = createdSoc.recordset[0];
        societyByLowerName.set(key, newSoc);

        await new sql.Request(transaction)
          .input('SocietyID', sql.Int, newSoc.SocietyID)
          .query(`
            INSERT INTO dbo.GameSettings (SocietyID, NoRepeatWinner, SoundEnabled, ConfettiEnabled)
            VALUES (@SocietyID, 1, 1, 1)
          `);
      }
    }

    // Batch insert in chunks of 100 rows per parameterized query (600 params < 2100 MSSQL limit)
    const BATCH_SIZE = 100;
    let importedCount = 0;

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const chunk = validRows.slice(i, i + BATCH_SIZE);
      const batchReq = new sql.Request(transaction);
      const valueClauses = [];

      chunk.forEach((r, idx) => {
        const soc = societyByLowerName.get(r.societyName.toLowerCase());
        batchReq.input(`sid_${idx}`, sql.Int, soc.SocietyID);
        batchReq.input(`sname_${idx}`, sql.NVarChar(150), soc.SocietyName);
        batchReq.input(`fno_${idx}`, sql.NVarChar(50), r.flatNumber);
        batchReq.input(`oname_${idx}`, sql.NVarChar(150), r.ownerName);
        batchReq.input(`mob_${idx}`, sql.NVarChar(25), r.mobileNumber);
        batchReq.input(`part_${idx}`, sql.Bit, r.participationStatus ? 1 : 0);

        valueClauses.push(
          `(@sid_${idx}, @sname_${idx}, @fno_${idx}, @oname_${idx}, @mob_${idx}, @part_${idx})`
        );
      });

      await batchReq.query(`
        INSERT INTO dbo.Flats (
          SocietyID,
          SocietyName,
          FlatNumber,
          OwnerName,
          MobileNumber,
          ParticipationStatus
        )
        VALUES ${valueClauses.join(',\n')}
      `);

      importedCount += chunk.length;
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${importedCount} flat(s)!`,
      importedCount,
      skippedCount,
      errorCount: rowErrors.length,
      rowErrors
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
 * GET /api/flats/export?format=xlsx|csv
 * Server-side SheetJS export of flats and owners to Excel (.xlsx) or CSV (.csv).
 */
async function exportFlats(req, res, next) {
  if (!isSqlConfigured()) return localFallback.exportFlats(req, res, next);
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        FlatID,
        SocietyName,
        FlatNumber,
        OwnerName,
        MobileNumber,
        ParticipationStatus,
        CreatedAt
      FROM dbo.Flats
      ORDER BY SocietyName ASC, FlatNumber ASC
    `);

    const rows = result.recordset.map((r, index) => ({
      'Sr No': index + 1,
      'Society Name': r.SocietyName,
      'Flat No': r.FlatNumber,
      'Owner Name': r.OwnerName,
      'Mobile Number': r.MobileNumber || '',
      'Participation Status': r.ParticipationStatus ? 'Participating' : 'Excluded',
      'Created Date': r.CreatedAt ? new Date(r.CreatedAt).toISOString().split('T')[0] : ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      rows.length > 0
        ? rows
        : [
            {
              'Sr No': '',
              'Society Name': '',
              'Flat No': '',
              'Owner Name': '',
              'Mobile Number': '',
              'Participation Status': '',
              'Created Date': ''
            }
          ]
    );

    ws['!cols'] = [
      { wch: 8 },
      { wch: 32 },
      { wch: 14 },
      { wch: 26 },
      { wch: 18 },
      { wch: 20 },
      { wch: 15 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Society Flats');

    const dateStamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Society_Flats_${dateStamp}.csv"`
      );
      return res.send('\uFEFF' + csvContent);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Society_Flats_${dateStamp}.xlsx"`
    );
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listFlats,
  getExistingFlatKeys,
  createFlat,
  updateFlat,
  toggleParticipation,
  deleteFlat,
  bulkImportFlats,
  exportFlats
};
