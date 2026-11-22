/* =========================================================================
   ROYAL PALMS FLAT ALLOCATION PORTAL - SHARED CLIENT CORE (lottery-core.js)
   - JWT Auth State & Role Helpers
   - API Client + Authenticated Export / PDF Downloads
   - Luxury Winning Ticket Renderer (HTML + Print + PDF + Share)
   - Multi-Ticket & Official Report Print Engine
   - Cross-Window Live BroadcastChannel Sync
   ========================================================================= */

(function () {
  const isBackendOrigin =
    window.location.protocol.startsWith('http') &&
    !['5500', '5501', '3000'].includes(window.location.port);

  const API_ROOT = isBackendOrigin
    ? `${window.location.origin}/api/lottery`
    : 'http://localhost:5000/api/lottery';

  const TOKEN_KEY = 'rp_lottery_jwt';
  const ADMIN_KEY = 'rp_lottery_admin';

  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('rp_live_lottery_sync');
    }
  } catch (_) {}

  function escapeHtml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function getStoredAdmin() {
    try {
      const raw = localStorage.getItem(ADMIN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveAuthSession(token, admin) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  }

  function clearAuthSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
  }

  function canMutate(admin = getStoredAdmin()) {
    if (!admin) return true;
    return ['SUPER_ADMIN', 'LOTTERY_OPERATOR'].includes(admin.role);
  }

  function isSuperAdmin(admin = getStoredAdmin()) {
    if (!admin) return true;
    return admin.role === 'SUPER_ADMIN';
  }

  function generateIdempotencyKey(prefix = 'draw') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    const arr = new Uint32Array(3);
    window.crypto.getRandomValues(arr);
    return `${prefix}-${Date.now()}-${Array.from(arr).join('-')}`;
  }

  async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_ROOT}${endpoint}`;
    const token = getToken();
    const headers = Object.assign(
      { Accept: 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {},
      options.headers || {}
    );

    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const cfg = Object.assign({}, options, { headers });
    if (cfg.body && typeof cfg.body === 'object' && !(cfg.body instanceof FormData)) {
      cfg.body = JSON.stringify(cfg.body);
    }

    let res;
    try {
      res = await fetch(url, cfg);
    } catch (_) {
      const netErr = new Error(
        'Backend server is not running on port 5000. Run "cd backend && npm start" in your terminal.'
      );
      netErr.code = 'BACKEND_UNREACHABLE';
      throw netErr;
    }
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json')
      ? await res.json()
      : { success: res.ok, message: await res.text() };

    if (!res.ok) {
      const err = new Error(payload?.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = payload?.code || 'API_ERROR';
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  async function downloadFile(endpoint, fallbackFilename) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_ROOT}${endpoint}`;
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!res.ok) {
      let msg = 'Unable to download file.';
      try {
        const j = await res.json();
        msg = j.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    let filename = fallbackFilename;
    const disp = res.headers.get('Content-Disposition') || '';
    const m = disp.match(/filename="?([^"]+)"?/i);
    if (m && m[1]) filename = m[1];

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2500);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  function toast(icon, title) {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer: 3200,
      timerProgressBar: true
    });
  }

  function broadcastEvent(type, data = {}) {
    if (!syncChannel) return;
    try {
      syncChannel.postMessage({ type, data, ts: Date.now() });
    } catch (_) {}
  }

  function onBroadcast(handler) {
    if (!syncChannel) return;
    syncChannel.addEventListener('message', (ev) => {
      if (ev?.data) handler(ev.data);
    });
  }

  /**
   * Renders the Luxurious Digital Winning Allocation Ticket HTML.
   */
  function renderLuxuryTicketHtml(ticket, event = {}, opts = {}) {
    if (!ticket) return '';
    const societyName = ticket.societyName || event?.societyName || 'ROYAL PALMS SOCIETY';
    const unitSub = [
      ticket.wing,
      ticket.floor ? `Floor ${ticket.floor}` : '',
      ticket.building
    ]
      .filter(Boolean)
      .join(' • ');

    const showActions = opts.showActions !== false;

    return `
      <div class="rp-luxury-ticket" data-allocation-id="${escapeHtml(ticket.allocationId)}">
        <div class="rp-ticket-fireworks-layer no-print" aria-hidden="true">
          <span class="rp-fw-burst rp-fw-1"></span>
          <span class="rp-fw-burst rp-fw-2"></span>
          <span class="rp-fw-burst rp-fw-3"></span>
          <span class="rp-fw-burst rp-fw-4"></span>
        </div>
        <div class="rp-ticket-inner">
          <div class="rp-ticket-header">
            <div class="rp-ticket-society">${escapeHtml(societyName.toUpperCase())}</div>
            <div class="rp-ticket-subtitle">OFFICIAL FLAT ALLOCATION TICKET</div>
          </div>

          <div class="rp-ticket-divider"></div>

          <div class="rp-ticket-congrats-wrap">
            <span class="rp-cracker-icon" aria-hidden="true">🧨🎆</span>
            <div class="rp-ticket-congrats">🎉 CONGRATULATIONS! 🎉</div>
            <span class="rp-cracker-icon" aria-hidden="true">🎆🧨</span>
          </div>

          <div class="rp-ticket-winner-name">${escapeHtml(ticket.participantName)}</div>
          <div class="rp-ticket-pid">Participant ID: <strong>${escapeHtml(ticket.participantId)}</strong>${ticket.registrationNumber ? ` • Reg: <strong>${escapeHtml(ticket.registrationNumber)}</strong>` : ''}</div>

          <div class="rp-ticket-congrats-blessing">
            ✨ Heartiest Congratulations on Your New Flat at <strong>${escapeHtml(societyName)}</strong>! 🎊
          </div>

          <div class="rp-ticket-allocated-caption">YOUR FLAT HAS BEEN OFFICIALLY ALLOCATED</div>

          <div class="rp-ticket-flat-vault">
            <span class="rp-ticket-flat-label">🎇 ALLOTTED FLAT NO. 🎇</span>
            <span class="rp-ticket-flat-number">${escapeHtml(ticket.flatNumber)}</span>
            ${unitSub ? `<span class="rp-ticket-flat-meta">${escapeHtml(unitSub)}</span>` : ''}
          </div>

          <div class="rp-ticket-footer-grid">
            <div class="rp-ticket-meta-list">
              <div><span>Society:</span> <strong>${escapeHtml(societyName)}</strong></div>
              <div><span>Allocation ID:</span> <strong>${escapeHtml(ticket.allocationId)}</strong></div>
              <div><span>Allocation Type:</span> <strong>${escapeHtml(ticket.allocationType)} ALLOCATION</strong></div>
              <div><span>Date &amp; Time:</span> <strong>${escapeHtml(formatDateTime(ticket.allocatedAt))}</strong></div>
              <div><span>Status:</span> <strong class="rp-status-verified">SUCCESSFULLY ALLOCATED</strong></div>
              <div><span>Verify Ref:</span> <code>${escapeHtml(ticket.verificationRef || String(ticket.verificationHash || '').slice(0, 12).toUpperCase())}</code></div>
            </div>

            <div class="rp-ticket-qr-box">
              <div class="rp-ticket-qr-svg">${ticket.qrSvg || ''}</div>
              <div class="rp-ticket-qr-caption">SCAN TO VERIFY</div>
            </div>
          </div>

          ${
            showActions
              ? `
            <div class="rp-ticket-actions no-print">
              <button type="button" class="btn rp-btn-ticket-celebrate js-ticket-celebrate" title="Play Clapping & Firecracker Celebration">
                🎆 👏 Clap &amp; Firecrackers
              </button>
              <button type="button" class="btn rp-btn-ticket-gold js-ticket-pdf" data-alloc-id="${escapeHtml(ticket.allocationId)}">
                <i class="fa-solid fa-file-pdf me-1"></i>Download PDF
              </button>
              <button type="button" class="btn rp-btn-ticket-outline js-ticket-print" data-alloc-id="${escapeHtml(ticket.allocationId)}">
                <i class="fa-solid fa-print me-1"></i>Print Ticket
              </button>
              <button type="button" class="btn rp-btn-ticket-outline js-ticket-share" data-alloc-id="${escapeHtml(ticket.allocationId)}">
                <i class="fa-solid fa-share-nodes me-1"></i>Share
              </button>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  function triggerFestiveFirecrackerConfetti() {
    if (typeof confetti !== 'function') return;
    const fireworkColors = ['#ffd700', '#ff3b5c', '#cfa652', '#10b981', '#ff9f1c', '#fffdf8', '#38bdf8'];

    // Center golden star explosion
    confetti({
      particleCount: 100,
      spread: 110,
      startVelocity: 42,
      shapes: ['star', 'circle'],
      scalar: 1.15,
      origin: { x: 0.5, y: 0.52 },
      colors: fireworkColors
    });

    // Multi-point aerial firecracker bursts
    const burstPoints = [
      { x: 0.22, y: 0.35, delay: 180 },
      { x: 0.78, y: 0.35, delay: 360 },
      { x: 0.32, y: 0.28, delay: 620 },
      { x: 0.68, y: 0.28, delay: 880 },
      { x: 0.5, y: 0.24, delay: 1150 }
    ];

    burstPoints.forEach((pt) => {
      setTimeout(() => {
        confetti({
          particleCount: 65,
          spread: 360,
          ticks: 75,
          gravity: 0.85,
          decay: 0.92,
          startVelocity: 28,
          shapes: ['star', 'circle'],
          scalar: 1.1,
          origin: { x: pt.x, y: pt.y },
          colors: fireworkColors
        });
      }, pt.delay);
    });
  }

  function bindTicketActionButtons(container, getTicketFn, eventObj = {}) {
    if (!container) return;

    container.querySelectorAll('.js-ticket-celebrate').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.RPShowAudio) {
          window.RPShowAudio.unlock();
          if (typeof window.RPShowAudio.playClapAndFirecrackers === 'function') {
            window.RPShowAudio.playClapAndFirecrackers();
          } else if (typeof window.RPShowAudio.playCelebrationFanfare === 'function') {
            window.RPShowAudio.playCelebrationFanfare();
          }
        }
        triggerFestiveFirecrackerConfetti();
      });
    });

    container.querySelectorAll('.js-ticket-pdf').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-alloc-id');
        try {
          await downloadFile(
            `/allocations/${encodeURIComponent(id)}/ticket.pdf`,
            `RoyalPalms_Ticket_${id}.pdf`
          );
        } catch (err) {
          toast('error', err.message);
        }
      });
    });

    container.querySelectorAll('.js-ticket-print').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-alloc-id');
        const t = typeof getTicketFn === 'function' ? await getTicketFn(id) : null;
        if (t) printTickets([t], eventObj);
      });
    });

    container.querySelectorAll('.js-ticket-share').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-alloc-id');
        const t = typeof getTicketFn === 'function' ? await getTicketFn(id) : null;
        if (!t) return;
        const verifyUrl = new URL(
          `index.html?verify=${encodeURIComponent(t.allocationId)}`,
          window.location.href
        ).href;
        const shareText = `Royal Palms Flat Allocation: Congratulations ${t.participantName}! Allocated Flat No. ${t.flatNumber} (Allocation ID: ${t.allocationId}). Verify: ${verifyUrl}`;

        if (navigator.share) {
          try {
            await navigator.share({
              title: `Royal Palms Allocation Ticket ${t.allocationId}`,
              text: shareText,
              url: verifyUrl
            });
            return;
          } catch (_) {}
        }

        try {
          await navigator.clipboard.writeText(shareText);
          toast('success', 'Official allocation verification details copied to clipboard!');
        } catch (_) {
          prompt('Copy official verification link:', verifyUrl);
        }
      });
    });
  }

  /**
   * Ensures hidden print mount exists & injects print styles once.
   */
  function ensurePrintMount() {
    let styleEl = document.getElementById('rpSharedTicketStyles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'rpSharedTicketStyles';
      styleEl.textContent = `
        .rp-luxury-ticket {
          position: relative;
          overflow: hidden;
          max-width: 680px;
          margin: 0 auto;
          padding: 10px;
          border-radius: 20px;
          background: linear-gradient(145deg, #0b1630 0%, #13254c 100%);
          border: 2px solid #cfa652;
          box-shadow: 0 24px 60px rgba(4, 9, 24, 0.42), 0 0 42px rgba(207, 166, 82, 0.22);
          color: #fffdf8;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .rp-ticket-fireworks-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }
        .rp-fw-burst {
          position: absolute;
          width: 110px;
          height: 110px;
          border-radius: 50%;
          background:
            radial-gradient(circle, #ffd700 0 3px, transparent 4px),
            radial-gradient(circle, #ff3b5c 0 3px, transparent 4px) 50% 6% / 14px 14px no-repeat,
            radial-gradient(circle, #ffd700 0 3px, transparent 4px) 94% 50% / 14px 14px no-repeat,
            radial-gradient(circle, #38bdf8 0 3px, transparent 4px) 50% 94% / 14px 14px no-repeat,
            radial-gradient(circle, #10b981 0 3px, transparent 4px) 6% 50% / 14px 14px no-repeat,
            radial-gradient(circle, #ff9f1c 0 2.5px, transparent 3.5px) 82% 18% / 14px 14px no-repeat,
            radial-gradient(circle, #ff3b5c 0 2.5px, transparent 3.5px) 18% 18% / 14px 14px no-repeat,
            radial-gradient(circle, #ffd700 0 2.5px, transparent 3.5px) 82% 82% / 14px 14px no-repeat,
            radial-gradient(circle, #38bdf8 0 2.5px, transparent 3.5px) 18% 82% / 14px 14px no-repeat;
          opacity: 0;
          animation: rpFireworkExplode 2.2s ease-out infinite;
        }
        .rp-fw-1 { top: 8%; left: 6%; animation-delay: 0s; }
        .rp-fw-2 { top: 10%; right: 6%; animation-delay: 0.55s; }
        .rp-fw-3 { bottom: 22%; left: 8%; animation-delay: 1.1s; }
        .rp-fw-4 { bottom: 24%; right: 8%; animation-delay: 1.65s; }
        @keyframes rpFireworkExplode {
          0% { transform: scale(0.2); opacity: 0; }
          25% { opacity: 0.95; }
          85% { transform: scale(1.35); opacity: 0.3; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .rp-ticket-inner {
          position: relative;
          z-index: 1;
          border: 1px solid rgba(235, 210, 152, 0.55);
          border-radius: 14px;
          padding: 1.5rem 1.75rem;
          text-align: center;
          background: radial-gradient(circle at top, rgba(207, 166, 82, 0.16), transparent 68%);
        }
        .rp-ticket-society {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #f3dc9f;
        }
        .rp-ticket-subtitle {
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          color: #cbd5e1;
          margin-top: 0.2rem;
        }
        .rp-ticket-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, #cfa652, transparent);
          margin: 1rem 0;
        }
        .rp-ticket-congrats-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          margin-bottom: 0.65rem;
        }
        .rp-cracker-icon {
          font-size: 1.35rem;
          display: inline-block;
          animation: rpCrackerBounce 0.9s ease-in-out infinite alternate;
        }
        @keyframes rpCrackerBounce {
          from { transform: scale(0.92) rotate(-7deg); }
          to { transform: scale(1.15) rotate(7deg); }
        }
        .rp-ticket-congrats {
          display: inline-block;
          padding: 0.35rem 1.35rem;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255, 215, 0, 0.26) 0%, rgba(255, 59, 92, 0.24) 100%);
          border: 1.5px solid #ffd700;
          box-shadow: 0 0 22px rgba(255, 215, 0, 0.35);
          color: #fff6c2;
          font-size: 0.92rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-shadow: 0 2px 10px rgba(255, 215, 0, 0.45);
        }
        .rp-ticket-congrats-blessing {
          display: inline-block;
          margin-top: 0.55rem;
          padding: 0.32rem 0.95rem;
          border-radius: 10px;
          background: rgba(255, 215, 0, 0.1);
          border: 1px dashed rgba(246, 226, 174, 0.45);
          color: #fde68a;
          font-size: 0.82rem;
          font-weight: 600;
        }
        .rp-ticket-winner-name {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: clamp(1.6rem, 3vw, 2.25rem);
          font-weight: 700;
          color: #ffffff;
          letter-spacing: 0.02em;
        }
        .rp-ticket-pid {
          font-size: 0.84rem;
          color: #cbd5e1;
          margin-top: 0.25rem;
        }
        .rp-ticket-allocated-caption {
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.18em;
          color: #e2c57c;
          margin: 1.05rem 0 0.65rem;
        }
        .rp-ticket-flat-vault {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          min-width: 220px;
          padding: 0.85rem 2.2rem;
          border-radius: 16px;
          background: linear-gradient(135deg, #ebd298 0%, #cfa652 52%, #b5882f 100%);
          color: #0b1630;
          border: 2px solid #fff3d1;
          box-shadow: 0 12px 30px rgba(207, 166, 82, 0.32);
        }
        .rp-ticket-flat-label {
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.18em;
        }
        .rp-ticket-flat-number {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 2.65rem;
          font-weight: 800;
          line-height: 1.08;
        }
        .rp-ticket-flat-meta {
          font-size: 0.78rem;
          font-weight: 700;
          margin-top: 0.15rem;
        }
        .rp-ticket-footer-grid {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 1.25rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(235, 210, 152, 0.3);
          text-align: left;
        }
        .rp-ticket-meta-list {
          font-size: 0.82rem;
          line-height: 1.65;
          color: #e2e8f0;
        }
        .rp-ticket-meta-list span {
          color: #94a3b8;
          display: inline-block;
          min-width: 112px;
        }
        .rp-ticket-meta-list code {
          color: #f5deb3;
        }
        .rp-status-verified {
          color: #6ee7b7;
        }
        .rp-ticket-qr-box {
          background: #fffdf8;
          padding: 0.45rem;
          border-radius: 12px;
          border: 1px solid #cfa652;
          text-align: center;
          flex-shrink: 0;
        }
        .rp-ticket-qr-svg svg {
          width: 96px;
          height: 96px;
          display: block;
        }
        .rp-ticket-qr-caption {
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #0b1630;
          margin-top: 0.2rem;
        }
        .rp-ticket-actions {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 0.6rem;
          margin-top: 1.2rem;
        }
        .rp-btn-ticket-celebrate {
          background: linear-gradient(135deg, #ff3b5c 0%, #f59e0b 52%, #ffd700 100%);
          color: #0b1630 !important;
          font-weight: 800;
          font-size: 0.85rem;
          border: 1px solid #fff3d1;
          border-radius: 10px;
          padding: 0.48rem 1.05rem;
          box-shadow: 0 6px 18px rgba(255, 59, 92, 0.35);
        }
        .rp-btn-ticket-celebrate:hover {
          filter: brightness(1.08);
          transform: translateY(-1px);
        }
        .rp-btn-ticket-gold {
          background: linear-gradient(135deg, #ebd298 0%, #cfa652 100%);
          color: #0b1630 !important;
          font-weight: 700;
          font-size: 0.85rem;
          border: 1px solid #b5882f;
          border-radius: 10px;
          padding: 0.48rem 1rem;
        }
        .rp-btn-ticket-outline {
          background: rgba(255, 255, 255, 0.08);
          color: #f8fafc !important;
          border: 1px solid rgba(235, 210, 152, 0.45);
          font-weight: 600;
          font-size: 0.85rem;
          border-radius: 10px;
          padding: 0.48rem 1rem;
        }
        #rpPrintHost {
          display: none;
        }
        @media (max-width: 575.98px) {
          .rp-ticket-footer-grid {
            flex-direction: column;
            align-items: center;
            text-align: center;
          }
          .rp-ticket-meta-list span {
            min-width: auto;
            margin-right: 0.3rem;
          }
        }
        @media print {
          body.rp-printing > *:not(#rpPrintHost) {
            display: none !important;
          }
          body.rp-printing {
            background: #ffffff !important;
            color: #0f172a !important;
          }
          body.rp-printing #rpPrintHost {
            display: block !important;
            width: 100%;
          }
          .rp-print-ticket-page {
            page-break-inside: avoid;
            margin: 0 auto 18mm;
          }
          .rp-luxury-ticket {
            box-shadow: none !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .rp-print-report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          .rp-print-report-table th,
          .rp-print-report-table td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
            text-align: left;
          }
          .rp-print-report-table th {
            background: #f1f5f9 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `;
      document.head.appendChild(styleEl);
    }

    let mount = document.getElementById('rpPrintHost');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'rpPrintHost';
      document.body.appendChild(mount);
    }
    return mount;
  }

  function printTickets(tickets, event = {}) {
    if (!Array.isArray(tickets) || tickets.length === 0) return;
    const mount = ensurePrintMount();
    mount.innerHTML = tickets
      .map(
        (t) =>
          `<div class="rp-print-ticket-page">${renderLuxuryTicketHtml(t, event, { showActions: false })}</div>`
      )
      .join('');

    document.body.classList.add('rp-printing');
    const cleanup = () => {
      document.body.classList.remove('rp-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 140);
  }

  function printTabularReport({ title, societyName, summaryItems = [], columns = [], rows = [] }) {
    const mount = ensurePrintMount();
    const sumHtml = summaryItems
      .map((s) => `<span style="margin-right:16px;"><strong>${escapeHtml(s.label)}:</strong> ${escapeHtml(s.value)}</span>`)
      .join('');

    const ths = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const trs = rows.length
      ? rows
          .map(
            (r) =>
              `<tr>${Object.values(r)
                .map((v) => `<td>${escapeHtml(v)}</td>`)
                .join('')}</tr>`
          )
          .join('')
      : `<tr><td colspan="${columns.length}" style="text-align:center;padding:16px;">No records found.</td></tr>`;

    mount.innerHTML = `
      <div style="padding: 8px 4px; font-family: 'Plus Jakarta Sans', sans-serif; color: #0f172a;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #0b1630; padding-bottom:10px; margin-bottom:12px;">
          <div>
            <div style="font-size:18px; font-weight:800;">${escapeHtml(societyName || 'Royal Palms Co-operative Housing Society')}</div>
            <div style="font-size:13px; font-weight:700; color:#9e7624; margin-top:2px;">${escapeHtml(title)}</div>
          </div>
          <div style="font-size:11px; color:#475569;">Printed: ${escapeHtml(new Date().toLocaleString('en-IN'))}</div>
        </div>
        ${sumHtml ? `<div style="font-size:11.5px; margin-bottom:12px; padding:8px 10px; background:#f8fafc; border:1px solid #cbd5e1;">${sumHtml}</div>` : ''}
        <table class="rp-print-report-table">
          <thead><tr>${ths}</tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    `;

    document.body.classList.add('rp-printing');
    const cleanup = () => {
      document.body.classList.remove('rp-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 140);
  }

  // Inject shared ticket styles immediately on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePrintMount);
  } else {
    ensurePrintMount();
  }

  window.RPLottery = {
    API_ROOT,
    escapeHtml,
    getToken,
    getStoredAdmin,
    saveAuthSession,
    clearAuthSession,
    canMutate,
    isSuperAdmin,
    generateIdempotencyKey,
    apiFetch,
    downloadFile,
    formatDateTime,
    toast,
    broadcastEvent,
    onBroadcast,
    renderLuxuryTicketHtml,
    bindTicketActionButtons,
    printTickets,
    printTabularReport
  };
})();
