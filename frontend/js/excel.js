/* =========================================================================
   SOCIETY PLAY & WIN - SHEETJS EXCEL / CSV IMPORT & EXPORT (excel.js)
   Supports Upload Preview, Row Validation & Duplicate Flat Detection
   ========================================================================= */

(function () {
  let importModalInstance = null;
  let parsedRows = [];
  let showErrorsOnly = false;

  function normalizeFlatNo(val) {
    return String(val || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .toUpperCase();
  }

  function findHeaderKey(headers, candidates) {
    for (const h of headers) {
      const clean = String(h || '')
        .trim()
        .toLowerCase()
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ');
      if (candidates.includes(clean)) {
        return h;
      }
    }
    return null;
  }

  /**
   * Downloads a Sample Excel Template (.xlsx) or a 500-Flat Demo Workbook.
   */
  function downloadSampleTemplate(count = 5) {
    if (typeof XLSX === 'undefined') {
      SPW.alertModal({
        icon: 'error',
        title: 'SheetJS Not Loaded',
        text: 'Please check your internet connection for SheetJS CDN.'
      });
      return;
    }

    const socName =
      (window.SPWFlats && window.SPWFlats.getDefaultSocietyName()) ||
      'Royal Palms Co-operative Housing Society';

    const firstNames = [
      'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Priya', 'Ananya',
      'Diya', 'Neha', 'Rohan', 'Vikram', 'Kavita', 'Suresh', 'Meera', 'Rajesh',
      'Pooja', 'Nikhil', 'Sneha', 'Karan', 'Siddharth', 'Ishita', 'Gaurav', 'Swati'
    ];
    const lastNames = [
      'Sharma', 'Patel', 'Mehta', 'Verma', 'Iyer', 'Nair', 'Deshmukh', 'Kulkarni',
      'Joshi', 'Gupta', 'Malhotra', 'Kapoor', 'Reddy', 'Rao', 'Chatterjee', 'Shah'
    ];
    const wings = ['A', 'B', 'C', 'D', 'E'];

    const rows = [];
    for (let i = 0; i < count; i++) {
      const wing = wings[Math.floor(i / 100) % wings.length];
      const floor = Math.floor((i % 100) / 4) + 1;
      const unit = (i % 4) + 1;
      const flatNo = `${wing}-${floor}${String(unit).padStart(2, '0')}`;
      const owner = `${firstNames[i % firstNames.length]} ${lastNames[(i * 3) % lastNames.length]}`;
      const mobile = `98${String(10000000 + i * 137).slice(0, 8)}`;

      rows.push({
        'Society Name': socName,
        'Flat No': flatNo,
        'Owner Name': owner,
        'Mobile Number': mobile,
        'Participation Status': 'Participating'
      });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 36 },
      { wch: 14 },
      { wch: 26 },
      { wch: 18 },
      { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Flats Import Template');

    const fileName =
      count >= 500
        ? 'Society_PlayWin_500_Flats_Sample.xlsx'
        : 'Society_PlayWin_Import_Template.xlsx';

    XLSX.writeFile(wb, fileName);
    SPW.toast('success', `Downloaded ${fileName}`);
  }

  /**
   * Parses uploaded .xlsx, .xls, or .csv file using SheetJS,
   * previews records, and checks duplicates against DB & within file.
   */
  async function handleFileSelected(file) {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      SPW.alertModal({
        icon: 'error',
        title: 'Unsupported File Format',
        text: 'Please upload an .xlsx, .xls, or .csv file.'
      });
      return;
    }

    let existingSet = new Set();
    let fallbackSocietyName =
      (window.SPWFlats && window.SPWFlats.getDefaultSocietyName()) ||
      'Royal Palms Co-operative Housing Society';

    try {
      const dbKeys = await SPW.apiFetch('/flats/existing-keys');
      if (dbKeys.defaultSocietyName) {
        fallbackSocietyName = dbKeys.defaultSocietyName;
      }
      existingSet = new Set(
        (dbKeys.existing || []).map(
          (k) => `${String(k.SocietyName).toLowerCase()}::${normalizeFlatNo(k.FlatNumber)}`
        )
      );
    } catch (_) {}

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    if (!rawJson.length) {
      SPW.alertModal({
        icon: 'warning',
        title: 'Empty Spreadsheet',
        text: 'The uploaded file contains no data rows.'
      });
      return;
    }

    const headers = Object.keys(rawJson[0]);
    const socCol = findHeaderKey(headers, ['society name', 'society', 'societyname']);
    const flatCol = findHeaderKey(headers, [
      'flat no',
      'flat number',
      'flat',
      'flatno',
      'unit no',
      'unit',
      'apartment'
    ]);
    const ownerCol = findHeaderKey(headers, [
      'owner name',
      'owner',
      'ownername',
      'member name',
      'resident name',
      'name'
    ]);
    const mobileCol = findHeaderKey(headers, [
      'mobile number',
      'mobile',
      'phone',
      'contact',
      'mobile no',
      'phone number'
    ]);
    const statusCol = findHeaderKey(headers, [
      'participation status',
      'status',
      'participating',
      'participation'
    ]);

    const missingCols = [];
    if (!flatCol) missingCols.push('Flat No');
    if (!ownerCol) missingCols.push('Owner Name');

    if (missingCols.length > 0) {
      SPW.alertModal({
        icon: 'error',
        title: 'Missing Required Columns',
        html: `Your file is missing required column(s): <strong class="text-danger">${missingCols.join(', ')}</strong>.<br/><br/>Expected columns: <code>Flat No</code>, <code>Owner Name</code> (plus optional <code>Society Name</code> and <code>Mobile Number</code>).`
      });
      return;
    }

    const seenInFile = new Set();
    parsedRows = rawJson.map((r, idx) => {
      const rowNumber = idx + 2;
      const societyName = (socCol ? String(r[socCol] || '').trim() : '') || fallbackSocietyName;
      const flatNumber = normalizeFlatNo(r[flatCol]);
      const ownerName = String(r[ownerCol] || '').trim();
      const mobileNumber = mobileCol ? String(r[mobileCol] || '').trim() : '';
      const rawStatus = statusCol ? String(r[statusCol] || '').trim().toLowerCase() : 'participating';
      const participationStatus = !['false', '0', 'no', 'excluded', 'inactive', 'n'].includes(rawStatus);

      const errors = [];
      let isDbDuplicate = false;

      if (!societyName) errors.push('Missing Society Name');
      if (!flatNumber) errors.push('Missing Flat No');
      if (!ownerName) errors.push('Missing Owner Name');
      if (mobileNumber && !/^[+]?[0-9\s()-]{7,20}$/.test(mobileNumber)) {
        errors.push('Invalid Mobile Number');
      }

      const key = `${societyName.toLowerCase()}::${flatNumber}`;
      if (societyName && flatNumber) {
        if (seenInFile.has(key)) {
          errors.push('Duplicate Flat No in file');
        } else {
          seenInFile.add(key);
        }

        if (existingSet.has(key)) {
          isDbDuplicate = true;
          errors.push('Already exists in database');
        }
      }

      return {
        rowNumber,
        societyName,
        flatNumber,
        ownerName,
        mobileNumber,
        participationStatus,
        isDbDuplicate,
        errors
      };
    });

    showErrorsOnly = false;
    const errToggle = document.getElementById('previewErrorsOnlySwitch');
    if (errToggle) errToggle.checked = false;

    const selectedFileName = document.getElementById('selectedExcelFileName');
    if (selectedFileName) selectedFileName.textContent = `${file.name} (${parsedRows.length} rows)`;

    renderUploadPreview();
  }

  function renderUploadPreview() {
    const previewSection = document.getElementById('excelPreviewSection');
    const tbody = document.getElementById('excelPreviewBody');
    const confirmBtn = document.getElementById('confirmExcelImportBtn');
    const skipDupChk = document.getElementById('skipDbDuplicatesSwitch');

    if (!previewSection || !tbody) return;
    previewSection.classList.remove('d-none');

    const skipDbDups = skipDupChk ? skipDupChk.checked : false;

    const evaluated = parsedRows.map((r) => {
      const effectiveErrors = skipDbDups
        ? r.errors.filter((e) => e !== 'Already exists in database')
        : r.errors;
      const willSkip = skipDbDups && r.isDbDuplicate && effectiveErrors.length === 0;
      return { ...r, effectiveErrors, willSkip };
    });

    const validCount = evaluated.filter((r) => r.effectiveErrors.length === 0 && !r.willSkip).length;
    const errorCount = evaluated.filter((r) => r.effectiveErrors.length > 0).length;
    const skipCount = evaluated.filter((r) => r.willSkip).length;

    document.getElementById('prevTotalCount').textContent = evaluated.length.toLocaleString();
    document.getElementById('prevValidCount').textContent = validCount.toLocaleString();
    document.getElementById('prevErrorCount').textContent = errorCount.toLocaleString();

    const filtered = showErrorsOnly
      ? evaluated.filter((r) => r.effectiveErrors.length > 0)
      : evaluated;

    const displaySlice = filtered.slice(0, 300);

    tbody.innerHTML = displaySlice
      .map((r) => {
        const hasErr = r.effectiveErrors.length > 0;
        let statusHtml = '<span class="badge-participating"><i class="fa-solid fa-check me-1"></i>Valid</span>';
        if (hasErr) {
          statusHtml = `<span class="badge-excluded"><i class="fa-solid fa-circle-xmark me-1"></i>${SPW.escapeHtml(r.effectiveErrors.join(', '))}</span>`;
        } else if (r.willSkip) {
          statusHtml = '<span class="badge bg-secondary">Skipped (Duplicate in DB)</span>';
        }

        return `
          <tr class="${hasErr ? 'row-invalid' : 'row-valid'}">
            <td class="text-muted-light">Row ${r.rowNumber}</td>
            <td>${SPW.escapeHtml(r.societyName || '—')}</td>
            <td class="fw-bold text-neon-blue">${SPW.escapeHtml(r.flatNumber || '—')}</td>
            <td>${SPW.escapeHtml(r.ownerName || '—')}</td>
            <td>${SPW.escapeHtml(r.mobileNumber || '—')}</td>
            <td>${statusHtml}</td>
          </tr>
        `;
      })
      .join('');

    if (filtered.length > 300) {
      tbody.innerHTML += `
        <tr>
          <td colspan="6" class="text-center text-muted-light small py-2">
            Showing first 300 of ${filtered.length.toLocaleString()} rows in preview — all ${validCount.toLocaleString()} valid rows will be imported.
          </td>
        </tr>
      `;
    }

    if (confirmBtn) {
      confirmBtn.disabled = validCount === 0;
      confirmBtn.innerHTML =
        errorCount > 0
          ? `<i class="fa-solid fa-file-import me-2"></i>Import ${validCount.toLocaleString()} Valid Rows`
          : `<i class="fa-solid fa-cloud-arrow-up me-2"></i>Confirm Import (${validCount.toLocaleString()} Flats)${skipCount ? ` • Skip ${skipCount}` : ''}`;
    }
  }

  async function confirmBulkImport() {
    if (!parsedRows.length) return;

    const skipDupChk = document.getElementById('skipDbDuplicatesSwitch');
    const skipDuplicates = skipDupChk ? skipDupChk.checked : false;
    const confirmBtn = document.getElementById('confirmExcelImportBtn');

    confirmBtn.disabled = true;
    const origHtml = confirmBtn.innerHTML;
    confirmBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2"></span>Importing to SQL Server...';

    try {
      const res = await SPW.apiFetch('/flats/bulk-import', {
        method: 'POST',
        body: {
          rows: parsedRows,
          skipDuplicates,
          importValidOnly: true
        }
      });

      SPW.sound.play('jackpot', { volume: 0.45 });
      await SPW.alertModal({
        icon: 'success',
        title: 'Import Complete!',
        html: `Successfully imported <strong class="text-gold">${res.importedCount.toLocaleString()}</strong> flat(s) into SQL Server.${
          res.skippedCount ? `<br/><small>Skipped ${res.skippedCount} existing duplicate(s).</small>` : ''
        }${
          res.errorCount ? `<br/><small class="text-warning">Ignored ${res.errorCount} invalid row(s).</small>` : ''
        }`
      });

      parsedRows = [];
      document.getElementById('excelPreviewSection').classList.add('d-none');
      document.getElementById('excelFileInput').value = '';
      if (importModalInstance) importModalInstance.hide();

      if (window.SPWFlats) {
        await window.SPWFlats.reloadSocieties();
        await window.SPWFlats.refreshFlats();
      }
    } catch (err) {
      SPW.alertModal({
        icon: 'error',
        title: 'Excel Import Failed',
        text: err.message
      });
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = origHtml;
    }
  }

  async function exportFlatsFile(format) {
    try {
      SPW.toast('info', `Preparing ${format.toUpperCase()} export...`);
      await SPW.downloadFile(
        `/flats/export?format=${encodeURIComponent(format)}`,
        `Society_Flats.${format}`
      );
    } catch (err) {
      SPW.alertModal({
        icon: 'error',
        title: 'Export Failed',
        text: err.message
      });
    }
  }

  function initExcelControls() {
    const modalEl = document.getElementById('excelImportModal');
    if (!modalEl) return;

    if (typeof bootstrap !== 'undefined') {
      importModalInstance = new bootstrap.Modal(modalEl);
    }

    const openBtn = document.getElementById('openExcelImportBtn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        SPW.sound.play('click');
        if (importModalInstance) importModalInstance.show();
      });
    }

    const dropzone = document.getElementById('excelDropzone');
    const fileInput = document.getElementById('excelFileInput');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFileSelected(file);
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) handleFileSelected(file);
      });
    }

    const sampleBtn = document.getElementById('downloadSampleTemplateBtn');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        downloadSampleTemplate(5);
      });
    }

    const sample500Btn = document.getElementById('downloadSample500Btn');
    if (sample500Btn) {
      sample500Btn.addEventListener('click', (e) => {
        e.preventDefault();
        downloadSampleTemplate(500);
      });
    }

    const errSwitch = document.getElementById('previewErrorsOnlySwitch');
    if (errSwitch) {
      errSwitch.addEventListener('change', () => {
        showErrorsOnly = errSwitch.checked;
        renderUploadPreview();
      });
    }

    const skipSwitch = document.getElementById('skipDbDuplicatesSwitch');
    if (skipSwitch) {
      skipSwitch.addEventListener('change', renderUploadPreview);
    }

    const confirmBtn = document.getElementById('confirmExcelImportBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', confirmBulkImport);
    }

    const exportXlsxBtn = document.getElementById('exportFlatsExcelBtn');
    if (exportXlsxBtn) {
      exportXlsxBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportFlatsFile('xlsx');
      });
    }

    const exportCsvBtn = document.getElementById('exportFlatsCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportFlatsFile('csv');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initExcelControls);
})();
