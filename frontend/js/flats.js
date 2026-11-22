/* =========================================================================
   SOCIETY PLAY & WIN - SOCIETY & FLAT MANAGEMENT (flats.js)
   Open Direct Access — Add Society, Add/Edit/Delete Flats & Duplicate Check
   ========================================================================= */

(function () {
  const state = {
    page: 1,
    limit: 25,
    ownerName: '',
    flatNumber: '',
    status: 'all',
    societyId: '',
    flats: [],
    societies: [],
    defaultSociety: null
  };

  let flatModalInstance = null;
  let addSocietyModalInstance = null;
  let searchDebounce = null;

  async function initFlatsPage() {
    const flatModalEl = document.getElementById('flatFormModal');
    if (flatModalEl && typeof bootstrap !== 'undefined') {
      flatModalInstance = new bootstrap.Modal(flatModalEl);
    }

    const socModalEl = document.getElementById('addSocietyModal');
    if (socModalEl && typeof bootstrap !== 'undefined') {
      addSocietyModalInstance = new bootstrap.Modal(socModalEl);
    }

    await loadSocietiesDropdown();
    bindFilterEvents();
    bindFormEvents();
    await fetchFlats();
  }

  async function loadSocietiesDropdown() {
    try {
      const data = await SPW.apiFetch('/society');
      state.defaultSociety = data.society;
      state.societies = data.societies || [];

      const filterSel = document.getElementById('filterSocietySelect');
      if (filterSel) {
        const prev = state.societyId;
        filterSel.innerHTML =
          '<option value="">All Societies</option>' +
          state.societies
            .map(
              (s) =>
                `<option value="${s.SocietyID}" ${String(s.SocietyID) === String(prev) ? 'selected' : ''}>${SPW.escapeHtml(s.SocietyName)}</option>`
            )
            .join('');
      }

      const datalist = document.getElementById('societyNamesDatalist');
      if (datalist) {
        datalist.innerHTML = state.societies
          .map((s) => `<option value="${SPW.escapeHtml(s.SocietyName)}"></option>`)
          .join('');
      }

      const formSocInput = document.getElementById('flatSocietyNameInput');
      if (formSocInput && state.defaultSociety && !formSocInput.value) {
        formSocInput.value = state.defaultSociety.SocietyName;
      }
    } catch (_) {}
  }

  function bindFilterEvents() {
    const ownerInp = document.getElementById('searchOwnerInput');
    const flatInp = document.getElementById('searchFlatNoInput');
    const statusSel = document.getElementById('filterStatusSelect');
    const socSel = document.getElementById('filterSocietySelect');
    const limitSel = document.getElementById('pageSizeSelect');
    const resetBtn = document.getElementById('resetFlatFiltersBtn');
    const printBtn = document.getElementById('printFlatListBtn');

    const triggerDebouncedSearch = () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.ownerName = ownerInp ? ownerInp.value.trim() : '';
        state.flatNumber = flatInp ? flatInp.value.trim() : '';
        state.page = 1;
        fetchFlats();
      }, 260);
    };

    if (ownerInp) ownerInp.addEventListener('input', triggerDebouncedSearch);
    if (flatInp) flatInp.addEventListener('input', triggerDebouncedSearch);

    if (statusSel) {
      statusSel.addEventListener('change', () => {
        state.status = statusSel.value;
        state.page = 1;
        fetchFlats();
      });
    }

    if (socSel) {
      socSel.addEventListener('change', () => {
        state.societyId = socSel.value;
        state.page = 1;
        fetchFlats();
      });
    }

    if (limitSel) {
      limitSel.addEventListener('change', () => {
        state.limit = parseInt(limitSel.value, 10) || 25;
        state.page = 1;
        fetchFlats();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (ownerInp) ownerInp.value = '';
        if (flatInp) flatInp.value = '';
        if (statusSel) statusSel.value = 'all';
        if (socSel) socSel.value = '';
        state.ownerName = '';
        state.flatNumber = '';
        state.status = 'all';
        state.societyId = '';
        state.page = 1;
        fetchFlats();
      });
    }

    if (printBtn) {
      printBtn.addEventListener('click', handlePrintFlatOwnerList);
    }
  }

  function bindFormEvents() {
    const openAddBtn = document.getElementById('openAddFlatBtn');
    const flatForm = document.getElementById('flatRecordForm');
    const openAddSocBtn = document.getElementById('openAddSocietyBtn');
    const addSocForm = document.getElementById('addSocietyForm');

    if (openAddSocBtn) {
      openAddSocBtn.addEventListener('click', () => {
        SPW.sound.play('click');
        if (addSocForm) addSocForm.reset();
        if (addSocietyModalInstance) addSocietyModalInstance.show();
      });
    }

    if (addSocForm) {
      addSocForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveSocBtn = document.getElementById('saveNewSocietyBtn');
        saveSocBtn.disabled = true;

        const payload = {
          societyName: document.getElementById('newSocietyNameInput').value.trim(),
          societyAddress: document.getElementById('newSocietyAddressInput').value.trim(),
          totalFlats: parseInt(document.getElementById('newSocietyTotalFlatsInput').value, 10) || 500
        };

        try {
          const res = await SPW.apiFetch('/society', {
            method: 'POST',
            body: payload
          });
          SPW.toast('success', res.message || 'Society added!');
          if (addSocietyModalInstance) addSocietyModalInstance.hide();
          await loadSocietiesDropdown();
          if (res.society?.SocietyID) {
            state.societyId = String(res.society.SocietyID);
            const filterSel = document.getElementById('filterSocietySelect');
            if (filterSel) filterSel.value = state.societyId;
          }
          await fetchFlats();
        } catch (err) {
          SPW.alertModal({
            icon: 'error',
            title: 'Cannot Add Society',
            text: err.message
          });
        } finally {
          saveSocBtn.disabled = false;
        }
      });
    }

    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => {
        SPW.sound.play('click');
        document.getElementById('flatModalTitle').innerHTML =
          '<i class="fa-solid fa-building-user text-neon-blue me-2"></i>Add New Flat';
        document.getElementById('editFlatId').value = '';

        const selectedSoc = state.societies.find(
          (s) => String(s.SocietyID) === String(state.societyId)
        );
        document.getElementById('flatSocietyNameInput').value =
          selectedSoc?.SocietyName ||
          state.defaultSociety?.SocietyName ||
          'Royal Palms Co-operative Housing Society';

        document.getElementById('flatNumberInput').value = '';
        document.getElementById('ownerNameInput').value = '';
        document.getElementById('mobileNumberInput').value = '';
        document.getElementById('participationInput').checked = true;
        if (flatModalInstance) flatModalInstance.show();
      });
    }

    if (flatForm) {
      flatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editFlatId').value;
        const payload = {
          societyName: document.getElementById('flatSocietyNameInput').value.trim(),
          flatNumber: document.getElementById('flatNumberInput').value.trim(),
          ownerName: document.getElementById('ownerNameInput').value.trim(),
          mobileNumber: document.getElementById('mobileNumberInput').value.trim(),
          participationStatus: document.getElementById('participationInput').checked
        };

        const saveBtn = document.getElementById('saveFlatBtn');
        saveBtn.disabled = true;

        try {
          if (editId) {
            const res = await SPW.apiFetch(`/flats/${editId}`, {
              method: 'PUT',
              body: payload
            });
            SPW.toast('success', res.message || 'Flat updated!');
          } else {
            const res = await SPW.apiFetch('/flats', {
              method: 'POST',
              body: payload
            });
            SPW.toast('success', res.message || 'Flat added!');
          }

          if (flatModalInstance) flatModalInstance.hide();
          await loadSocietiesDropdown();
          await fetchFlats();
        } catch (err) {
          SPW.alertModal({
            icon: 'error',
            title: err.code === 'DUPLICATE_FLAT' ? 'Duplicate Flat Number' : 'Validation Error',
            text: err.message
          });
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  async function fetchFlats() {
    const tbody = document.getElementById('flatsTableBody');
    if (!tbody) return;

    const params = new URLSearchParams({
      page: String(state.page),
      limit: String(state.limit),
      ownerName: state.ownerName,
      flatNumber: state.flatNumber,
      status: state.status
    });
    if (state.societyId) params.set('societyId', state.societyId);

    try {
      const data = await SPW.apiFetch(`/flats?${params.toString()}`);
      state.flats = data.flats || [];

      renderSummaryBadges(data.summary, data.pagination);
      renderFlatsTable(state.flats, data.pagination);
      renderPagination(data.pagination);
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-4 text-muted-light">
            <i class="fa-solid fa-database text-gold me-2"></i>${SPW.escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }

  function renderSummaryBadges(summary, pagination) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('summaryTotalFlats', (summary?.totalAll || 0).toLocaleString());
    setTxt('summaryTotalOwners', (summary?.totalOwners || 0).toLocaleString());
    setTxt('summaryParticipatingFlats', (summary?.participatingAll || 0).toLocaleString());
    setTxt('summaryFilteredCount', (pagination?.totalRecords || 0).toLocaleString());
  }

  function renderFlatsTable(flats, pagination) {
    const tbody = document.getElementById('flatsTableBody');
    if (!flats.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-5 text-muted-light">
            <i class="fa-solid fa-building-circle-exclamation fs-2 text-neon-blue mb-2 d-block opacity-75"></i>
            No flats match your search/filter. Click <strong>Add Flat</strong> or <strong>Import Excel / CSV</strong> to add society flats!
          </td>
        </tr>
      `;
      return;
    }

    const startIdx = (pagination.page - 1) * pagination.limit;

    tbody.innerHTML = flats
      .map((f, idx) => {
        const isPart = Boolean(f.ParticipationStatus);
        const hasWon = Boolean(f.HasWon);

        return `
          <tr>
            <td class="text-muted-light">${startIdx + idx + 1}</td>
            <td>
              <span class="fw-bold text-neon-blue">${SPW.escapeHtml(f.FlatNumber)}</span>
              ${hasWon ? '<span class="badge-winner-crown ms-2" title="Official Lucky Draw Winner"><i class="fa-solid fa-trophy"></i> Winner</span>' : ''}
            </td>
            <td class="fw-semibold">${SPW.escapeHtml(f.OwnerName)}</td>
            <td class="text-muted-light">${SPW.escapeHtml(f.SocietyName)}</td>
            <td class="text-muted-light">${SPW.escapeHtml(f.MobileNumber || '—')}</td>
            <td>
              <div class="form-check form-switch arcade-switch d-inline-flex align-items-center gap-2 mb-0">
                <input
                  class="form-check-input js-toggle-part"
                  type="checkbox"
                  data-flat-id="${f.FlatID}"
                  ${isPart ? 'checked' : ''}
                />
                <span class="${isPart ? 'badge-participating' : 'badge-excluded'}">
                  ${isPart ? 'Participating' : 'Excluded'}
                </span>
              </div>
            </td>
            <td class="text-muted-light small">${SPW.escapeHtml(SPW.formatDate(f.CreatedAt))}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-glass js-edit-flat" data-flat-id="${f.FlatID}" title="Edit Flat">
                  <i class="fa-solid fa-pen-to-square text-neon-blue"></i>
                </button>
                <button class="btn btn-glass js-delete-flat" data-flat-id="${f.FlatID}" title="Delete Flat">
                  <i class="fa-solid fa-trash-can text-danger"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.js-toggle-part').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const flatId = parseInt(chk.getAttribute('data-flat-id'), 10);
        try {
          const res = await SPW.apiFetch(`/flats/${flatId}/status`, {
            method: 'PATCH',
            body: { participationStatus: chk.checked }
          });
          SPW.toast('success', res.message);
          await fetchFlats();
        } catch (err) {
          chk.checked = !chk.checked;
          SPW.alertModal({ icon: 'error', title: 'Update Failed', text: err.message });
        }
      });
    });

    tbody.querySelectorAll('.js-edit-flat').forEach((btn) => {
      btn.addEventListener('click', () => {
        const flatId = parseInt(btn.getAttribute('data-flat-id'), 10);
        const flat = state.flats.find((x) => x.FlatID === flatId);
        if (!flat) return;

        document.getElementById('flatModalTitle').innerHTML =
          '<i class="fa-solid fa-pen-to-square text-gold me-2"></i>Edit Flat Details';
        document.getElementById('editFlatId').value = flat.FlatID;
        document.getElementById('flatSocietyNameInput').value = flat.SocietyName;
        document.getElementById('flatNumberInput').value = flat.FlatNumber;
        document.getElementById('ownerNameInput').value = flat.OwnerName;
        document.getElementById('mobileNumberInput').value = flat.MobileNumber || '';
        document.getElementById('participationInput').checked = Boolean(flat.ParticipationStatus);
        if (flatModalInstance) flatModalInstance.show();
      });
    });

    tbody.querySelectorAll('.js-delete-flat').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const flatId = parseInt(btn.getAttribute('data-flat-id'), 10);
        const flat = state.flats.find((x) => x.FlatID === flatId);
        if (!flat) return;

        const ok = await SPW.confirmModal({
          title: `Delete Flat ${flat.FlatNumber}?`,
          text: `Are you sure you want to remove ${flat.OwnerName} (${flat.FlatNumber})?`,
          icon: 'warning',
          confirmButtonText: 'Yes, Delete'
        });
        if (!ok) return;

        try {
          const res = await SPW.apiFetch(`/flats/${flatId}`, { method: 'DELETE' });
          SPW.toast('success', res.message);
          await fetchFlats();
        } catch (err) {
          SPW.alertModal({ icon: 'error', title: 'Cannot Delete Flat', text: err.message });
        }
      });
    });
  }

  function renderPagination(pagination) {
    const ul = document.getElementById('flatsPagination');
    const info = document.getElementById('flatsPageInfo');
    if (!ul) return;

    const { page, totalPages, totalRecords, limit } = pagination;
    const from = totalRecords === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(totalRecords, page * limit);
    if (info) {
      info.textContent = `Showing ${from}–${to} of ${totalRecords.toLocaleString()} flats`;
    }

    if (totalPages <= 1) {
      ul.innerHTML = '';
      return;
    }

    const pages = [];
    pages.push({ label: '&laquo;', target: Math.max(1, page - 1), disabled: page === 1 });

    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);

    if (start > 1) {
      pages.push({ label: '1', target: 1, active: page === 1 });
      if (start > 2) pages.push({ label: '...', disabled: true });
    }

    for (let p = start; p <= end; p++) {
      pages.push({ label: String(p), target: p, active: p === page });
    }

    if (end < totalPages) {
      if (end < totalPages - 1) pages.push({ label: '...', disabled: true });
      pages.push({ label: String(totalPages), target: totalPages, active: page === totalPages });
    }

    pages.push({
      label: '&raquo;',
      target: Math.min(totalPages, page + 1),
      disabled: page === totalPages
    });

    ul.innerHTML = pages
      .map(
        (item) => `
        <li class="page-item ${item.active ? 'active' : ''} ${item.disabled ? 'disabled' : ''}">
          <a class="page-link" href="#" data-page="${item.target || ''}">${item.label}</a>
        </li>
      `
      )
      .join('');

    ul.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = parseInt(link.getAttribute('data-page'), 10);
        if (!target || target === state.page) return;
        state.page = target;
        fetchFlats();
      });
    });
  }

  async function handlePrintFlatOwnerList() {
    try {
      const params = new URLSearchParams({
        all: 'true',
        ownerName: state.ownerName,
        flatNumber: state.flatNumber,
        status: state.status
      });
      if (state.societyId) params.set('societyId', state.societyId);

      const data = await SPW.apiFetch(`/flats?${params.toString()}`);
      const allFlats = data.flats || [];

      const rows = allFlats.map((f, idx) => [
        String(idx + 1),
        f.FlatNumber,
        f.OwnerName,
        f.SocietyName,
        f.MobileNumber || '-',
        f.ParticipationStatus ? 'Participating' : 'Excluded',
        SPW.formatDate(f.CreatedAt)
      ]);

      SPW.printTabularReport({
        title: 'OFFICIAL FLAT OWNER & PARTICIPANT DIRECTORY',
        subtitle: state.status !== 'all' ? `Filter: ${state.status.toUpperCase()}` : 'Complete Registered Flats List',
        columns: [
          'Sr No',
          'Flat No',
          'Owner Name',
          'Society Name',
          'Mobile Number',
          'Status',
          'Registered On'
        ],
        rows,
        summaryText: `Total Flats Printed: ${rows.length}`
      });
    } catch (err) {
      SPW.alertModal({
        icon: 'error',
        title: 'Print Failed',
        text: err.message
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('flatsTableBody')) {
      initFlatsPage();
    }
  });

  window.SPWFlats = {
    refreshFlats: fetchFlats,
    reloadSocieties: loadSocietiesDropdown,
    getDefaultSocietyName: () =>
      state.defaultSociety?.SocietyName || 'Royal Palms Co-operative Housing Society'
  };
})();
