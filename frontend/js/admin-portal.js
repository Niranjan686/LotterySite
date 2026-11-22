/* =========================================================================
   ROYAL PALMS FLAT ALLOCATION PORTAL - COMPLETE 11-MODULE ADMIN CONTROLLER
   Connected 100% to MongoDB Backend (/api/lottery/*) — Zero Dummy Statistics
   ========================================================================= */

(function () {
  const portalState = {
    admin: null,
    event: null,
    summary: null,
    activeTab: 'tab-overview',
    partPage: 1,
    partTotalPages: 1,
    partPreviewRows: [],
    flatPage: 1,
    flatTotalPages: 1,
    lastReportDataset: null
  };

  let ticketModal = null;
  let participantModal = null;
  let flatModal = null;

  const TAB_TITLES = {
    'tab-overview': 'Overview Dashboard',
    'tab-participants': 'Upload & Manage Participants (500+)',
    'tab-flats': 'Manage Flat Numbers & Sequence',
    'tab-fixed-mapping': 'Fixed Allocation / Manual Mapping',
    'tab-lottery-config': 'Lottery Configuration & Execution',
    'tab-live-lottery': 'Live Lottery Presentation Control',
    'tab-history': 'Allocation History & Audit Verification',
    'tab-winners': 'Official Winners & Allottees List',
    'tab-reports': 'Reports, Ticket Printing & Exports',
    'tab-settings': 'Settings, Audit Logs & MongoDB Backup',
    'tab-admins': 'Admin Users & Role Permissions'
  };

  async function initAdminPortal() {
    if (typeof bootstrap !== 'undefined') {
      const tm = document.getElementById('admTicketPreviewModal');
      const pm = document.getElementById('admParticipantModal');
      const fm = document.getElementById('admFlatModal');
      if (tm) ticketModal = new bootstrap.Modal(tm);
      if (pm) participantModal = new bootstrap.Modal(pm);
      if (fm) flatModal = new bootstrap.Modal(fm);
    }

    document.getElementById('admRefreshAllBtn')?.addEventListener('click', () => {
      switchTab(portalState.activeTab);
    });
    document.getElementById('admDemoResetBtn')?.addEventListener('click', openDemoControlModal);
    bindNavigation();
    bindParticipantsModule();
    bindFlatsModule();
    bindFixedMappingsModule();
    bindLotteryConfigModule();
    bindHistoryAndWinnersModules();
    bindReportsModule();
    bindSettingsAndAdminsModule();

    RPLottery.onBroadcast(() => {
      loadOverviewDashboard();
    });

    await loadCurrentCommitteeAdmin();
    await loadOverviewDashboard();
  }

  /* =======================================================================
     DIRECT OPEN ACCESS (NO SIGN-IN REQUIRED)
     ======================================================================= */
  async function loadCurrentCommitteeAdmin() {
    try {
      const res = await RPLottery.apiFetch('/auth/me');
      portalState.admin = res.admin;
      const a = res.admin;
      if (a) {
        const nameEl = document.getElementById('admCurrentUserName');
        const roleEl = document.getElementById('admCurrentUserRole');
        if (nameEl) nameEl.textContent = a.fullName || a.username;
        if (roleEl) roleEl.textContent = a.role;
      }
    } catch (_) {}
  }

  /* =======================================================================
     NAVIGATION ACROSS ALL 11 MODULES
     ======================================================================= */
  function bindNavigation() {
    document.querySelectorAll('#adminSidebarNav .sidebar-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    document.querySelectorAll('.js-jump-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-target'));
      });
    });
  }

  async function switchTab(tabId) {
    portalState.activeTab = tabId;
    document.querySelectorAll('#adminSidebarNav .sidebar-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.adm-module-pane').forEach((p) => {
      p.classList.toggle('active', p.id === tabId);
    });

    const titleEl = document.getElementById('admActiveModuleTitle');
    if (titleEl) titleEl.textContent = TAB_TITLES[tabId] || 'Admin Portal';

    if (tabId === 'tab-overview') await loadOverviewDashboard();
    else if (tabId === 'tab-participants') await loadParticipantsTable();
    else if (tabId === 'tab-flats') await loadFlatsInventory();
    else if (tabId === 'tab-fixed-mapping') await loadFixedMappingsModule();
    else if (tabId === 'tab-lottery-config') await loadLotteryConfigModule();
    else if (tabId === 'tab-live-lottery') await loadLiveOperatorTab();
    else if (tabId === 'tab-history') await loadAllocationHistory();
    else if (tabId === 'tab-winners') await loadWinnersDirectory();
    else if (tabId === 'tab-reports') await loadReportPreview();
    else if (tabId === 'tab-settings') await loadSettingsAndAuditLogs();
    else if (tabId === 'tab-admins') await loadAdminUsersModule();
  }

  async function openTicketPreviewModal(allocationId) {
    try {
      const res = await RPLottery.apiFetch(`/allocations/${encodeURIComponent(allocationId)}/ticket`);
      const mount = document.getElementById('admTicketModalMount');
      mount.innerHTML = RPLottery.renderLuxuryTicketHtml(res.ticket, res.event);
      RPLottery.bindTicketActionButtons(mount, async () => res.ticket, res.event);
      if (ticketModal) ticketModal.show();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Ticket Error', text: err.message });
    }
  }

  /* =======================================================================
     REPEATABLE DEMO CONTROLLER (LOAD DUMMY DATA / RESET DRAWS N TIMES)
     ======================================================================= */
  async function openDemoControlModal() {
    const res = await Swal.fire({
      title: 'Repeatable Demo Controller (Run N Times)',
      html: `
        <div class="text-start small">
          <p class="text-secondary mb-2">
            Choose an action below to prepare or reset your demonstration at any time:
          </p>
          <div class="mb-2">
            <label class="form-label fw-bold mb-1">Select Demo Action</label>
            <select id="swalDemoModeSelect" class="form-select form-select-sm">
              <option value="reset-draws">1. Reset Random Draws Only (Keep Current Participants, Flats &amp; Fixed Mappings)</option>
              <option value="load-25" selected>2. Load Quick Stage Demo (25 Participants, 25 Flats, 3 Fixed + 22 Random)</option>
              <option value="load-60">3. Load Medium Society Demo (60 Participants, 60 Flats, 3 Fixed + 57 Random)</option>
              <option value="load-520">4. Load Full-Scale 520+ Society Demo (520 Participants, 520 Flats, 3 Fixed + 517 Random)</option>
            </select>
          </div>
          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="swalDemoIncludeFixed" checked />
            <label class="form-check-label" for="swalDemoIncludeFixed">
              Pre-configure <strong>3 Fixed Flat Mappings</strong> (Rahul Sharma &rarr; 101, Amit Patel &rarr; 203, Neha Shah &rarr; 305)
            </label>
          </div>
          <div class="form-check mt-1">
            <input class="form-check-input" type="checkbox" id="swalDemoAutoLive" checked />
            <label class="form-check-label" for="swalDemoAutoLive">
              Set Event Status directly to <strong>LIVE</strong> (ready for instant 1-click draw on Live Show Screen)
            </label>
          </div>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Apply Demo Setup Now',
      confirmButtonColor: '#b7892e',
      preConfirm: () => ({
        mode: document.getElementById('swalDemoModeSelect')?.value || 'load-25',
        includeFixed: Boolean(document.getElementById('swalDemoIncludeFixed')?.checked),
        autoStartLive: Boolean(document.getElementById('swalDemoAutoLive')?.checked)
      })
    });

    if (!res.isConfirmed || !res.value) return;

    try {
      const { mode, includeFixed, autoStartLive } = res.value;
      let out;
      if (mode === 'reset-draws') {
        out = await RPLottery.apiFetch('/demo/reset-draws', {
          method: 'POST',
          body: { autoStartLive }
        });
      } else {
        const count = mode === 'load-520' ? 520 : mode === 'load-60' ? 60 : 25;
        out = await RPLottery.apiFetch('/demo/load', {
          method: 'POST',
          body: { count, includeFixed, autoStartLive }
        });
      }

      RPLottery.broadcastEvent('EVENT_UPDATED');
      await switchTab(portalState.activeTab);
      RPLottery.toast('success', out.message);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Demo Setup Error', text: err.message });
    }
  }

  /* =======================================================================
     MODULE 1: OVERVIEW DASHBOARD
     ======================================================================= */
  async function loadOverviewDashboard() {
    try {
      const data = await RPLottery.apiFetch('/overview');
      portalState.event = data.event;
      portalState.summary = data.summary;

      const s = data.summary || {};
      const ev = data.event || {};

      const setTxt = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Number(v || 0).toLocaleString();
      };

      setTxt('kpiTotalParticipants', s.totalParticipants);
      setTxt('kpiTotalFlats', s.totalFlats);
      setTxt('kpiFixedAllocations', s.fixedAllocations);
      setTxt('kpiRandomAllocations', s.randomAllocations);
      setTxt('kpiRemainingParticipants', s.remainingParticipants);
      setTxt('kpiRemainingFlats', s.remainingFlats);
      setTxt('kpiTotalAllocated', s.totalAllocated);
      setTxt('kpiPendingAllocations', s.pendingAllocations);

      document.getElementById('admTopEventStatus').textContent = `STATUS: ${ev.status || 'DRAFT'}`;
      document.getElementById('admSocietySubLabel').textContent = `${ev.societyName || 'Royal Palms'} • ${ev.eventName || ''}`;
      if (ev.societyLogo) {
        document.getElementById('admSidebarLogo').src = ev.societyLogo;
      }

      const alertDiv = document.getElementById('overviewMismatchAlert');
      if (alertDiv) {
        alertDiv.innerHTML = s.mismatchWarning
          ? `<div class="alert alert-warning py-2 px-3 small mb-3">
               <i class="fa-solid fa-triangle-exclamation me-1"></i><strong>Pool Count Notice:</strong> ${RPLottery.escapeHtml(s.mismatchWarning)}
             </div>`
          : '';
      }

      const tbody = document.getElementById('overviewRecentBody');
      const recs = data.recentAllocations || [];
      if (!recs.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No allocations recorded yet. Upload participants &amp; flats to begin.</td></tr>`;
      } else {
        tbody.innerHTML = recs
          .map(
            (a) => `
            <tr>
              <td class="fw-bold">${RPLottery.escapeHtml(a.allocationId)}</td>
              <td><span class="pill-status ${a.allocationType === 'FIXED' ? 'pill-fixed' : 'pill-random'}">${RPLottery.escapeHtml(a.allocationType)}</span></td>
              <td>
                <div class="fw-semibold">${RPLottery.escapeHtml(a.participantName)}</div>
                <small class="text-muted">${RPLottery.escapeHtml(a.participantId)}</small>
              </td>
              <td class="fw-bold fs-6">${RPLottery.escapeHtml(a.flatNumber)}</td>
              <td class="text-secondary small">${RPLottery.escapeHtml([a.wing, a.floor ? 'Flr ' + a.floor : ''].filter(Boolean).join(' • ') || '—')}</td>
              <td class="small text-secondary">${RPLottery.escapeHtml(RPLottery.formatDateTime(a.allocatedAt))}</td>
              <td class="text-end">
                <button type="button" class="btn btn-sm btn-adm-outline js-open-ticket" data-id="${RPLottery.escapeHtml(a.allocationId)}">
                  <i class="fa-solid fa-ticket me-1"></i>Ticket
                </button>
              </td>
            </tr>
          `
          )
          .join('');

        tbody.querySelectorAll('.js-open-ticket').forEach((b) => {
          b.addEventListener('click', () => openTicketPreviewModal(b.getAttribute('data-id')));
        });
      }
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 2: UPLOAD & MANAGE PARTICIPANTS (500+)
     ======================================================================= */
  function bindParticipantsModule() {
    document.getElementById('dlPartTemplateXlsx')?.addEventListener('click', () => {
      RPLottery.downloadFile('/participants/template?format=xlsx', 'Participants_Template.xlsx');
    });
    document.getElementById('dlPartTemplateCsv')?.addEventListener('click', () => {
      RPLottery.downloadFile('/participants/template?format=csv', 'Participants_Template.csv');
    });
    document.getElementById('dlPartSample500')?.addEventListener('click', () => {
      RPLottery.downloadFile(
        '/participants/template?format=xlsx&sample=520',
        'RoyalPalms_520_Participants_Sample.xlsx'
      );
    });

    const drop = document.getElementById('partDropArea');
    const fileInp = document.getElementById('partFileInput');
    if (drop && fileInp) {
      drop.addEventListener('click', () => fileInp.click());
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('border-warning');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('border-warning'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('border-warning');
        if (e.dataTransfer.files?.[0]) handleParticipantSpreadsheet(e.dataTransfer.files[0]);
      });
      fileInp.addEventListener('change', () => {
        if (fileInp.files?.[0]) handleParticipantSpreadsheet(fileInp.files[0]);
      });
    }

    document.getElementById('partRevalidateBtn')?.addEventListener('click', revalidateParticipantPreview);
    document.getElementById('partCancelPreviewBtn')?.addEventListener('click', () => {
      portalState.partPreviewRows = [];
      document.getElementById('partPreviewContainer').classList.add('d-none');
      if (fileInp) fileInp.value = '';
    });

    document.getElementById('partConfirmImportBtn')?.addEventListener('click', async () => {
      await revalidateParticipantPreview();
      const skipDuplicates = document.getElementById('partSkipDbDups').checked;
      try {
        const res = await RPLottery.apiFetch('/participants/bulk-import', {
          method: 'POST',
          body: {
            rows: portalState.partPreviewRows,
            skipDuplicates,
            importValidOnly: true
          }
        });
        RPLottery.toast('success', res.message);
        document.getElementById('partPreviewContainer').classList.add('d-none');
        portalState.partPreviewRows = [];
        if (fileInp) fileInp.value = '';
        await loadParticipantsTable();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Import Blocked', text: err.message });
      }
    });

    let searchTimer = null;
    document.getElementById('partSearchInput')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        portalState.partPage = 1;
        loadParticipantsTable();
      }, 240);
    });
    document.getElementById('partStatusFilter')?.addEventListener('change', () => {
      portalState.partPage = 1;
      loadParticipantsTable();
    });
    document.getElementById('partWingFilter')?.addEventListener('change', () => {
      portalState.partPage = 1;
      loadParticipantsTable();
    });

    document.getElementById('partPrevPageBtn')?.addEventListener('click', () => {
      if (portalState.partPage > 1) {
        portalState.partPage -= 1;
        loadParticipantsTable();
      }
    });
    document.getElementById('partNextPageBtn')?.addEventListener('click', () => {
      if (portalState.partPage < portalState.partTotalPages) {
        portalState.partPage += 1;
        loadParticipantsTable();
      }
    });

    document.getElementById('openAddParticipantModalBtn')?.addEventListener('click', () => {
      document.getElementById('admPartModalTitle').textContent = 'Add Participant';
      document.getElementById('editPartMongoId').value = '';
      document.getElementById('admParticipantForm').reset();
      if (participantModal) participantModal.show();
    });

    document.getElementById('admParticipantForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editPartMongoId').value;
      const body = {
        participantId: document.getElementById('formPartId').value.trim(),
        fullName: document.getElementById('formPartName').value.trim(),
        registrationNumber: document.getElementById('formPartReg').value.trim(),
        mobileNumber: document.getElementById('formPartMobile').value.trim(),
        wingPreference: document.getElementById('formPartWing').value.trim(),
        notes: document.getElementById('formPartNotes').value.trim()
      };

      try {
        if (id) {
          await RPLottery.apiFetch(`/participants/${id}`, { method: 'PUT', body });
          RPLottery.toast('success', 'Participant updated.');
        } else {
          await RPLottery.apiFetch('/participants', { method: 'POST', body });
          RPLottery.toast('success', 'Participant added.');
        }
        if (participantModal) participantModal.hide();
        await loadParticipantsTable();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Validation Error', text: err.message });
      }
    });
  }

  async function handleParticipantSpreadsheet(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!rawJson.length) {
        Swal.fire({ icon: 'warning', title: 'Empty File', text: 'No rows found in uploaded file.' });
        return;
      }

      portalState.partPreviewRows = rawJson.map((r, i) => ({
        rowNumber: i + 2,
        participantId: String(
          r['Unique Participant ID'] || r['Participant ID'] || r.participantId || r.ID || ''
        ).trim(),
        fullName: String(
          r['Full Name'] || r['Participant Name'] || r.fullName || r.Name || ''
        ).trim(),
        registrationNumber: String(
          r['Registration Number'] || r['Reg No'] || r.registrationNumber || ''
        ).trim(),
        mobileNumber: String(r['Mobile Number'] || r.Mobile || r.mobileNumber || '').trim(),
        wingPreference: String(r['Wing or Building'] || r.Wing || r.Building || r.wingPreference || '').trim(),
        notes: String(r.Notes || r.notes || '').trim()
      }));

      await revalidateParticipantPreview();
      document.getElementById('partPreviewContainer').classList.remove('d-none');
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Parse Error', text: err.message });
    }
  }

  async function revalidateParticipantPreview() {
    // Sync inline edits from preview inputs first
    const tbody = document.getElementById('partPreviewTableBody');
    if (tbody && tbody.children.length === portalState.partPreviewRows.length) {
      tbody.querySelectorAll('tr').forEach((tr, idx) => {
        const pidInp = tr.querySelector('.js-prev-pid');
        const nameInp = tr.querySelector('.js-prev-name');
        if (pidInp && portalState.partPreviewRows[idx]) {
          portalState.partPreviewRows[idx].participantId = pidInp.value.trim();
        }
        if (nameInp && portalState.partPreviewRows[idx]) {
          portalState.partPreviewRows[idx].fullName = nameInp.value.trim();
        }
      });
    }

    if (!portalState.partPreviewRows.length) return;

    const previewRes = await RPLottery.apiFetch('/participants/preview', {
      method: 'POST',
      body: { rows: portalState.partPreviewRows }
    });

    portalState.partPreviewRows = previewRes.rows;
    document.getElementById('partPrevTotal').textContent = previewRes.totalRows;
    document.getElementById('partPrevValid').textContent = previewRes.validCount;
    document.getElementById('partPrevInvalid').textContent = previewRes.invalidCount;

    // Render up to 250 rows in DOM for ultra-fast interactive correction (while keeping all 500-5000 rows in memory)
    const displaySlice = previewRes.rows.slice(0, 250);
    tbody.innerHTML = displaySlice
      .map(
        (r, idx) => `
        <tr class="${r.isValid ? '' : 'adm-row-invalid'}">
          <td>${r.rowNumber}</td>
          <td><input type="text" class="form-control form-control-sm js-prev-pid" value="${RPLottery.escapeHtml(r.participantId)}" /></td>
          <td><input type="text" class="form-control form-control-sm js-prev-name" value="${RPLottery.escapeHtml(r.fullName)}" /></td>
          <td>${RPLottery.escapeHtml(r.registrationNumber || '—')}</td>
          <td>${RPLottery.escapeHtml(r.mobileNumber || '—')}</td>
          <td>${RPLottery.escapeHtml(r.wingPreference || '—')}</td>
          <td>
            ${
              r.isValid
                ? '<span class="pill-status pill-pending">Valid</span>'
                : `<span class="text-danger small fw-bold">${RPLottery.escapeHtml(r.errors.join('; '))}</span>`
            }
          </td>
          <td>
            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 js-remove-prev-row" data-idx="${idx}">&times;</button>
          </td>
        </tr>
      `
      )
      .join('');

    tbody.querySelectorAll('.js-remove-prev-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-idx'), 10);
        portalState.partPreviewRows.splice(i, 1);
        revalidateParticipantPreview();
      });
    });
  }

  async function loadParticipantsTable() {
    try {
      const search = document.getElementById('partSearchInput')?.value.trim() || '';
      const status = document.getElementById('partStatusFilter')?.value || 'all';
      const wing = document.getElementById('partWingFilter')?.value || '';

      const qs = new URLSearchParams({
        page: String(portalState.partPage),
        limit: '50',
        search,
        status,
        wing
      });
      const data = await RPLottery.apiFetch(`/participants?${qs.toString()}`);
      portalState.partTotalPages = data.pagination.totalPages;

      const wingSel = document.getElementById('partWingFilter');
      if (wingSel && Array.isArray(data.wings)) {
        const prev = wingSel.value;
        wingSel.innerHTML =
          '<option value="">All Wings</option>' +
          data.wings
            .map(
              (w) =>
                `<option value="${RPLottery.escapeHtml(w)}" ${w === prev ? 'selected' : ''}>${RPLottery.escapeHtml(w)}</option>`
            )
            .join('');
      }

      document.getElementById('partCountBadge').textContent =
        `${data.pagination.totalRecords.toLocaleString()} of ${data.summary.totalAll.toLocaleString()} total`;
      document.getElementById('partPageLabel').textContent =
        `Page ${data.pagination.page} of ${data.pagination.totalPages}`;

      const tbody = document.getElementById('participantsTableBody');
      if (!data.participants.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No participants found. Upload an Excel/CSV sheet above.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.participants
        .map((p) => {
          const pillCls =
            p.allocationStatus === 'PENDING'
              ? 'pill-pending'
              : p.allocationStatus === 'FIXED_MAPPED'
                ? 'pill-fixed'
                : 'pill-allocated';
          return `
            <tr>
              <td class="fw-bold">${RPLottery.escapeHtml(p.participantId)}</td>
              <td class="fw-semibold">${RPLottery.escapeHtml(p.fullName)}</td>
              <td class="text-secondary">${RPLottery.escapeHtml(p.registrationNumber || '—')}</td>
              <td class="text-secondary">${RPLottery.escapeHtml(p.mobileNumber || '—')}</td>
              <td>${RPLottery.escapeHtml(p.wingPreference || '—')}</td>
              <td><span class="pill-status ${pillCls}">${RPLottery.escapeHtml(p.allocationStatus)}</span></td>
              <td class="fw-bold">${RPLottery.escapeHtml(p.allocatedFlatNumber || '—')}</td>
              <td class="text-end">
                <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-edit-part" data-json="${RPLottery.escapeHtml(JSON.stringify(p))}" ${p.allocationStatus === 'ALLOCATED' ? 'disabled' : ''}>
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 js-del-part" data-id="${p._id}" data-name="${RPLottery.escapeHtml(p.fullName)}" ${p.allocationStatus !== 'PENDING' ? 'disabled' : ''}>
                  <i class="fa-solid fa-trash"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join('');

      tbody.querySelectorAll('.js-edit-part').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = JSON.parse(btn.getAttribute('data-json'));
          document.getElementById('admPartModalTitle').textContent = 'Edit Participant';
          document.getElementById('editPartMongoId').value = p._id;
          document.getElementById('formPartId').value = p.participantId;
          document.getElementById('formPartName').value = p.fullName;
          document.getElementById('formPartReg').value = p.registrationNumber || '';
          document.getElementById('formPartMobile').value = p.mobileNumber || '';
          document.getElementById('formPartWing').value = p.wingPreference || '';
          document.getElementById('formPartNotes').value = p.notes || '';
          if (participantModal) participantModal.show();
        });
      });

      tbody.querySelectorAll('.js-del-part').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          const ok = await Swal.fire({
            title: `Remove ${name}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Remove'
          });
          if (!ok.isConfirmed) return;
          try {
            await RPLottery.apiFetch(`/participants/${id}`, { method: 'DELETE' });
            RPLottery.toast('success', 'Participant removed.');
            await loadParticipantsTable();
          } catch (err) {
            Swal.fire({ icon: 'error', title: 'Cannot Delete', text: err.message });
          }
        });
      });
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 3: MANAGE FLAT NUMBERS
     ======================================================================= */
  function bindFlatsModule() {
    document.getElementById('dlFlatTemplateXlsx')?.addEventListener('click', () => {
      RPLottery.downloadFile('/flats/template?format=xlsx', 'Flats_Template.xlsx');
    });
    document.getElementById('dlFlatSample500')?.addEventListener('click', () => {
      RPLottery.downloadFile(
        '/flats/template?format=xlsx&sample=520',
        'RoyalPalms_520_Flats_Sample.xlsx'
      );
    });

    const drop = document.getElementById('flatDropArea');
    const fileInp = document.getElementById('flatFileInput');
    if (drop && fileInp) {
      drop.addEventListener('click', () => fileInp.click());
      drop.addEventListener('dragover', (e) => e.preventDefault());
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.[0]) handleFlatsSpreadsheet(e.dataTransfer.files[0]);
      });
      fileInp.addEventListener('change', () => {
        if (fileInp.files?.[0]) handleFlatsSpreadsheet(fileInp.files[0]);
      });
    }

    document.getElementById('flatSeqSubmitBtn')?.addEventListener('click', async () => {
      const sequenceText = document.getElementById('flatSequenceTextarea').value.trim();
      const wing = document.getElementById('flatSeqWing').value.trim();
      const building = document.getElementById('flatSeqBuilding').value.trim();
      if (!sequenceText) return;

      try {
        const res = await RPLottery.apiFetch('/flats/bulk-import', {
          method: 'POST',
          body: { sequenceText, wing, building, skipDuplicates: true, importValidOnly: true }
        });
        RPLottery.toast('success', res.message);
        document.getElementById('flatSequenceTextarea').value = '';
        await loadFlatsInventory();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Flat Sequence Error', text: err.message });
      }
    });

    let fTimer = null;
    document.getElementById('flatSearchInput')?.addEventListener('input', () => {
      clearTimeout(fTimer);
      fTimer = setTimeout(() => {
        portalState.flatPage = 1;
        loadFlatsInventory();
      }, 240);
    });
    ['flatStatusFilter', 'flatWingFilter', 'flatFloorFilter'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        portalState.flatPage = 1;
        loadFlatsInventory();
      });
    });

    document.getElementById('flatPrevPageBtn')?.addEventListener('click', () => {
      if (portalState.flatPage > 1) {
        portalState.flatPage -= 1;
        loadFlatsInventory();
      }
    });
    document.getElementById('flatNextPageBtn')?.addEventListener('click', () => {
      if (portalState.flatPage < portalState.flatTotalPages) {
        portalState.flatPage += 1;
        loadFlatsInventory();
      }
    });

    document.getElementById('openAddFlatModalBtn')?.addEventListener('click', () => {
      document.getElementById('admFlatModalTitle').textContent = 'Add Single Flat';
      document.getElementById('editFlatMongoId').value = '';
      document.getElementById('admFlatForm').reset();
      if (flatModal) flatModal.show();
    });

    document.getElementById('admFlatForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editFlatMongoId').value;
      const body = {
        flatNumber: document.getElementById('formFlatNo').value.trim(),
        wing: document.getElementById('formFlatWing').value.trim(),
        floor: document.getElementById('formFlatFloor').value.trim(),
        building: document.getElementById('formFlatBuilding').value.trim()
      };
      try {
        if (id) {
          await RPLottery.apiFetch(`/flats/${id}`, { method: 'PUT', body });
          RPLottery.toast('success', 'Flat updated.');
        } else {
          await RPLottery.apiFetch('/flats', { method: 'POST', body });
          RPLottery.toast('success', 'Flat added.');
        }
        if (flatModal) flatModal.hide();
        await loadFlatsInventory();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Flat Error', text: err.message });
      }
    });
  }

  async function handleFlatsSpreadsheet(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const res = await RPLottery.apiFetch('/flats/bulk-import', {
        method: 'POST',
        body: { rows, skipDuplicates: true, importValidOnly: true }
      });
      RPLottery.toast('success', res.message);
      await loadFlatsInventory();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Flat Upload Error', text: err.message });
    }
  }

  async function loadFlatsInventory() {
    try {
      const qs = new URLSearchParams({
        page: String(portalState.flatPage),
        limit: '50',
        search: document.getElementById('flatSearchInput')?.value.trim() || '',
        status: document.getElementById('flatStatusFilter')?.value || 'all',
        wing: document.getElementById('flatWingFilter')?.value || '',
        floor: document.getElementById('flatFloorFilter')?.value || ''
      });

      const data = await RPLottery.apiFetch(`/flats?${qs.toString()}`);
      portalState.flatTotalPages = data.pagination.totalPages;

      const wingSel = document.getElementById('flatWingFilter');
      if (wingSel && Array.isArray(data.wings)) {
        const prev = wingSel.value;
        wingSel.innerHTML =
          '<option value="">All Wings</option>' +
          data.wings.map((w) => `<option value="${RPLottery.escapeHtml(w)}" ${w === prev ? 'selected' : ''}>${RPLottery.escapeHtml(w)}</option>`).join('');
      }
      const floorSel = document.getElementById('flatFloorFilter');
      if (floorSel && Array.isArray(data.floors)) {
        const prev = floorSel.value;
        floorSel.innerHTML =
          '<option value="">All Floors</option>' +
          data.floors.map((f) => `<option value="${RPLottery.escapeHtml(f)}" ${f === prev ? 'selected' : ''}>Floor ${RPLottery.escapeHtml(f)}</option>`).join('');
      }

      document.getElementById('flatCountBadge').textContent =
        `${data.pagination.totalRecords.toLocaleString()} / ${data.summary.totalAll.toLocaleString()} flats`;
      document.getElementById('flatPageLabel').textContent =
        `Page ${data.pagination.page} of ${data.pagination.totalPages}`;

      const tbody = document.getElementById('flatsInventoryBody');
      if (!data.flats.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No flats in inventory yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.flats
        .map((f) => {
          const cls =
            f.status === 'AVAILABLE'
              ? 'pill-available'
              : f.status === 'FIXED_MAPPED'
                ? 'pill-fixed'
                : 'pill-allocated';
          return `
            <tr>
              <td class="fw-bold fs-6">${RPLottery.escapeHtml(f.flatNumber)}</td>
              <td>${RPLottery.escapeHtml(f.wing || '—')}</td>
              <td>${RPLottery.escapeHtml(f.floor || '—')}</td>
              <td class="text-secondary">${RPLottery.escapeHtml(f.building || '—')}</td>
              <td><span class="pill-status ${cls}">${RPLottery.escapeHtml(f.status)}</span></td>
              <td>${RPLottery.escapeHtml(f.allocatedParticipantName || '—')}</td>
              <td><code>${RPLottery.escapeHtml(f.allocationId || '—')}</code></td>
              <td class="text-end">
                <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-edit-flat" data-json="${RPLottery.escapeHtml(JSON.stringify(f))}" ${f.status === 'ALLOCATED' ? 'disabled' : ''}>
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 js-del-flat" data-id="${f._id}" data-no="${RPLottery.escapeHtml(f.flatNumber)}" ${f.status !== 'AVAILABLE' ? 'disabled' : ''}>
                  <i class="fa-solid fa-trash"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join('');

      tbody.querySelectorAll('.js-edit-flat').forEach((btn) => {
        btn.addEventListener('click', () => {
          const f = JSON.parse(btn.getAttribute('data-json'));
          document.getElementById('admFlatModalTitle').textContent = 'Edit Flat';
          document.getElementById('editFlatMongoId').value = f._id;
          document.getElementById('formFlatNo').value = f.flatNumber;
          document.getElementById('formFlatWing').value = f.wing || '';
          document.getElementById('formFlatFloor').value = f.floor || '';
          document.getElementById('formFlatBuilding').value = f.building || '';
          if (flatModal) flatModal.show();
        });
      });

      tbody.querySelectorAll('.js-del-flat').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const no = btn.getAttribute('data-no');
          const ok = await Swal.fire({
            title: `Remove Flat ${no}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete'
          });
          if (!ok.isConfirmed) return;
          try {
            await RPLottery.apiFetch(`/flats/${id}`, { method: 'DELETE' });
            RPLottery.toast('success', `Flat ${no} deleted.`);
            await loadFlatsInventory();
          } catch (err) {
            Swal.fire({ icon: 'error', title: 'Cannot Delete Flat', text: err.message });
          }
        });
      });
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 4: FIXED FLAT MAPPING
     ======================================================================= */
  function bindFixedMappingsModule() {
    document.getElementById('createFixedMappingForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const participantRef = document.getElementById('mapParticipantSelect').value;
      const flatRef = document.getElementById('mapFlatSelect').value;
      const reason = document.getElementById('mapReasonInput').value.trim();

      try {
        const res = await RPLottery.apiFetch('/fixed-mappings', {
          method: 'POST',
          body: { participantRef, flatRef, reason }
        });
        RPLottery.toast('success', res.message);
        document.getElementById('mapReasonInput').value = '';
        await loadFixedMappingsModule();
      } catch (err) {
        if (err.code === 'OVERRIDE_CONFIRMATION_REQUIRED' && RPLottery.isSuperAdmin()) {
          const override = await promptSuperAdminOverride('Authorize Post-Start Fixed Mapping');
          if (!override) return;
          const res = await RPLottery.apiFetch('/fixed-mappings', {
            method: 'POST',
            body: { participantRef, flatRef, reason, overrideAuthorization: true, auditReason: override }
          });
          RPLottery.toast('success', res.message);
          await loadFixedMappingsModule();
        } else {
          Swal.fire({ icon: 'error', title: 'Mapping Conflict', text: err.message });
        }
      }
    });

    document.getElementById('mapSearchInput')?.addEventListener('input', () => {
      loadFixedMappingsModule();
    });
  }

  async function promptSuperAdminOverride(title) {
    const res = await Swal.fire({
      title,
      input: 'text',
      inputLabel: 'Enter official committee reason for permanent Audit Log (min 10 chars):',
      inputPlaceholder: 'Committee Resolution #...',
      showCancelButton: true,
      confirmButtonText: 'Authorize & Log'
    });
    if (!res.isConfirmed || !res.value || res.value.trim().length < 10) return null;
    return res.value.trim();
  }

  async function loadFixedMappingsModule() {
    try {
      const search = document.getElementById('mapSearchInput')?.value.trim() || '';
      const data = await RPLottery.apiFetch(
        `/fixed-mappings?search=${encodeURIComponent(search)}`
      );

      const pSel = document.getElementById('mapParticipantSelect');
      if (pSel) {
        pSel.innerHTML =
          '<option value="">Choose Eligible Participant...</option>' +
          data.availableParticipants
            .map(
              (p) =>
                `<option value="${p._id}">${RPLottery.escapeHtml(p.fullName)} (${RPLottery.escapeHtml(p.participantId)})</option>`
            )
            .join('');
      }

      const fSel = document.getElementById('mapFlatSelect');
      if (fSel) {
        fSel.innerHTML =
          '<option value="">Choose Available Flat...</option>' +
          data.availableFlats
            .map(
              (f) =>
                `<option value="${f._id}">Flat ${RPLottery.escapeHtml(f.flatNumber)}${f.wing ? ' • ' + RPLottery.escapeHtml(f.wing) : ''}</option>`
            )
            .join('');
      }

      const tbody = document.getElementById('fixedMappingsTableBody');
      if (!data.mappings.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No fixed flat mappings configured.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.mappings
        .map(
          (m) => `
          <tr>
            <td class="fw-bold"><code>${RPLottery.escapeHtml(m.allocationId || '—')}</code></td>
            <td class="fw-semibold">${RPLottery.escapeHtml(m.participantName)}</td>
            <td>${RPLottery.escapeHtml(m.participantId)}</td>
            <td><span class="pill-status pill-fixed">Flat ${RPLottery.escapeHtml(m.flatNumber)}</span></td>
            <td class="small text-secondary">${RPLottery.escapeHtml([m.wing, m.floor ? 'Flr ' + m.floor : ''].filter(Boolean).join(' • ') || '—')}</td>
            <td class="small">${RPLottery.escapeHtml(m.reason || '—')}</td>
            <td class="small text-secondary">${RPLottery.escapeHtml(m.createdByName || 'Admin')}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-map-ticket" data-alloc="${RPLottery.escapeHtml(m.allocationId)}">Ticket</button>
              <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 js-del-map" data-id="${m._id}" data-name="${RPLottery.escapeHtml(m.participantName)}">Remove</button>
            </td>
          </tr>
        `
        )
        .join('');

      tbody.querySelectorAll('.js-map-ticket').forEach((b) => {
        b.addEventListener('click', () => openTicketPreviewModal(b.getAttribute('data-alloc')));
      });

      tbody.querySelectorAll('.js-del-map').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = b.getAttribute('data-id');
          const name = b.getAttribute('data-name');
          const ok = await Swal.fire({
            title: `Remove Fixed Mapping for ${name}?`,
            text: 'Both participant and flat will return to the random pools.',
            icon: 'warning',
            showCancelButton: true
          });
          if (!ok.isConfirmed) return;

          try {
            await RPLottery.apiFetch(`/fixed-mappings/${id}`, { method: 'DELETE' });
            RPLottery.toast('success', 'Fixed mapping removed.');
            await loadFixedMappingsModule();
          } catch (err) {
            if (err.code === 'OVERRIDE_CONFIRMATION_REQUIRED' && RPLottery.isSuperAdmin()) {
              const reason = await promptSuperAdminOverride('Authorize Mapping Removal');
              if (!reason) return;
              await RPLottery.apiFetch(`/fixed-mappings/${id}`, {
                method: 'DELETE',
                body: { overrideAuthorization: true, auditReason: reason }
              });
              RPLottery.toast('success', 'Mapping removed with audit record.');
              await loadFixedMappingsModule();
            } else {
              Swal.fire({ icon: 'error', title: 'Locked', text: err.message });
            }
          }
        });
      });
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 5 & 6: LOTTERY CONFIGURATION & LIVE OPERATOR
     ======================================================================= */
  function bindLotteryConfigModule() {
    document.getElementById('lotteryTimingConfigForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await RPLottery.apiFetch('/config', {
          method: 'PUT',
          body: {
            countdownSeconds: parseInt(document.getElementById('cfgCountdownSec').value, 10),
            ticketPrefix: document.getElementById('cfgTicketPrefix').value.trim(),
            nameRevealDurationMs: parseInt(document.getElementById('cfgNameDuration').value, 10),
            flatRevealDurationMs: parseInt(document.getElementById('cfgFlatDuration').value, 10),
            soundEnabled: document.getElementById('cfgSoundSwitch').checked,
            confettiEnabled: document.getElementById('cfgConfettiSwitch').checked
          }
        });
        RPLottery.toast('success', res.message);
        RPLottery.broadcastEvent('EVENT_UPDATED');
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Config Error', text: err.message });
      }
    });

    document.getElementById('cfgStartLotteryBtn')?.addEventListener('click', async () => {
      try {
        const pre = await RPLottery.apiFetch('/precheck');
        if (!pre.canStart) {
          Swal.fire({ icon: 'error', title: 'Not Ready', text: pre.blockers.join(' ') });
          return;
        }
        const s = pre.summary;
        const ok = await Swal.fire({
          title: 'Confirm Pre-Lottery Allocation Summary',
          html: `
            <div class="text-start small">
              <div>Total Participants: <strong>${s.totalParticipants}</strong></div>
              <div>Total Flats: <strong>${s.totalFlats}</strong></div>
              <div>Preserved Fixed Mappings: <strong>${s.fixedAllocations}</strong></div>
              <hr/>
              <div>Remaining Random Participants: <strong>${s.remainingParticipants}</strong></div>
              <div>Remaining Random Flats: <strong>${s.remainingFlats}</strong></div>
              ${s.mismatchWarning ? `<div class="alert alert-warning mt-2 py-2 mb-0">${RPLottery.escapeHtml(s.mismatchWarning)}</div>` : ''}
            </div>
          `,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Confirm & Start Lottery'
        });
        if (!ok.isConfirmed) return;

        const out = await RPLottery.apiFetch('/start', {
          method: 'POST',
          body: { confirmed: true, acknowledgeMismatch: true }
        });
        RPLottery.toast('success', out.message);
        RPLottery.broadcastEvent('EVENT_UPDATED');
        await loadLotteryConfigModule();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Start Error', text: err.message });
      }
    });

    document.getElementById('cfgRunBatchBtn')?.addEventListener('click', async () => {
      const ok = await Swal.fire({
        title: 'Run Complete Random Allocation?',
        text: 'This will cryptographically allocate flats to all remaining eligible participants in MongoDB.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Confirm Complete Allocation'
      });
      if (!ok.isConfirmed) return;

      try {
        const key = RPLottery.generateIdempotencyKey('batch');
        const out = await RPLottery.apiFetch('/draw-batch', {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key },
          body: { confirmed: true, idempotencyKey: key }
        });
        Swal.fire({ icon: 'success', title: 'Batch Complete!', text: out.message });
        RPLottery.broadcastEvent('ALLOCATION_DRAWN');
        await loadLotteryConfigModule();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Batch Allocation Notice', text: err.message });
      }
    });

    document.getElementById('cfgPauseBtn')?.addEventListener('click', async () => {
      try {
        await RPLottery.apiFetch('/pause', { method: 'POST' });
        RPLottery.toast('info', 'Lottery paused.');
        RPLottery.broadcastEvent('EVENT_UPDATED');
        await loadLotteryConfigModule();
      } catch (err) {
        RPLottery.toast('error', err.message);
      }
    });

    document.getElementById('cfgResumeBtn')?.addEventListener('click', async () => {
      try {
        await RPLottery.apiFetch('/resume', { method: 'POST' });
        RPLottery.toast('success', 'Lottery resumed.');
        RPLottery.broadcastEvent('EVENT_UPDATED');
        await loadLotteryConfigModule();
      } catch (err) {
        RPLottery.toast('error', err.message);
      }
    });

    document.getElementById('cfgFinalizeBtn')?.addEventListener('click', async () => {
      const ok = await Swal.fire({
        title: 'Finalize & Lock Lottery Event?',
        text: 'Once finalized, allocations are permanently locked in MongoDB.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Finalize & Lock'
      });
      if (!ok.isConfirmed) return;

      try {
        const out = await RPLottery.apiFetch('/end', {
          method: 'POST',
          body: { confirmed: true, finalize: true }
        });
        RPLottery.toast('success', out.message);
        RPLottery.broadcastEvent('EVENT_UPDATED');
        await loadLotteryConfigModule();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
      }
    });

    document.getElementById('admQuickDrawOneBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const key = RPLottery.generateIdempotencyKey('adm-draw');
        const out = await RPLottery.apiFetch('/draw-one', {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key },
          body: { idempotencyKey: key }
        });
        RPLottery.toast('success', out.message);
        RPLottery.broadcastEvent('ALLOCATION_DRAWN', { allocation: out.allocation });
        await loadLiveOperatorTab();
      } catch (err) {
        Swal.fire({ icon: 'info', title: 'Draw Notice', text: err.message });
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function loadLotteryConfigModule() {
    try {
      const pre = await RPLottery.apiFetch('/precheck');
      const s = pre.summary;
      const ev = pre.event;
      portalState.event = ev;

      document.getElementById('admTopEventStatus').textContent = `STATUS: ${ev.status}`;
      document.getElementById('cfgCountdownSec').value = ev.config?.countdownSeconds || 3;
      document.getElementById('cfgTicketPrefix').value = ev.config?.ticketPrefix || 'RP';
      document.getElementById('cfgNameDuration').value = ev.config?.nameRevealDurationMs || 2800;
      document.getElementById('cfgFlatDuration').value = ev.config?.flatRevealDurationMs || 2400;
      document.getElementById('cfgSoundSwitch').checked = ev.config?.soundEnabled !== false;
      document.getElementById('cfgConfettiSwitch').checked = ev.config?.confettiEnabled !== false;

      document.getElementById('configPrecheckBox').innerHTML = `
        <div class="d-flex justify-content-between mb-1"><span>Event Status:</span><strong>${RPLottery.escapeHtml(ev.status)}</strong></div>
        <div class="d-flex justify-content-between mb-1"><span>Total Registered Participants:</span><strong>${s.totalParticipants}</strong></div>
        <div class="d-flex justify-content-between mb-1"><span>Total Flat Inventory:</span><strong>${s.totalFlats}</strong></div>
        <div class="d-flex justify-content-between mb-1"><span>Preserved Fixed Allocations:</span><strong class="text-warning-emphasis">${s.fixedAllocations}</strong></div>
        <div class="d-flex justify-content-between mb-1"><span>Eligible Random Participants:</span><strong class="text-success">${s.remainingParticipants}</strong></div>
        <div class="d-flex justify-content-between"><span>Available Random Flats:</span><strong class="text-success">${s.remainingFlats}</strong></div>
        ${s.mismatchWarning ? `<div class="alert alert-warning py-2 px-2 mt-2 mb-0 small">${RPLottery.escapeHtml(s.mismatchWarning)}</div>` : ''}
      `;
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  async function loadLiveOperatorTab() {
    try {
      const data = await RPLottery.apiFetch('/overview');
      const box = document.getElementById('admLiveLatestTicketBox');
      if (data.latestAllocation) {
        box.innerHTML = RPLottery.renderLuxuryTicketHtml(data.latestAllocation, data.event);
        RPLottery.bindTicketActionButtons(box, async () => data.latestAllocation, data.event);
      } else {
        box.innerHTML = `<div class="adm-card text-center text-muted py-4">No allocations drawn yet. Launch the Live Show Screen or click Draw Next Allocation above.</div>`;
      }
    } catch (_) {}
  }

  /* =======================================================================
     MODULE 7 & 8: ALLOCATION HISTORY & WINNERS LIST
     ======================================================================= */
  function bindHistoryAndWinnersModules() {
    document.getElementById('histSearchInput')?.addEventListener('input', loadAllocationHistory);
    document.getElementById('histTypeFilter')?.addEventListener('change', loadAllocationHistory);
    document.getElementById('winListSearchInput')?.addEventListener('input', loadWinnersDirectory);

    document.getElementById('winPrintAllTicketsBtn')?.addEventListener('click', handlePrintAllTickets);
  }

  async function handlePrintAllTickets() {
    try {
      const res = await RPLottery.apiFetch('/tickets/print-all');
      if (!res.tickets.length) {
        Swal.fire({ icon: 'info', title: 'No Tickets Yet', text: 'No allocations have been created yet.' });
        return;
      }
      RPLottery.printTickets(res.tickets, res.event);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Print Error', text: err.message });
    }
  }

  async function loadAllocationHistory() {
    try {
      const search = document.getElementById('histSearchInput')?.value.trim() || '';
      const type = document.getElementById('histTypeFilter')?.value || '';
      const data = await RPLottery.apiFetch(
        `/allocations?limit=250&search=${encodeURIComponent(search)}&allocationType=${encodeURIComponent(type)}`
      );

      const tbody = document.getElementById('historyTableBody');
      if (!data.allocations.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">No allocation history records found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.allocations
        .map(
          (a, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="fw-bold">${RPLottery.escapeHtml(a.allocationId)}</td>
            <td><span class="pill-status ${a.allocationType === 'FIXED' ? 'pill-fixed' : 'pill-random'}">${RPLottery.escapeHtml(a.allocationType)}</span></td>
            <td>
              <div class="fw-semibold">${RPLottery.escapeHtml(a.participantName)}</div>
              <small class="text-muted">${RPLottery.escapeHtml(a.participantId)}</small>
            </td>
            <td class="fw-bold">${RPLottery.escapeHtml(a.flatNumber)}</td>
            <td class="small text-secondary">${RPLottery.escapeHtml(RPLottery.formatDateTime(a.allocatedAt))}</td>
            <td class="small">${RPLottery.escapeHtml(a.initiatedByName || 'Admin')}</td>
            <td><code>${RPLottery.escapeHtml(String(a.verificationHash || '').slice(0, 10).toUpperCase())}</code></td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-hist-ticket" data-id="${RPLottery.escapeHtml(a.allocationId)}">Ticket</button>
            </td>
          </tr>
        `
        )
        .join('');

      tbody.querySelectorAll('.js-hist-ticket').forEach((b) => {
        b.addEventListener('click', () => openTicketPreviewModal(b.getAttribute('data-id')));
      });
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  async function loadWinnersDirectory() {
    try {
      const search = document.getElementById('winListSearchInput')?.value.trim() || '';
      const data = await RPLottery.apiFetch(
        `/allocations?limit=300&order=asc&search=${encodeURIComponent(search)}`
      );

      const tbody = document.getElementById('winnersListBody');
      if (!data.allocations.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No winners / allottees yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.allocations
        .map(
          (a) => `
          <tr>
            <td class="fw-bold fs-6">${RPLottery.escapeHtml(a.flatNumber)}</td>
            <td class="small text-secondary">${RPLottery.escapeHtml([a.wing, a.floor ? 'Floor ' + a.floor : ''].filter(Boolean).join(' • ') || '—')}</td>
            <td class="fw-semibold">${RPLottery.escapeHtml(a.participantName)}</td>
            <td>${RPLottery.escapeHtml(a.participantId)}</td>
            <td><code>${RPLottery.escapeHtml(a.allocationId)}</code></td>
            <td><span class="pill-status ${a.allocationType === 'FIXED' ? 'pill-fixed' : 'pill-random'}">${RPLottery.escapeHtml(a.allocationType)}</span></td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-adm-gold py-0 px-2 js-win-view" data-id="${RPLottery.escapeHtml(a.allocationId)}">View / Print</button>
              <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-win-pdf" data-id="${RPLottery.escapeHtml(a.allocationId)}">PDF</button>
            </td>
          </tr>
        `
        )
        .join('');

      tbody.querySelectorAll('.js-win-view').forEach((b) => {
        b.addEventListener('click', () => openTicketPreviewModal(b.getAttribute('data-id')));
      });
      tbody.querySelectorAll('.js-win-pdf').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.getAttribute('data-id');
          RPLottery.downloadFile(`/allocations/${encodeURIComponent(id)}/ticket.pdf`, `Ticket_${id}.pdf`);
        });
      });
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 9: REPORTS & EXPORTS (EXCEL, CSV, PDF, PRINT)
     ======================================================================= */
  function buildReportFilterQs(extra = {}) {
    const p = new URLSearchParams();
    const s = document.getElementById('repSearchInput')?.value.trim();
    const f = document.getElementById('repFlatInput')?.value.trim();
    const w = document.getElementById('repWingInput')?.value.trim();
    const fl = document.getElementById('repFloorInput')?.value.trim();
    const df = document.getElementById('repDateFrom')?.value;
    const dt = document.getElementById('repDateTo')?.value;

    if (s) p.set('search', s);
    if (f) p.set('flatNumber', f);
    if (w) p.set('wing', w);
    if (fl) p.set('floor', fl);
    if (df) p.set('dateFrom', df);
    if (dt) p.set('dateTo', dt);
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }

  function bindReportsModule() {
    document.getElementById('repLoadPreviewBtn')?.addEventListener('click', loadReportPreview);
    document.getElementById('repTypeSelect')?.addEventListener('change', loadReportPreview);

    ['xlsx', 'csv', 'pdf'].forEach((fmt) => {
      const btnId =
        fmt === 'xlsx'
          ? 'repExportXlsxBtn'
          : fmt === 'csv'
            ? 'repExportCsvBtn'
            : 'repExportPdfBtn';
      document.getElementById(btnId)?.addEventListener('click', async () => {
        const type = document.getElementById('repTypeSelect').value;
        const qs = buildReportFilterQs({ format: fmt });
        try {
          await RPLottery.downloadFile(
            `/reports/${encodeURIComponent(type)}/export?${qs}`,
            `RoyalPalms_${type}.${fmt}`
          );
        } catch (err) {
          Swal.fire({ icon: 'error', title: 'Export Error', text: err.message });
        }
      });
    });

    document.getElementById('repPrintTableBtn')?.addEventListener('click', async () => {
      if (!portalState.lastReportDataset) await loadReportPreview();
      if (portalState.lastReportDataset) {
        RPLottery.printTabularReport(portalState.lastReportDataset);
      }
    });

    document.getElementById('repPrintAllTicketsBtn')?.addEventListener('click', handlePrintAllTickets);
  }

  async function loadReportPreview() {
    try {
      const type = document.getElementById('repTypeSelect')?.value || 'complete-allocations';
      const qs = buildReportFilterQs();
      const data = await RPLottery.apiFetch(`/reports/${encodeURIComponent(type)}?${qs}`);
      portalState.lastReportDataset = data;

      document.getElementById('repPreviewTitle').textContent = data.title;
      document.getElementById('repPreviewCount').textContent = `${data.totalRows.toLocaleString()} record(s)`;

      const thead = document.getElementById('repPreviewThead');
      const tbody = document.getElementById('repPreviewTbody');
      thead.innerHTML = `<tr>${data.columns.map((c) => `<th>${RPLottery.escapeHtml(c)}</th>`).join('')}</tr>`;

      const slice = data.rows.slice(0, 300);
      tbody.innerHTML = slice.length
        ? slice
            .map(
              (r) =>
                `<tr>${Object.values(r)
                  .map((v) => `<td>${RPLottery.escapeHtml(v)}</td>`)
                  .join('')}</tr>`
            )
            .join('')
        : `<tr><td colspan="${data.columns.length}" class="text-center py-4 text-muted">No records match the current filters.</td></tr>`;
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  /* =======================================================================
     MODULE 10 & 11: SETTINGS, BACKUP, AUDIT LOGS & ADMIN USERS
     ======================================================================= */
  function bindSettingsAndAdminsModule() {
    document.getElementById('societyEventSettingsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await RPLottery.apiFetch('/config', {
          method: 'PUT',
          body: {
            societyName: document.getElementById('setSocName').value.trim(),
            eventName: document.getElementById('setEvName').value.trim(),
            societyAddress: document.getElementById('setSocAddr').value.trim(),
            registrationNo: document.getElementById('setRegNo').value.trim(),
            committeeName: document.getElementById('setCommName').value.trim(),
            contactPhone: document.getElementById('setPhone').value.trim()
          }
        });
        RPLottery.toast('success', res.message);
        RPLottery.broadcastEvent('EVENT_UPDATED');
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Save Error', text: err.message });
      }
    });

    document.getElementById('exportMongoBackupBtn')?.addEventListener('click', async () => {
      try {
        await RPLottery.downloadFile('/backup/export', 'RoyalPalms_MongoDB_Backup.json');
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Backup Requires SUPER_ADMIN', text: err.message });
      }
    });

    document.getElementById('exportFullAuditXlsxBtn')?.addEventListener('click', async () => {
      try {
        await RPLottery.downloadFile(
          '/reports/audit-report/export?format=xlsx',
          'RoyalPalms_Complete_Audit_Report.xlsx'
        );
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Audit Export Error', text: err.message });
      }
    });

    document.getElementById('createAdminUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await RPLottery.apiFetch('/admins', {
          method: 'POST',
          body: {
            fullName: document.getElementById('newAdmFullName').value.trim(),
            username: document.getElementById('newAdmUsername').value.trim(),
            role: document.getElementById('newAdmRole').value,
            email: document.getElementById('newAdmEmail').value.trim()
          }
        });
        RPLottery.toast('success', res.message);
        e.target.reset();
        await loadAdminUsersModule();
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Cannot Add Committee Member', text: err.message });
      }
    });
  }

  async function loadSettingsAndAuditLogs() {
    try {
      const [ov, auditRes] = await Promise.all([
        RPLottery.apiFetch('/overview'),
        RPLottery.apiFetch('/audit-logs?limit=80')
      ]);

      const ev = ov.event || {};
      document.getElementById('setSocName').value = ev.societyName || '';
      document.getElementById('setEvName').value = ev.eventName || '';
      document.getElementById('setSocAddr').value = ev.societyAddress || '';
      document.getElementById('setRegNo').value = ev.registrationNo || '';
      document.getElementById('setCommName').value = ev.committeeName || '';
      document.getElementById('setPhone').value = ev.contactPhone || '';

      const tbody = document.getElementById('settingsAuditLogsBody');
      tbody.innerHTML = (auditRes.logs || [])
        .map(
          (l) => `
          <tr>
            <td class="small text-secondary text-nowrap">${RPLottery.escapeHtml(RPLottery.formatDateTime(l.createdAt))}</td>
            <td><code>${RPLottery.escapeHtml(l.action)}</code></td>
            <td class="fw-semibold">${RPLottery.escapeHtml(l.actorUsername)}</td>
            <td><span class="badge bg-light text-dark border">${RPLottery.escapeHtml(l.actorRole)}</span></td>
            <td class="small">${RPLottery.escapeHtml(l.summary)}</td>
          </tr>
        `
        )
        .join('');
    } catch (err) {
      RPLottery.toast('error', err.message);
    }
  }

  async function loadAdminUsersModule() {
    const tbody = document.getElementById('adminUsersTableBody');
    try {
      const data = await RPLottery.apiFetch('/admins');
      tbody.innerHTML = data.admins
        .map(
          (u) => `
          <tr>
            <td class="fw-bold">${RPLottery.escapeHtml(u.username)}</td>
            <td>${RPLottery.escapeHtml(u.fullName)}</td>
            <td><span class="pill-status ${u.role === 'SUPER_ADMIN' ? 'pill-fixed' : 'pill-allocated'}">${RPLottery.escapeHtml(u.role)}</span></td>
            <td>${u.isActive ? '<span class="text-success fw-bold small">Active</span>' : '<span class="text-danger fw-bold small">Disabled</span>'}</td>
            <td class="small text-secondary">${RPLottery.escapeHtml(RPLottery.formatDateTime(u.lastLoginAt))}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-adm-outline py-0 px-2 js-toggle-admin" data-id="${u.id}" data-active="${u.isActive}" ${!RPLottery.isSuperAdmin() ? 'disabled' : ''}>
                ${u.isActive ? 'Disable' : 'Enable'}
              </button>
            </td>
          </tr>
        `
        )
        .join('');

      tbody.querySelectorAll('.js-toggle-admin').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = b.getAttribute('data-id');
          const cur = b.getAttribute('data-active') === 'true';
          try {
            await RPLottery.apiFetch(`/admins/${id}`, {
              method: 'PATCH',
              body: { isActive: !cur }
            });
            RPLottery.toast('success', 'Admin status updated.');
            await loadAdminUsersModule();
          } catch (err) {
            Swal.fire({ icon: 'error', title: 'Update Blocked', text: err.message });
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">${RPLottery.escapeHtml(err.message)}</td></tr>`;
    }
  }

  document.addEventListener('DOMContentLoaded', initAdminPortal);
})();
