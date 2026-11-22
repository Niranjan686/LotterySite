/* =========================================================================
   SOCIETY PLAY & WIN - WINNER HISTORY, EXPORT & PRINTING (winners.js)
   Open Direct Access — Search, Filter, Excel/CSV Export & Certificates
   ========================================================================= */

(function () {
  const state = {
    page: 1,
    limit: 20,
    search: '',
    societyId: '',
    symbol: '',
    dateFrom: '',
    dateTo: '',
    winners: [],
    selectedWinner: null
  };

  let detailModalInstance = null;
  let searchTimer = null;

  async function initWinnersPage() {
    const modalEl = document.getElementById('winnerHistoryDetailModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
      detailModalInstance = new bootstrap.Modal(modalEl);
    }

    await populateSocietiesFilter();
    bindFilterEvents();
    await fetchWinners();
  }

  async function populateSocietiesFilter() {
    try {
      const data = await SPW.apiFetch('/society');
      const sel = document.getElementById('winFilterSociety');
      if (sel && Array.isArray(data.societies)) {
        sel.innerHTML =
          '<option value="">All Societies</option>' +
          data.societies
            .map(
              (s) => `<option value="${s.SocietyID}">${SPW.escapeHtml(s.SocietyName)}</option>`
            )
            .join('');
      }
    } catch (_) {}
  }

  function buildFilterQueryString(extra = {}) {
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.societyId) params.set('societyId', state.societyId);
    if (state.symbol) params.set('symbol', state.symbol);
    if (state.dateFrom) params.set('dateFrom', state.dateFrom);
    if (state.dateTo) params.set('dateTo', state.dateTo);
    Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
    return params.toString();
  }

  function bindFilterEvents() {
    const searchInp = document.getElementById('winSearchInput');
    const socSel = document.getElementById('winFilterSociety');
    const symSel = document.getElementById('winFilterSymbol');
    const fromInp = document.getElementById('winFilterDateFrom');
    const toInp = document.getElementById('winFilterDateTo');
    const resetBtn = document.getElementById('winResetFiltersBtn');
    const expXlsxBtn = document.getElementById('exportWinnersExcelBtn');
    const expCsvBtn = document.getElementById('exportWinnersCsvBtn');
    const printReportBtn = document.getElementById('printWinnersReportBtn');
    const modalPrintCertBtn = document.getElementById('winDetailPrintCertBtn');

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.search = searchInp.value.trim();
          state.page = 1;
          fetchWinners();
        }, 260);
      });
    }

    const onFilterChange = () => {
      state.societyId = socSel ? socSel.value : '';
      state.symbol = symSel ? symSel.value : '';
      state.dateFrom = fromInp ? fromInp.value : '';
      state.dateTo = toInp ? toInp.value : '';
      state.page = 1;
      fetchWinners();
    };

    if (socSel) socSel.addEventListener('change', onFilterChange);
    if (symSel) symSel.addEventListener('change', onFilterChange);
    if (fromInp) fromInp.addEventListener('change', onFilterChange);
    if (toInp) toInp.addEventListener('change', onFilterChange);

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (searchInp) searchInp.value = '';
        if (socSel) socSel.value = '';
        if (symSel) symSel.value = '';
        if (fromInp) fromInp.value = '';
        if (toInp) toInp.value = '';
        state.search = '';
        state.societyId = '';
        state.symbol = '';
        state.dateFrom = '';
        state.dateTo = '';
        state.page = 1;
        fetchWinners();
      });
    }

    if (expXlsxBtn) {
      expXlsxBtn.addEventListener('click', async () => {
        try {
          const qs = buildFilterQueryString({ format: 'xlsx' });
          await SPW.downloadFile(`/winners/export?${qs}`, 'Society_Winners.xlsx');
        } catch (err) {
          SPW.alertModal({ icon: 'error', title: 'Export Failed', text: err.message });
        }
      });
    }

    if (expCsvBtn) {
      expCsvBtn.addEventListener('click', async () => {
        try {
          const qs = buildFilterQueryString({ format: 'csv' });
          await SPW.downloadFile(`/winners/export?${qs}`, 'Society_Winners.csv');
        } catch (err) {
          SPW.alertModal({ icon: 'error', title: 'Export Failed', text: err.message });
        }
      });
    }

    if (printReportBtn) {
      printReportBtn.addEventListener('click', handlePrintCompleteWinnerReport);
    }

    if (modalPrintCertBtn) {
      modalPrintCertBtn.addEventListener('click', () => {
        if (state.selectedWinner) {
          SPW.printWinnerCertificate(state.selectedWinner);
        }
      });
    }
  }

  async function fetchWinners() {
    const tbody = document.getElementById('winnersTableBody');
    if (!tbody) return;

    try {
      const qs = buildFilterQueryString({ page: state.page, limit: state.limit });
      const data = await SPW.apiFetch(`/winners?${qs}`);
      state.winners = data.winners || [];

      renderWinnerSummary(data.summary, data.pagination);
      renderWinnersTable(state.winners, data.pagination);
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

  function renderWinnerSummary(summary, pagination) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('winStatTotal', (summary?.totalWinners || 0).toLocaleString());
    setTxt('winStatUniqueFlats', (summary?.uniqueWinningFlats || 0).toLocaleString());
    setTxt('winStatFiltered', (pagination?.totalRecords || 0).toLocaleString());
    setTxt(
      'winStatLatest',
      summary?.latestDrawAt ? SPW.formatDate(summary.latestDrawAt) : 'No Draws Yet'
    );
  }

  function renderWinnersTable(winners, pagination) {
    const tbody = document.getElementById('winnersTableBody');
    if (!winners.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-5 text-muted-light">
            <i class="fa-solid fa-crown fs-2 text-gold mb-2 d-block opacity-75"></i>
            No winner records found yet. Spin &amp; match 3 symbols in <strong>Play Game</strong> to crown official society winners!
          </td>
        </tr>
      `;
      return;
    }

    const startIdx = (pagination.page - 1) * pagination.limit;

    tbody.innerHTML = winners
      .map((w, idx) => {
        const sym = SPW.getSymbolMeta(w.MatchedSymbol);
        const gameCode = w.SessionCode || `SPW-${String(w.GameID).padStart(6, '0')}`;

        return `
          <tr>
            <td class="text-muted-light">${startIdx + idx + 1}</td>
            <td class="fw-bold text-gold">${SPW.escapeHtml(w.OwnerName)}</td>
            <td><span class="fw-bold text-neon-blue">${SPW.escapeHtml(w.FlatNumber)}</span></td>
            <td>${SPW.escapeHtml(w.SocietyName)}</td>
            <td>
              <span class="badge-winner-crown">${SPW.escapeHtml(gameCode)}</span>
            </td>
            <td>
              <span class="me-1">${sym.emoji}</span>${SPW.escapeHtml(SPW.formatDate(w.DrawDateTime))}
            </td>
            <td class="text-muted-light">${SPW.escapeHtml(SPW.formatTime(w.DrawDateTime))}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-glass js-view-winner" data-id="${w.WinnerID}" title="View Winner Details">
                  <i class="fa-solid fa-eye text-neon-blue"></i>
                </button>
                <button class="btn btn-glass js-print-cert" data-id="${w.WinnerID}" title="Print Individual Certificate">
                  <i class="fa-solid fa-certificate text-gold"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.js-view-winner').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        openWinnerDetail(id);
      });
    });

    tbody.querySelectorAll('.js-print-cert').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        try {
          const res = await SPW.apiFetch(`/winners/${id}`);
          SPW.printWinnerCertificate(res.winner);
        } catch (_) {
          const local = state.winners.find((x) => x.WinnerID === id);
          if (local) SPW.printWinnerCertificate(local);
        }
      });
    });
  }

  async function openWinnerDetail(winnerId) {
    try {
      const res = await SPW.apiFetch(`/winners/${winnerId}`);
      const w = res.winner;
      state.selectedWinner = w;

      const sym = SPW.getSymbolMeta(w.MatchedSymbol);
      const gameCode = w.SessionCode || `SPW-${String(w.GameID).padStart(6, '0')}`;
      const body = document.getElementById('winnerHistoryDetailBody');
      if (!body) return;

      body.innerHTML = `
        <div class="text-center mb-3">
          <div class="display-5 mb-1">${sym.emoji} ${sym.emoji} ${sym.emoji}</div>
          <h4 class="font-display text-gold-gradient mb-0">${SPW.escapeHtml(w.OwnerName)}</h4>
          <div class="small text-muted-light">${SPW.escapeHtml(w.PrizeTitle || 'Official Society Play & Win Winner')}</div>
        </div>
        <div class="winner-spotlight-card my-0">
          <div class="winner-field-row">
            <span class="text-muted-light">Flat Number</span>
            <span class="fw-bold text-neon-blue">${SPW.escapeHtml(w.FlatNumber)}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Society Name</span>
            <span class="fw-semibold">${SPW.escapeHtml(w.SocietyName)}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Mobile Number</span>
            <span>${SPW.escapeHtml(w.MobileNumber || 'Not Provided')}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Game ID</span>
            <span class="badge-winner-crown">${SPW.escapeHtml(gameCode)}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Certificate No</span>
            <span class="fw-semibold">${SPW.escapeHtml(w.CertificateNo)}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Draw Date</span>
            <span>${SPW.escapeHtml(SPW.formatDate(w.DrawDateTime))}</span>
          </div>
          <div class="winner-field-row">
            <span class="text-muted-light">Draw Time</span>
            <span>${SPW.escapeHtml(SPW.formatTime(w.DrawDateTime))}</span>
          </div>
        </div>
      `;

      if (detailModalInstance) detailModalInstance.show();
    } catch (err) {
      SPW.alertModal({ icon: 'error', title: 'Error', text: err.message });
    }
  }

  function renderPagination(pagination) {
    const ul = document.getElementById('winnersPagination');
    const info = document.getElementById('winnersPageInfo');
    if (!ul) return;

    const { page, totalPages, totalRecords, limit } = pagination;
    const from = totalRecords === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(totalRecords, page * limit);

    if (info) {
      info.textContent = `Showing ${from}–${to} of ${totalRecords.toLocaleString()} winners`;
    }

    if (totalPages <= 1) {
      ul.innerHTML = '';
      return;
    }

    let html = '';
    for (let p = 1; p <= totalPages; p++) {
      html += `
        <li class="page-item ${p === page ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${p}">${p}</a>
        </li>
      `;
    }
    ul.innerHTML = html;

    ul.querySelectorAll('.page-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = parseInt(a.getAttribute('data-page'), 10);
        if (target && target !== state.page) {
          state.page = target;
          fetchWinners();
        }
      });
    });
  }

  async function handlePrintCompleteWinnerReport() {
    try {
      const qs = buildFilterQueryString({ all: 'true' });
      const data = await SPW.apiFetch(`/winners?${qs}`);
      const allWinners = data.winners || [];

      const rows = allWinners.map((w, idx) => {
        const sym = SPW.getSymbolMeta(w.MatchedSymbol);
        const gameCode = w.SessionCode || `SPW-${String(w.GameID).padStart(6, '0')}`;
        return [
          String(idx + 1),
          w.CertificateNo || '-',
          gameCode,
          w.OwnerName,
          w.FlatNumber,
          w.SocietyName,
          `${sym.emoji} ${sym.label}`,
          SPW.formatDate(w.DrawDateTime),
          SPW.formatTime(w.DrawDateTime)
        ];
      });

      SPW.printTabularReport({
        title: 'COMPLETE OFFICIAL WINNER HISTORY REPORT',
        subtitle: 'Verified Lucky Draw Results from Microsoft SQL Server',
        columns: [
          'Sr No',
          'Certificate No',
          'Game ID',
          'Winner Name',
          'Flat No',
          'Society Name',
          'Winning Symbol',
          'Draw Date',
          'Draw Time'
        ],
        rows,
        summaryText: `Total Official Winners: ${rows.length}`
      });
    } catch (err) {
      SPW.alertModal({ icon: 'error', title: 'Print Report Failed', text: err.message });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('winnersTableBody')) {
      initWinnersPage();
    }
  });
})();
