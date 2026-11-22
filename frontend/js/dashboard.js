/* =========================================================================
   SOCIETY PLAY & WIN - DASHBOARD CONTROLLER (dashboard.js)
   Open Direct Access — Displays Flats, Owners, Games Played & Winners
   ========================================================================= */

(function () {
  let recentWinnersCache = [];

  async function loadDashboard() {
    try {
      const data = await SPW.apiFetch('/society/dashboard');
      renderSocietyBanner(data.society, data.settings);
      renderKpiStats(data.stats);
      renderRecentWinners(data.recentWinners || []);
    } catch (_) {
      const tbody = document.getElementById('dashRecentWinnersBody');
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-4 text-muted-light">
              Connect Microsoft SQL Server in <code>.env</code> to load live dashboard metrics.
            </td>
          </tr>
        `;
      }
    }
  }

  function renderSocietyBanner(society, settings) {
    if (!society) return;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('dashSocietyName', society.SocietyName);
    setTxt('dashSocietyAddress', society.SocietyAddress);
    setTxt(
      'dashCommitteeName',
      society.CommitteeName || 'Society Cultural & Events Committee'
    );
    setTxt(
      'dashEventTitle',
      settings?.EventTitle || 'Annual Society Family Festival & Lucky Draw'
    );

    const logoEl = document.getElementById('dashSocietyLogo');
    if (logoEl) {
      logoEl.src = society.SocietyLogo || SPW.DEFAULT_LOGO_IMAGE;
    }

    const modeBadge = document.getElementById('dashNoRepeatBadge');
    if (modeBadge) {
      const noRepeat = settings ? Boolean(settings.NoRepeatWinner) : true;
      modeBadge.innerHTML = noRepeat
        ? '<i class="fa-solid fa-shield-halved me-1"></i>No-Repeat Winner: ON'
        : '<i class="fa-solid fa-rotate me-1"></i>Repeat Winners: ALLOWED';
    }
  }

  function renderKpiStats(stats) {
    if (!stats) return;

    const reg = stats.totalRegisteredFlats || 0;
    const owners = stats.totalRegisteredOwners || 0;
    const cap = stats.societyCapacity || 500;
    const pool = stats.eligibleDrawPool || 0;
    const spins = stats.totalSpins || 0;
    const winners = stats.totalWinners || 0;
    const participating = stats.participatingFlats || 0;

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('kpiRegisteredFlats', reg.toLocaleString());
    setTxt('kpiCapacityLabel', `of ${cap.toLocaleString()} Society Capacity`);
    setTxt('kpiRegisteredOwners', owners.toLocaleString());
    setTxt('kpiEligibleSub', `${pool.toLocaleString()} Eligible in Draw Pool`);
    setTxt('kpiTotalSpins', spins.toLocaleString());
    setTxt('kpiWinningSpinsSub', `${(stats.winningSpins || 0).toLocaleString()} Winning Symbol Matches`);
    setTxt('kpiTotalWinners', winners.toLocaleString());

    const regPct = Math.min(100, Math.round((reg / Math.max(1, cap)) * 100));
    const partPct = reg > 0 ? Math.min(100, Math.round((participating / reg) * 100)) : 0;

    const regBar = document.getElementById('meterRegistrationBar');
    const regLbl = document.getElementById('meterRegistrationPct');
    if (regBar) regBar.style.width = `${regPct}%`;
    if (regLbl) regLbl.textContent = `${regPct}% (${reg}/${cap})`;

    const partBar = document.getElementById('meterParticipationBar');
    const partLbl = document.getElementById('meterParticipationPct');
    if (partBar) partBar.style.width = `${partPct}%`;
    if (partLbl) partLbl.textContent = `${partPct}% (${participating}/${reg})`;
  }

  function renderRecentWinners(winners) {
    recentWinnersCache = winners;
    const tbody = document.getElementById('dashRecentWinnersBody');
    if (!tbody) return;

    if (!winners.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-5 text-muted-light">
            <i class="fa-solid fa-trophy fs-2 text-gold mb-2 d-block opacity-75"></i>
            No winners drawn yet! Open <strong>Play Game</strong> and spin to crown your first lucky winner.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = winners
      .map((w) => {
        const sym = SPW.getSymbolMeta(w.MatchedSymbol);
        const gameCode = w.SessionCode || `SPW-${String(w.GameID).padStart(6, '0')}`;
        return `
          <tr>
            <td>
              <span class="badge-winner-crown">
                <i class="fa-solid fa-crown me-1"></i>${SPW.escapeHtml(gameCode)}
              </span>
            </td>
            <td class="fw-bold">${SPW.escapeHtml(w.OwnerName)}</td>
            <td><span class="badge bg-light text-neon-blue border px-2 py-1">${SPW.escapeHtml(w.FlatNumber)}</span></td>
            <td>${SPW.escapeHtml(w.SocietyName)}</td>
            <td>
              <span class="me-1">${SPW.escapeHtml(sym.emoji)}</span>
              <small class="text-muted-light">${SPW.escapeHtml(SPW.formatDateTime(w.DrawDateTime))}</small>
            </td>
            <td class="text-end">
              <button class="btn btn-sm btn-glass js-dash-print-cert" data-winner-id="${w.WinnerID}" title="Print Winner Certificate">
                <i class="fa-solid fa-print text-gold me-1"></i>Certificate
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.js-dash-print-cert').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-winner-id'), 10);
        try {
          const res = await SPW.apiFetch(`/winners/${id}`);
          SPW.printWinnerCertificate(res.winner);
        } catch (_) {
          const fallback = recentWinnersCache.find((x) => x.WinnerID === id);
          if (fallback) SPW.printWinnerCertificate(fallback);
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('dashRecentWinnersBody')) {
      loadDashboard();
    }
  });
})();
