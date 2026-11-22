/* =========================================================================
   ROYAL PALMS — GRAND FLAT ALLOCATION LIVE SHOW CONTROLLER (live-show.js)
   - Connects directly to MongoDB Backend (/api/lottery/*)
   - 6-Stage Dramatic Broadcast Sequence (3-2-1 -> Music -> Name -> Flat -> Ticket)
   - Zero Fake Results: Always reveals the actual MongoDB-saved allocation
   - Safe Replay Animation (replays visual/audio celebration without new DB draw)
   - Pause/Resume, Previous Allocation History Stepper, Full Screen & Audio Controls
   ========================================================================= */

(function () {
  const showState = {
    event: null,
    summary: null,
    isAnimating: false,
    isPaused: false,
    drawRequestInFlight: false,
    allocationsHistory: [], // ordered newest-first: index 0 is latest
    viewingIndex: 0,
    currentTicket: null,
    lastDrumCandidates: null
  };

  let pauseWaitResolvers = [];

  function sleepPausable(ms) {
    return new Promise((resolve) => {
      let remaining = ms;
      let lastTick = performance.now();

      const step = () => {
        if (showState.isPaused) {
          pauseWaitResolvers.push(() => {
            lastTick = performance.now();
            requestAnimationFrame(step);
          });
          return;
        }
        const now = performance.now();
        remaining -= now - lastTick;
        lastTick = now;
        if (remaining <= 0) {
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };

      requestAnimationFrame(step);
    });
  }

  function releasePauseResolvers() {
    const list = pauseWaitResolvers.splice(0, pauseWaitResolvers.length);
    list.forEach((fn) => fn());
  }

  async function initLiveShow() {
    bindShowControls();
    syncAudioControlsUi();
    await refreshOverviewAndHistory();

    // Listen for live BroadcastChannel events from Admin Portal
    RPLottery.onBroadcast((msg) => {
      if (msg.type === 'ALLOCATION_DRAWN' || msg.type === 'EVENT_UPDATED') {
        refreshOverviewAndHistory();
      }
    });
  }

  async function refreshOverviewAndHistory() {
    try {
      const data = await RPLottery.apiFetch('/overview');
      showState.event = data.event;
      showState.summary = data.summary;

      try {
        const hist = await RPLottery.apiFetch('/allocations?limit=200&includeQr=true');
        showState.allocationsHistory = (hist.allocations || []).filter(
          (a) => a.allocationType === 'RANDOM' || a.allocationType === 'FIXED'
        );
      } catch (_) {
        showState.allocationsHistory = data.recentAllocations || [];
      }

      renderTopHud();
      syncControlButtonsState();

      // If idle and we already have a latest allocation, show idle or latest ticket cleanly
      if (!showState.isAnimating && !showState.currentTicket && showState.allocationsHistory.length > 0) {
        showState.currentTicket = showState.allocationsHistory[0];
        showState.viewingIndex = 0;
        syncControlButtonsState();
      }
    } catch (err) {
      console.error('Failed to load live show overview:', err);
    }
  }

  function renderTopHud() {
    const ev = showState.event || {};
    const sum = showState.summary || {};

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    setTxt('showSocietyLabel', (ev.societyName || 'ROYAL PALMS').toUpperCase());
    setTxt('showEventTitle', (ev.eventName || 'GRAND FLAT ALLOCATION').toUpperCase());
    setTxt('hudRemParticipants', (sum.remainingParticipants || 0).toLocaleString());
    setTxt('hudRemFlats', (sum.remainingFlats || 0).toLocaleString());
    setTxt('hudTotalAllocated', (sum.totalAllocated || 0).toLocaleString());

    const logo = document.getElementById('showLogoImg');
    if (logo && ev.societyLogo) logo.src = ev.societyLogo;

    const statusBadge = document.getElementById('showStatusBadge');
    if (statusBadge) {
      const st = ev.status || 'DRAFT';
      statusBadge.textContent = st;
      statusBadge.className = 'show-status-badge';
      if (st === 'LIVE') statusBadge.classList.add('status-live');
      if (st === 'PAUSED') statusBadge.classList.add('status-paused');
    }

    showState.isPaused = ev.status === 'PAUSED';
    const pausedOverlay = document.getElementById('pausedStageBadge');
    if (pausedOverlay) {
      pausedOverlay.classList.toggle('d-none', !showState.isPaused);
    }

    const startLbl = document.getElementById('btnStartDrawLabel');
    if (startLbl) {
      startLbl.textContent =
        (sum.randomAllocations || 0) > 0 ? 'REVEAL NEXT ALLOCATION' : 'START DRAW';
    }

    const pauseBtn = document.getElementById('btnPauseResume');
    if (pauseBtn) {
      pauseBtn.innerHTML = showState.isPaused
        ? '<i class="fa-solid fa-play me-1"></i><span>Resume Presentation</span>'
        : '<i class="fa-solid fa-pause me-1"></i><span>Pause Presentation</span>';
    }
  }

  function syncControlButtonsState() {
    const startBtn = document.getElementById('btnStartOrNextDraw');
    const replayBtn = document.getElementById('btnReplayAnimation');
    const prevBtn = document.getElementById('btnPrevAllocation');
    const nextHistBtn = document.getElementById('btnNextHistoryAllocation');
    const endBtn = document.getElementById('btnEndLottery');

    const evStatus = showState.event?.status || 'DRAFT';
    const busy = showState.isAnimating || showState.drawRequestInFlight;

    if (startBtn) {
      startBtn.disabled = busy || evStatus === 'FINALIZED';
    }
    if (replayBtn) {
      replayBtn.disabled = busy || !showState.currentTicket;
    }
    if (prevBtn) {
      prevBtn.disabled =
        busy ||
        showState.allocationsHistory.length === 0 ||
        showState.viewingIndex >= showState.allocationsHistory.length - 1;
    }
    if (nextHistBtn) {
      nextHistBtn.classList.toggle('d-none', showState.viewingIndex === 0);
      nextHistBtn.disabled = busy;
    }
    if (endBtn) {
      endBtn.disabled = busy || evStatus === 'FINALIZED';
    }
  }

  function syncAudioControlsUi() {
    const soundBtn = document.getElementById('btnToggleSound');
    const mSlider = document.getElementById('musicVolSlider');
    const sSlider = document.getElementById('sfxVolSlider');

    const muted = RPShowAudio.isMuted();
    if (soundBtn) {
      soundBtn.innerHTML = muted
        ? '<i class="fa-solid fa-volume-xmark text-danger me-1"></i><span>Sound OFF</span>'
        : '<i class="fa-solid fa-volume-high text-warning me-1"></i><span>Sound ON</span>';
    }
    if (mSlider) mSlider.value = String(RPShowAudio.getMusicVolume());
    if (sSlider) sSlider.value = String(RPShowAudio.getSfxVolume());
  }

  /**
   * Prompts Admin with Pre-Lottery Allocation Summary before starting if event is DRAFT/READY.
   */
  async function confirmAndStartLotteryIfNeeded() {
    const st = showState.event?.status || 'DRAFT';
    if (st === 'LIVE') return true;
    if (st === 'PAUSED') {
      Swal.fire({
        icon: 'info',
        title: 'Presentation Paused',
        text: 'Click "Resume Presentation" to continue drawing allocations.',
        background: '#09142e',
        color: '#fffdf8'
      });
      return false;
    }

    const pre = await RPLottery.apiFetch('/precheck');
    const s = pre.summary;

    if (!pre.canStart) {
      await Swal.fire({
        icon: 'error',
        title: 'Cannot Start Lottery Yet',
        html: pre.blockers.map((b) => `<div>${RPLottery.escapeHtml(b)}</div>`).join(''),
        background: '#09142e',
        color: '#fffdf8'
      });
      return false;
    }

    const warningBanner = s.mismatchWarning
      ? `<div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(245,158,11,0.18);border:1px solid #fbbf24;color:#fde68a;font-size:0.85rem;text-align:left;">
           <i class="fa-solid fa-triangle-exclamation me-1"></i>${RPLottery.escapeHtml(s.mismatchWarning)}
         </div>`
      : '';

    const confirmRes = await Swal.fire({
      title: 'Confirm Pre-Lottery Allocation Summary',
      html: `
        <div style="text-align:left;font-size:0.92rem;line-height:1.75;">
          <div>Total Registered Participants: <strong>${s.totalParticipants}</strong></div>
          <div>Total Registered Flats: <strong>${s.totalFlats}</strong></div>
          <div>Preserved Fixed Allocations: <strong style="color:#f3dc9f;">${s.fixedAllocations}</strong></div>
          <hr style="border-color:rgba(207,166,82,0.3);margin:8px 0;"/>
          <div>Eligible Random Participants Pool: <strong style="color:#6ee7b7;">${s.remainingParticipants}</strong></div>
          <div>Available Random Flats Pool: <strong style="color:#6ee7b7;">${s.remainingFlats}</strong></div>
        </div>
        ${warningBanner}
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirm & Start Live Lottery',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#cfa652',
      background: '#09142e',
      color: '#fffdf8'
    });

    if (!confirmRes.isConfirmed) return false;

    await RPLottery.apiFetch('/start', {
      method: 'POST',
      body: {
        confirmed: true,
        acknowledgeMismatch: true
      }
    });

    await refreshOverviewAndHistory();
    RPLottery.broadcastEvent('EVENT_UPDATED');
    return true;
  }

  /**
   * Executes a REAL server-side draw and runs the 6-Stage Broadcast Reveal!
   */
  async function handleStartOrNextDraw() {
    if (showState.isAnimating || showState.drawRequestInFlight) return;
    RPShowAudio.unlock();

    let ready = false;
    try {
      ready = await confirmAndStartLotteryIfNeeded();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Connection / Lottery Notice',
        text: err.message,
        background: '#09142e',
        color: '#fffdf8'
      });
      return;
    }
    if (!ready) return;

    showState.drawRequestInFlight = true;
    syncControlButtonsState();

    const idempotencyKey = RPLottery.generateIdempotencyKey('live-draw');
    let drawData;

    try {
      drawData = await RPLottery.apiFetch('/draw-one', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: { idempotencyKey }
      });
    } catch (err) {
      showState.drawRequestInFlight = false;
      syncControlButtonsState();
      Swal.fire({
        icon: err.code === 'POOL_EXHAUSTED' ? 'info' : 'error',
        title: err.code === 'POOL_EXHAUSTED' ? 'Allocation Pool Complete' : 'Draw Notice',
        text: err.message,
        background: '#09142e',
        color: '#fffdf8'
      });
      await refreshOverviewAndHistory();
      return;
    }

    showState.drawRequestInFlight = false;
    const officialTicket = drawData.allocation;
    showState.currentTicket = officialTicket;
    showState.lastDrumCandidates = drawData.drumCandidates;
    showState.summary = drawData.summary || showState.summary;

    // Prepend to local history list if not already at index 0
    if (
      !showState.allocationsHistory.length ||
      showState.allocationsHistory[0].allocationId !== officialTicket.allocationId
    ) {
      showState.allocationsHistory.unshift(officialTicket);
    }
    showState.viewingIndex = 0;

    RPLottery.broadcastEvent('ALLOCATION_DRAWN', { allocation: officialTicket });

    await runDramaticBroadcastSequence(officialTicket, drawData.drumCandidates);
    await refreshOverviewAndHistory();
  }

  /**
   * 6-Stage Television Game-Show Reveal Sequence!
   * Used both for Live Draws AND for Replay Animation (Replay NEVER calls /draw-one!).
   */
  async function runDramaticBroadcastSequence(ticket, candidates = null) {
    if (!ticket) return;
    showState.isAnimating = true;
    syncControlButtonsState();

    const viewport = document.getElementById('stageDynamicViewport');
    const cfg = showState.event?.config || {};
    const countdownSec = Math.min(10, Math.max(1, cfg.countdownSeconds || 3));
    const nameDurMs = Math.max(1200, cfg.nameRevealDurationMs || 2800);
    const flatDurMs = Math.max(1200, cfg.flatRevealDurationMs || 2400);

    // Stage 1: Dramatic Countdown 3... 2... 1...
    for (let c = countdownSec; c >= 1; c--) {
      viewport.innerHTML = `
        <div class="d-flex flex-column align-items-center justify-content-center py-3">
          <div class="chamber-step-label mb-3">PREPARING OFFICIAL RANDOM DRAW</div>
          <div class="countdown-ring">
            <span class="countdown-digit">${c}</span>
          </div>
        </div>
      `;
      RPShowAudio.playCountdownStrike(c);
      await sleepPausable(860);
    }

    // Stage 2: Start Suspenseful Background Music
    RPShowAudio.startSuspenseMusic();

    viewport.innerHTML = `
      <div class="reveal-sequence-grid mx-auto">
        <div class="reveal-chamber chamber-active" id="participantChamber">
          <div class="chamber-step-label">SELECTING ELIGIBLE PARTICIPANT</div>
          <div class="chamber-rolling-name" id="rollingParticipantName">—</div>
          <div class="chamber-rolling-sub" id="rollingParticipantId">Scanning MongoDB Eligible Pool...</div>
        </div>

        <div class="reveal-chamber" id="flatChamber">
          <div class="chamber-step-label">ALLOCATING AVAILABLE FLAT NUMBER</div>
          <div class="chamber-flat-number" id="rollingFlatNumber">• • •</div>
          <div class="chamber-rolling-sub" id="rollingFlatMeta">Awaiting Participant Lock...</div>
        </div>
      </div>
    `;

    const pNameEl = document.getElementById('rollingParticipantName');
    const pIdEl = document.getElementById('rollingParticipantId');
    const pChamber = document.getElementById('participantChamber');
    const fNoEl = document.getElementById('rollingFlatNumber');
    const fMetaEl = document.getElementById('rollingFlatMeta');
    const fChamber = document.getElementById('flatChamber');

    // Stage 3: Animate Participant Name Selection
    const poolNames =
      candidates?.participants?.length > 1
        ? candidates.participants
        : [
            { name: ticket.participantName, id: ticket.participantId },
            { name: 'Selecting Registered Member...', id: 'ROYAL PALMS POOL' }
          ];

    const nameSteps = 22;
    for (let i = 0; i < nameSteps; i++) {
      const progress = i / nameSteps;
      const sample = poolNames[i % poolNames.length];
      if (pNameEl) pNameEl.textContent = sample.name;
      if (pIdEl) pIdEl.textContent = `Participant ID: ${sample.id}`;
      RPShowAudio.playSelectionTick(progress);
      const stepDelay = Math.round(55 + Math.pow(progress, 2.1) * ((nameDurMs / nameSteps) * 1.9));
      await sleepPausable(stepDelay);
    }

    // Stage 4: Reveal the Actual Selected Participant!
    if (pNameEl) pNameEl.textContent = ticket.participantName.toUpperCase();
    if (pIdEl) {
      pIdEl.innerHTML = `Participant ID: <strong class="text-warning">${RPLottery.escapeHtml(ticket.participantId)}</strong> • SELECTED`;
    }
    if (pChamber) {
      pChamber.classList.remove('chamber-active');
      pChamber.classList.add('chamber-locked');
    }
    RPShowAudio.playParticipantSpotlight();
    await sleepPausable(850);

    // Stage 5: Animate the Flat Number Reveal with Rising Sound!
    if (fChamber) fChamber.classList.add('chamber-active');
    RPShowAudio.startFlatRevealRiser(flatDurMs);

    const poolFlats =
      candidates?.flats?.length > 1
        ? candidates.flats
        : [
            { flatNumber: ticket.flatNumber, wing: ticket.wing || '', floor: ticket.floor || '' },
            { flatNumber: '---', wing: 'Royal Palms', floor: '' }
          ];

    const flatSteps = 20;
    for (let j = 0; j < flatSteps; j++) {
      const progress = j / flatSteps;
      const fSample = poolFlats[j % poolFlats.length];
      if (fNoEl) fNoEl.textContent = fSample.flatNumber;
      if (fMetaEl) {
        fMetaEl.textContent =
          [fSample.wing, fSample.floor ? `Floor ${fSample.floor}` : ''].filter(Boolean).join(' • ') ||
          'Scanning Available Flat Inventory...';
      }
      RPShowAudio.playSelectionTick(0.3 + progress * 0.7);
      const stepDelay = Math.round(55 + Math.pow(progress, 2.2) * ((flatDurMs / flatSteps) * 1.85));
      await sleepPausable(stepDelay);
    }

    if (fNoEl) fNoEl.textContent = `FLAT ${ticket.flatNumber}`;
    if (fMetaEl) {
      fMetaEl.textContent =
        [ticket.wing, ticket.floor ? `Floor ${ticket.floor}` : '', ticket.building]
          .filter(Boolean)
          .join(' • ') || 'OFFICIALLY LOCKED';
    }
    if (fChamber) {
      fChamber.classList.remove('chamber-active');
      fChamber.classList.add('chamber-locked');
    }
    await sleepPausable(650);

    // Stage 6: Grand Winning Ticket Reveal + Gold Confetti + Celebration Fanfare!
    renderTicketOnStage(ticket);
    RPShowAudio.playCelebrationFanfare();

    if (showState.event?.config?.confettiEnabled !== false) {
      launchRoyalGoldConfetti();
    }

    showState.isAnimating = false;
    renderTopHud();
    syncControlButtonsState();
  }

  function renderTicketOnStage(ticket) {
    const viewport = document.getElementById('stageDynamicViewport');
    if (!viewport || !ticket) return;

    viewport.innerHTML = `
      <div class="ticket-reveal-stage">
        ${RPLottery.renderLuxuryTicketHtml(ticket, showState.event || {})}
      </div>
    `;

    RPLottery.bindTicketActionButtons(
      viewport,
      async () => ticket,
      showState.event || {}
    );
  }

  function launchRoyalGoldConfetti() {
    if (typeof confetti !== 'function') return;
    const colors = ['#ffd700', '#ff3b5c', '#f6e2ae', '#cfa652', '#10b981', '#ff9f1c', '#fffdf8', '#38bdf8'];

    // 1. Center Star & Firecracker Explosion
    confetti({
      particleCount: 120,
      spread: 115,
      startVelocity: 45,
      shapes: ['star', 'circle'],
      scalar: 1.2,
      origin: { y: 0.54 },
      colors
    });

    // 2. Timed 360-Degree Aerial Firecracker Shell Bursts (synced with audio booms)
    const shells = [
      { x: 0.2, y: 0.32, delay: 220 },
      { x: 0.8, y: 0.32, delay: 480 },
      { x: 0.35, y: 0.24, delay: 860 },
      { x: 0.65, y: 0.24, delay: 1120 },
      { x: 0.25, y: 0.38, delay: 1480 },
      { x: 0.75, y: 0.38, delay: 1750 }
    ];

    shells.forEach((sh) => {
      setTimeout(() => {
        confetti({
          particleCount: 70,
          spread: 360,
          ticks: 80,
          gravity: 0.82,
          decay: 0.92,
          startVelocity: 30,
          shapes: ['star', 'circle'],
          scalar: 1.15,
          origin: { x: sh.x, y: sh.y },
          colors
        });
      }, sh.delay);
    });

    // 3. Continuous Side Gold & Festive Streamers
    const end = Date.now() + 2500;
    const burst = () => {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 54,
        origin: { x: 0, y: 0.74 },
        colors
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 54,
        origin: { x: 1, y: 0.74 },
        colors
      });
      if (Date.now() < end) requestAnimationFrame(burst);
    };
    requestAnimationFrame(burst);
  }

  function bindShowControls() {
    const startBtn = document.getElementById('btnStartOrNextDraw');
    const pauseBtn = document.getElementById('btnPauseResume');
    const replayBtn = document.getElementById('btnReplayAnimation');
    const prevBtn = document.getElementById('btnPrevAllocation');
    const nextHistBtn = document.getElementById('btnNextHistoryAllocation');
    const soundBtn = document.getElementById('btnToggleSound');
    const mSlider = document.getElementById('musicVolSlider');
    const sSlider = document.getElementById('sfxVolSlider');
    const fsBtn = document.getElementById('btnFullScreen');
    const demoResetBtn = document.getElementById('btnDemoReset');
    const endBtn = document.getElementById('btnEndLottery');

    if (startBtn) {
      startBtn.addEventListener('click', handleStartOrNextDraw);
    }

    // Pause / Resume Presentation
    if (pauseBtn) {
      pauseBtn.addEventListener('click', async () => {
        RPShowAudio.unlock();

        try {
          if (!showState.isPaused) {
            showState.isPaused = true;
            RPShowAudio.stopSuspenseMusic();
            if (showState.event?.status === 'LIVE') {
              const r = await RPLottery.apiFetch('/pause', { method: 'POST' });
              showState.event = r.event;
            }
          } else {
            showState.isPaused = false;
            releasePauseResolvers();
            if (showState.event?.status === 'PAUSED') {
              const r = await RPLottery.apiFetch('/resume', { method: 'POST' });
              showState.event = r.event;
            }
          }
          renderTopHud();
          RPLottery.broadcastEvent('EVENT_UPDATED');
        } catch (err) {
          RPLottery.toast('error', err.message);
        }
      });
    }

    // Replay Animation — NEVER creates a new allocation!
    if (replayBtn) {
      replayBtn.addEventListener('click', async () => {
        if (showState.isAnimating || !showState.currentTicket) return;
        RPShowAudio.unlock();
        await runDramaticBroadcastSequence(
          showState.currentTicket,
          showState.lastDrumCandidates
        );
      });
    }

    // View Previous Allocation
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (showState.isAnimating) return;
        if (showState.viewingIndex < showState.allocationsHistory.length - 1) {
          showState.viewingIndex += 1;
          showState.currentTicket = showState.allocationsHistory[showState.viewingIndex];
          renderTicketOnStage(showState.currentTicket);
          syncControlButtonsState();
        }
      });
    }

    // Return to Latest Allocation
    if (nextHistBtn) {
      nextHistBtn.addEventListener('click', () => {
        if (showState.isAnimating) return;
        showState.viewingIndex = 0;
        showState.currentTicket = showState.allocationsHistory[0] || null;
        if (showState.currentTicket) {
          renderTicketOnStage(showState.currentTicket);
        }
        syncControlButtonsState();
      });
    }

    // Sound ON / OFF
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        RPShowAudio.unlock();
        RPShowAudio.setMuted(!RPShowAudio.isMuted());
        syncAudioControlsUi();
      });
    }

    if (mSlider) {
      mSlider.addEventListener('input', () => {
        RPShowAudio.setMusicVolume(parseFloat(mSlider.value));
      });
    }

    if (sSlider) {
      sSlider.addEventListener('input', () => {
        RPShowAudio.setSfxVolume(parseFloat(sSlider.value));
      });
    }

    // Full Screen Projector Mode
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    document.addEventListener('fullscreenchange', () => {
      if (fsBtn) {
        fsBtn.innerHTML = document.fullscreenElement
          ? '<i class="fa-solid fa-compress me-1"></i><span>Exit Full Screen</span>'
          : '<i class="fa-solid fa-expand me-1"></i><span>Full Screen</span>';
      }
    });

    // Repeatable Demo Reset / Load Dummy Data (Demonstrate N Times)
    if (demoResetBtn) {
      demoResetBtn.addEventListener('click', async () => {
        if (showState.isAnimating || showState.drawRequestInFlight) return;
        const res = await Swal.fire({
          title: 'Reset / Reload Demo (Repeat N Times)',
          html: `
            <div class="text-start small">
              <label class="form-label fw-bold text-warning mb-1">Choose Demo Reset Option</label>
              <select id="liveDemoModeSelect" class="form-select form-select-sm mb-2">
                <option value="reset-draws" selected>1. Reset Random Draws Only (Keep Current Participants, Flats &amp; Fixed Mappings)</option>
                <option value="load-25">2. Reload Quick Demo Dataset (25 Participants, 25 Flats, 3 Fixed + 22 Random)</option>
                <option value="load-60">3. Reload Medium Demo Dataset (60 Participants, 60 Flats, 3 Fixed + 57 Random)</option>
                <option value="load-520">4. Reload Full 520+ Demo Dataset (520 Participants, 520 Flats, 3 Fixed + 517 Random)</option>
              </select>
              <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="liveDemoAutoLive" checked />
                <label class="form-check-label text-light" for="liveDemoAutoLive">
                  Keep Event Status <strong>LIVE</strong> (ready for immediate START DRAW)
                </label>
              </div>
            </div>
          `,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Reset Demo Now',
          confirmButtonColor: '#cfa652',
          background: '#09142e',
          color: '#fffdf8',
          preConfirm: () => ({
            mode: document.getElementById('liveDemoModeSelect')?.value || 'reset-draws',
            autoStartLive: Boolean(document.getElementById('liveDemoAutoLive')?.checked)
          })
        });

        if (!res.isConfirmed || !res.value) return;

        try {
          const { mode, autoStartLive } = res.value;
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
              body: { count, includeFixed: true, autoStartLive }
            });
          }

          showState.currentTicket = null;
          showState.viewingIndex = 0;
          showState.allocationsHistory = [];
          const viewport = document.getElementById('stageDynamicViewport');
          if (viewport) {
            viewport.innerHTML = `
              <img src="assets/images/logo.svg" alt="Royal Palms" class="stage-welcome-crest" />
              <div class="stage-hero-royal">ROYAL PALMS</div>
              <h2 class="stage-hero-grand">GRAND FLAT ALLOCATION</h2>
              <p class="stage-hero-sub">
                Demo reset complete! Click <strong>START DRAW</strong> below to begin the live countdown and reveal.
              </p>
            `;
          }
          await refreshOverviewAndHistory();
          RPLottery.broadcastEvent('EVENT_UPDATED');
          RPLottery.toast('success', out.message);
        } catch (err) {
          RPLottery.toast('error', err.message);
        }
      });
    }

    // End Lottery Event
    if (endBtn) {
      endBtn.addEventListener('click', async () => {
        const res = await Swal.fire({
          title: 'End or Finalize Live Lottery?',
          html: `
            <p class="small text-light">Choose whether to end the live stage session or permanently finalize &amp; lock all allocations.</p>
            <div class="form-check text-start mt-2">
              <input class="form-check-input" type="checkbox" id="swalFinalizeCheck" />
              <label class="form-check-label small" for="swalFinalizeCheck">
                Permanently <strong>Finalize &amp; Lock</strong> Lottery Event (prevents further draws)
              </label>
            </div>
          `,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Confirm End Lottery',
          confirmButtonColor: '#dc2626',
          background: '#09142e',
          color: '#fffdf8',
          preConfirm: () => ({
            finalize: Boolean(document.getElementById('swalFinalizeCheck')?.checked)
          })
        });

        if (!res.isConfirmed) return;

        try {
          const out = await RPLottery.apiFetch('/end', {
            method: 'POST',
            body: {
              confirmed: true,
              finalize: Boolean(res.value?.finalize)
            }
          });
          showState.event = out.event;
          showState.summary = out.summary;
          RPShowAudio.stopSuspenseMusic();
          renderTopHud();
          syncControlButtonsState();
          RPLottery.broadcastEvent('EVENT_UPDATED');
          RPLottery.toast('success', out.message);
        } catch (err) {
          RPLottery.toast('error', err.message);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initLiveShow);
})();
