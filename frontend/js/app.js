/* =========================================================================
   ROYAL PALMS PLAY & WIN - SHARED APPLICATION CORE (app.js)
   ========================================================================= */

(function () {
  const isBackendOrigin =
    window.location.protocol.startsWith('http') &&
    window.location.port !== '5500' &&
    window.location.port !== '5501' &&
    window.location.port !== '3000';

  const API_BASE = isBackendOrigin
    ? `${window.location.origin}/api`
    : 'http://localhost:5000/api';

  const MUTE_KEY = 'spw_sound_muted';
  const ADMIN_SESSION_KEY = 'spw_admin_mode';
  const DEFAULT_HERO_IMAGE = 'assets/images/society-building.jpg';
  const DEFAULT_LOGO_IMAGE = 'assets/images/default-society.svg';

  // Clean, simple, attractive game symbols
  const SYMBOLS = {
    STAR: { id: 'STAR', icon: '⭐', emoji: '⭐', label: 'Star' },
    GIFT: { id: 'GIFT', icon: '🎁', emoji: '🎁', label: 'Gift' },
    TROPHY: { id: 'TROPHY', icon: '🏆', emoji: '🏆', label: 'Trophy' },
    CROWN: { id: 'CROWN', icon: '👑', emoji: '👑', label: 'Crown' },
    DIAMOND: { id: 'DIAMOND', icon: '💎', emoji: '💎', label: 'Diamond' },
    CLOVER: { id: 'CLOVER', icon: '🍀', emoji: '🍀', label: 'Clover' },
    BELL: { id: 'BELL', icon: '🔔', emoji: '🔔', label: 'Bell' },
    MEDAL: { id: 'MEDAL', icon: '🏅', emoji: '🏅', label: 'Medal' }
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showDbSetupNotice(message) {
    const container = document.getElementById('dbAlertContainer');
    if (!container) return;
    if (document.getElementById('spwDbSetupBanner')) return;

    container.innerHTML = `
      <div id="spwDbSetupBanner" class="db-warning-banner mb-3">
        <div class="d-flex align-items-center justify-content-between gap-3 flex-wrap">
          <div class="d-flex align-items-center gap-2">
            <i class="fa-solid fa-circle-info text-gold"></i>
            <span class="small">
              ${escapeHtml(
                message ||
                  'Ensure the backend server is running ("cd backend && npm start") to access live society data.'
              )}
            </span>
          </div>
          <button type="button" class="btn btn-sm btn-glass py-1 px-2" onclick="this.closest('#spwDbSetupBanner').remove()">
            Dismiss
          </button>
        </div>
      </div>
    `;
  }

  function clearDbSetupNotice() {
    const banner = document.getElementById('spwDbSetupBanner');
    if (banner) banner.remove();
  }

  async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = Object.assign(
      {
        Accept: 'application/json'
      },
      options.headers || {}
    );

    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchConfig = Object.assign({}, options, { headers });

    if (
      fetchConfig.body &&
      typeof fetchConfig.body === 'object' &&
      !(fetchConfig.body instanceof FormData)
    ) {
      fetchConfig.body = JSON.stringify(fetchConfig.body);
    }

    let response;
    try {
      response = await fetch(url, fetchConfig);
    } catch (_) {
      showDbSetupNotice(
        'Backend server is not running yet. Run "cd backend && npm start" and open http://localhost:5000.'
      );
      const err = new Error('Backend server is unreachable. Start the server on port 5000.');
      err.code = 'SERVER_UNREACHABLE';
      throw err;
    }

    const contentType = response.headers.get('content-type') || '';
    let payload = null;

    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = { success: response.ok, message: text };
    }

    if (!response.ok) {
      if (
        payload?.code === 'DB_CONFIG_MISSING' ||
        payload?.code === 'DB_CONNECTION_FAILED' ||
        response.status === 503
      ) {
        showDbSetupNotice(payload?.message);
      }
      const err = new Error(payload?.message || `Request failed (${response.status})`);
      err.status = response.status;
      err.code = payload?.code || 'API_ERROR';
      err.payload = payload;
      throw err;
    }

    clearDbSetupNotice();
    return payload;
  }

  async function downloadFile(endpoint, fallbackFilename) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const res = await fetch(url);

    if (!res.ok) {
      let msg = 'Unable to export file.';
      try {
        const j = await res.json();
        msg = j.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    let filename = fallbackFilename;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match && match[1]) filename = match[1];

    const link = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    link.href = objUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  }

  function toast(icon, title) {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      customClass: { popup: 'arcade-swal' }
    });
  }

  function alertModal({ icon = 'info', title = '', text = '', html = '' }) {
    if (typeof Swal === 'undefined') {
      alert(title + '\n' + text);
      return Promise.resolve();
    }
    return Swal.fire({
      icon,
      title,
      text: html ? undefined : text,
      html: html || undefined,
      confirmButtonText: 'OK',
      confirmButtonColor: '#b88c35',
      customClass: { popup: 'arcade-swal' }
    });
  }

  async function confirmModal({
    title = 'Are you sure?',
    text = '',
    html = '',
    icon = 'warning',
    confirmButtonText = 'Confirm',
    cancelButtonText = 'Cancel'
  }) {
    if (typeof Swal === 'undefined') {
      return window.confirm(text || title);
    }
    const res = await Swal.fire({
      icon,
      title,
      text: html ? undefined : text,
      html: html || undefined,
      showCancelButton: true,
      confirmButtonColor: '#b88c35',
      cancelButtonColor: '#14213d',
      confirmButtonText,
      cancelButtonText,
      customClass: { popup: 'arcade-swal' }
    });
    return Boolean(res.isConfirmed);
  }

  /* =======================================================================
     SOUND ENGINE (WAV Assets + Web Audio Fallback)
     ======================================================================= */
  const audioCache = {};
  let audioCtx = null;

  function isMuted() {
    return localStorage.getItem(MUTE_KEY) === 'true';
  }

  function setMuted(muted) {
    localStorage.setItem(MUTE_KEY, muted ? 'true' : 'false');
    if (muted && audioCache.spin) {
      try {
        audioCache.spin.pause();
        audioCache.spin.currentTime = 0;
      } catch (_) {}
    }
  }

  function playSound(name, options = {}) {
    if (isMuted()) return null;

    const map = {
      click: 'assets/sounds/click.wav',
      spin: 'assets/sounds/spin.wav',
      stop: 'assets/sounds/reel-stop.wav',
      jackpot: 'assets/sounds/jackpot.wav',
      tryAgain: 'assets/sounds/try-again.wav'
    };

    const src = map[name];
    if (!src) return null;

    try {
      let audio = audioCache[name];
      if (!audio) {
        audio = new Audio(src);
        audioCache[name] = audio;
      }
      audio.loop = Boolean(options.loop);
      audio.volume = options.volume !== undefined ? options.volume : 0.6;
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => playSynthFallback(name));
      }
      return audio;
    } catch (_) {
      playSynthFallback(name);
      return null;
    }
  }

  function stopSound(name) {
    const audio = audioCache[name];
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
    }
  }

  function playSynthFallback(type) {
    if (isMuted()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'stop') {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.11);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.start(now);
        osc.stop(now + 0.14);
      } else if (type === 'jackpot') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        osc.frequency.setValueAtTime(783.99, now + 0.24);
        osc.frequency.setValueAtTime(1046.5, now + 0.36);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        osc.start(now);
        osc.stop(now + 0.88);
      }
    } catch (_) {}
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    return `${formatDate(isoStr)} • ${formatTime(isoStr)}`;
  }

  function getSymbolMeta(code) {
    const key = String(code || '').toUpperCase();
    return SYMBOLS[key] || { id: key || 'STAR', icon: '⭐', emoji: '⭐', label: key || 'Star' };
  }

  function applySocietyBrandingToDom(society) {
    if (!society) return;
    window.SPW.currentSociety = society;

    document.querySelectorAll('.js-society-name').forEach((el) => {
      el.textContent = society.SocietyName;
    });

    document.querySelectorAll('.js-society-logo').forEach((img) => {
      img.src = society.SocietyLogo || DEFAULT_LOGO_IMAGE;
    });

    document.querySelectorAll('.js-society-hero-img').forEach((img) => {
      img.src = society.SocietyImage || DEFAULT_HERO_IMAGE;
    });
  }

  async function hydrateNavbarBranding() {
    try {
      const data = await apiFetch('/society');
      if (data?.society) {
        applySocietyBrandingToDom(data.society);
      }
    } catch (_) {}
  }

  /* =======================================================================
     PRINT ENGINE (Certificates & Reports)
     ======================================================================= */
  function ensurePrintContainers() {
    let certEl = document.getElementById('printableCertificateSection');
    if (!certEl) {
      certEl = document.createElement('div');
      certEl.id = 'printableCertificateSection';
      certEl.className = 'print-only-container';
      document.body.appendChild(certEl);
    }

    let repEl = document.getElementById('printableReportSection');
    if (!repEl) {
      repEl = document.createElement('div');
      repEl.id = 'printableReportSection';
      repEl.className = 'print-only-container';
      document.body.appendChild(repEl);
    }
    return { certEl, repEl };
  }

  function printWinnerCertificate(winner) {
    if (!winner) return;
    const { certEl } = ensurePrintContainers();
    const sym = getSymbolMeta(winner.MatchedSymbol);
    const logoSrc =
      winner.SocietyLogo ||
      window.SPW.currentSociety?.SocietyLogo ||
      DEFAULT_LOGO_IMAGE;
    const address =
      winner.SocietyAddress ||
      window.SPW.currentSociety?.SocietyAddress ||
      'Registered Residential Society';
    const certNo =
      winner.CertificateNo || `CERT-${String(winner.WinnerID || 1).padStart(6, '0')}`;
    const gameCode =
      winner.SessionCode || `SPW-${String(winner.GameID || 1).padStart(6, '0')}`;

    certEl.innerHTML = `
      <div class="certificate-sheet">
        <div class="certificate-inner">
          <img src="${escapeHtml(logoSrc)}" alt="Society Logo" class="cert-logo" />
          <div class="cert-society-title">${escapeHtml(winner.SocietyName || 'Royal Palms Society')}</div>
          <div class="cert-society-address">${escapeHtml(address)}</div>
          <div class="cert-badge-ribbon">OFFICIAL SOCIETY LUCKY DRAW</div>
          <div class="cert-main-heading">WINNER CERTIFICATE</div>
          <p style="font-size: 14px; color: #475569; margin: 4px 0;">
            This certificate proudly recognizes that
          </p>
          <div class="cert-winner-name">${escapeHtml(winner.OwnerName)}</div>
          <p style="font-size: 14px; color: #334155; max-width: 660px; margin: 0 auto 14px;">
            has been selected in the society lucky draw as the official
            <strong>${escapeHtml(winner.PrizeTitle || 'Official Society Play & Win Winner')}</strong>.
          </p>

          <div class="cert-details-grid">
            <div class="cert-detail-box">
              <div class="cert-detail-label">Flat Number</div>
              <div class="cert-detail-value">${escapeHtml(winner.FlatNumber)}</div>
            </div>
            <div class="cert-detail-box">
              <div class="cert-detail-label">Society Name</div>
              <div class="cert-detail-value">${escapeHtml(winner.SocietyName)}</div>
            </div>
            <div class="cert-detail-box">
              <div class="cert-detail-label">Winning Symbol</div>
              <div class="cert-detail-value">${escapeHtml(sym.emoji)} ${escapeHtml(sym.label)}</div>
            </div>
            <div class="cert-detail-box">
              <div class="cert-detail-label">Certificate No</div>
              <div class="cert-detail-value">${escapeHtml(certNo)}</div>
            </div>
            <div class="cert-detail-box">
              <div class="cert-detail-label">Game Session ID</div>
              <div class="cert-detail-value">${escapeHtml(gameCode)}</div>
            </div>
            <div class="cert-detail-box">
              <div class="cert-detail-label">Draw Date &amp; Time</div>
              <div class="cert-detail-value">${escapeHtml(formatDate(winner.DrawDateTime))} ${escapeHtml(formatTime(winner.DrawDateTime))}</div>
            </div>
          </div>

          <div class="cert-footer-row">
            <div class="cert-sign-line">Winner Signature</div>
            <div style="font-size: 11px; color: #64748b;">
              Royal Palms Play &amp; Win<br/>
              Official Record #${escapeHtml(winner.WinnerID || '')}
            </div>
            <div class="cert-sign-line">Society Committee</div>
          </div>
        </div>
      </div>
    `;

    document.body.classList.remove('print-mode-report');
    document.body.classList.add('print-mode-certificate');

    const cleanup = () => {
      document.body.classList.remove('print-mode-certificate');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 120);
  }

  function printTabularReport({ title, subtitle, columns, rows, summaryText }) {
    const { repEl } = ensurePrintContainers();
    const society = window.SPW.currentSociety || {};
    const logoSrc = society.SocietyLogo || DEFAULT_LOGO_IMAGE;
    const generatedAt = new Date().toLocaleString('en-IN');

    const theadHtml = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('');
    const tbodyHtml =
      rows.length > 0
        ? rows
            .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
            .join('')
        : `<tr><td colspan="${columns.length}" style="text-align:center; padding: 18px;">No records found.</td></tr>`;

    repEl.innerHTML = `
      <div class="report-print-wrapper">
        <div class="report-print-header">
          <div style="display:flex; align-items:center; gap:14px;">
            <img src="${escapeHtml(logoSrc)}" alt="Logo" style="width:52px; height:52px; object-fit:contain;" />
            <div>
              <div style="font-size:18px; font-weight:800;">${escapeHtml(society.SocietyName || 'Royal Palms Society')}</div>
              <div style="font-size:12px; color:#475569;">${escapeHtml(society.SocietyAddress || '')}</div>
              <div style="font-size:14px; font-weight:700; margin-top:4px; color:#1e293b;">${escapeHtml(title)}</div>
              ${subtitle ? `<div style="font-size:11.5px; color:#64748b;">${escapeHtml(subtitle)}</div>` : ''}
            </div>
          </div>
          <div style="text-align:right; font-size:11.5px; color:#475569;">
            <div><strong>Royal Palms Play &amp; Win</strong></div>
            <div>Printed: ${escapeHtml(generatedAt)}</div>
            ${summaryText ? `<div style="margin-top:4px; font-weight:700; color:#0f172a;">${escapeHtml(summaryText)}</div>` : ''}
          </div>
        </div>

        <table class="report-print-table">
          <thead><tr>${theadHtml}</tr></thead>
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    `;

    document.body.classList.remove('print-mode-certificate');
    document.body.classList.add('print-mode-report');

    const cleanup = () => {
      document.body.classList.remove('print-mode-report');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 120);
  }

  function initAdminNavigationVisibility() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('admin') === '0') {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
      } else if (
        params.get('admin') === '1' ||
        document.body?.dataset?.spwAdminPage === 'true'
      ) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      }

      const isAdminActive = sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
      const adminSlot = document.getElementById('adminNavSlot');
      if (adminSlot) {
        if (!isAdminActive) {
          adminSlot.classList.add('d-none');
          adminSlot.innerHTML = '';
        } else {
          const path = window.location.pathname.toLowerCase();
          const isFlats = path.endsWith('flats.html');
          const isSettings = path.endsWith('settings.html');

          adminSlot.classList.remove('d-none');
          adminSlot.innerHTML = `
            <div class="admin-nav-pill-group">
              <a href="flats.html" class="nav-secondary-link ${isFlats ? 'active' : ''}">Manage Flats</a>
              <a href="settings.html" class="nav-secondary-link ${isSettings ? 'active' : ''}">Settings</a>
              <button type="button" id="spwExitAdminBtn" class="btn btn-sm py-0 px-2 text-muted-light border-0" title="Return to Resident View">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          `;

          const exitBtn = document.getElementById('spwExitAdminBtn');
          if (exitBtn) {
            exitBtn.addEventListener('click', () => {
              sessionStorage.removeItem(ADMIN_SESSION_KEY);
              window.location.href = 'index.html';
            });
          }
        }
      }

      const dashAdminSlot = document.getElementById('dashAdminActionsSlot');
      if (dashAdminSlot) {
        if (isAdminActive) {
          dashAdminSlot.classList.remove('d-none');
          dashAdminSlot.innerHTML = `
            <div class="col-6">
              <a href="flats.html" class="btn btn-glass w-100 text-start">
                <i class="fa-solid fa-building text-neon-blue me-2"></i>Manage Flats
              </a>
            </div>
            <div class="col-6">
              <a href="settings.html" class="btn btn-glass w-100 text-start">
                <i class="fa-solid fa-sliders text-secondary me-2"></i>Settings
              </a>
            </div>
          `;
        } else {
          dashAdminSlot.classList.add('d-none');
          dashAdminSlot.innerHTML = '';
        }
      }
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    initAdminNavigationVisibility();
    hydrateNavbarBranding();
  });

  window.SPW = {
    API_BASE,
    SYMBOLS,
    DEFAULT_HERO_IMAGE,
    DEFAULT_LOGO_IMAGE,
    currentSociety: null,
    escapeHtml,
    apiFetch,
    downloadFile,
    toast,
    alertModal,
    confirmModal,
    sound: {
      isMuted,
      setMuted,
      play: playSound,
      stop: stopSound
    },
    formatDate,
    formatTime,
    formatDateTime,
    getSymbolMeta,
    applySocietyBrandingToDom,
    hydrateNavbarBranding,
    printWinnerCertificate,
    printTabularReport
  };
})();
