/* =========================================================================
   ROYAL PALMS PLAY & WIN - 3-REEL LUCKY DRAW ENGINE (game.js)
   Smooth Desktop & Mobile Spinning Animation + Verified Backend Draw
   ========================================================================= */

(function () {
  const SYMBOL_KEYS = [
    'STAR',
    'GIFT',
    'TROPHY',
    'CROWN',
    'DIAMOND',
    'CLOVER',
    'BELL',
    'MEDAL'
  ];

  const gameState = {
    isSpinning: false,
    settings: {
      NoRepeatWinner: true,
      SoundEnabled: true,
      ConfettiEnabled: true,
      SpinDurationMs: 3200,
      MatchRatePercent: 35,
      EventTitle: 'Royal Palms Lucky Draw',
      PrizeTitle: 'Official Society Play & Win Winner'
    },
    counts: {
      eligibleFlatsCount: 0,
      totalParticipatingCount: 0,
      totalRegisteredCount: 0,
      totalWinnersCount: 0,
      totalSpinsCount: 0
    },
    selectedSocietyId: '',
    currentSymbols: ['STAR', 'GIFT', 'TROPHY'],
    lastOfficialWinner: null
  };

  let winnerModalInstance = null;
  let detailsModalInstance = null;

  function randomVisualIndex(max) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] % max;
  }

  function renderSymbolCellHtml(symbolKey, isFinalActive = false) {
    const meta = SPW.getSymbolMeta(symbolKey);
    return `
      <div class="reel-cell ${isFinalActive ? 'reel-cell-active' : ''}">
        <div class="symbol-emblem sym-${SPW.escapeHtml(symbolKey)}">${SPW.escapeHtml(meta.icon)}</div>
        <div class="symbol-caption">${SPW.escapeHtml(meta.label)}</div>
      </div>
    `;
  }

  function setInitialReels(symbols) {
    [0, 1, 2].forEach((idx) => {
      const strip = document.getElementById(`reelStrip${idx + 1}`);
      const drum = document.getElementById(`reelDrum${idx + 1}`);
      if (!strip || !drum) return;
      drum.classList.remove('reel-locked-match', 'reel-suspense');
      strip.style.transition = 'none';
      strip.style.transform = 'translate3d(0, 0, 0)';
      strip.innerHTML = renderSymbolCellHtml(symbols[idx], true);
    });
  }

  async function initGamePage() {
    const winModalEl = document.getElementById('jackpotWinnerModal');
    if (winModalEl && typeof bootstrap !== 'undefined') {
      winnerModalInstance = new bootstrap.Modal(winModalEl);
    }

    const detModalEl = document.getElementById('winnerDetailModal');
    if (detModalEl && typeof bootstrap !== 'undefined') {
      detailsModalInstance = new bootstrap.Modal(detModalEl);
    }

    setInitialReels(gameState.currentSymbols);
    bindGameControls();
    syncMuteButtonUi();

    const params = new URLSearchParams(window.location.search);
    const shouldAutoSpin = params.get('autospin') === '1';
    if (shouldAutoSpin && window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loaded = await loadServerGameState();

    // When arriving from the PLAY & WIN button on the landing page, start spinning smoothly!
    if (shouldAutoSpin && loaded && (gameState.counts.eligibleFlatsCount || 0) > 0) {
      setTimeout(() => {
        startSlotSpin({ silentOnError: true });
      }, 320);
    }
  }

  async function loadServerGameState() {
    try {
      const query = gameState.selectedSocietyId
        ? `?societyId=${encodeURIComponent(gameState.selectedSocietyId)}`
        : '';
      const data = await SPW.apiFetch(`/game/state${query}`);

      if (data.settings) {
        gameState.settings = data.settings;
      }
      if (data.counts) {
        gameState.counts = data.counts;
      }

      const socSelect = document.getElementById('gameSocietyFilter');
      if (socSelect && Array.isArray(data.societies)) {
        const prev = gameState.selectedSocietyId;
        socSelect.innerHTML =
          '<option value="">All Societies</option>' +
          data.societies
            .map(
              (s) =>
                `<option value="${s.SocietyID}" ${String(s.SocietyID) === String(prev) ? 'selected' : ''}>${SPW.escapeHtml(s.SocietyName)}</option>`
            )
            .join('');
      }

      updateCabinetHud(data.society, data.settings, data.counts);
      syncMuteButtonUi();
      return true;
    } catch (err) {
      updateStatusBanner(
        `<span>${SPW.escapeHtml(err.message)}</span>`,
        'try-again'
      );
      return false;
    }
  }

  function updateCabinetHud(society, settings, counts) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('hudEligibleFlats', (counts?.eligibleFlatsCount || 0).toLocaleString());
    setTxt('hudTotalSpins', (counts?.totalSpinsCount || 0).toLocaleString());
    setTxt('hudTotalWinners', (counts?.totalWinnersCount || 0).toLocaleString());
    setTxt(
      'hudDrawMode',
      settings?.NoRepeatWinner ? 'No-Repeat Winner' : 'Repeat Allowed'
    );

    if (society) {
      setTxt('cabinetSocietyName', society.SocietyName);
    }
  }

  function updateStatusBanner(htmlMsg, variant = 'default') {
    const banner = document.getElementById('slotStatusBanner');
    if (!banner) return;
    banner.classList.remove('status-try-again', 'status-jackpot');
    if (variant === 'try-again') banner.classList.add('status-try-again');
    if (variant === 'jackpot') banner.classList.add('status-jackpot');
    banner.innerHTML = htmlMsg;
  }

  function syncMuteButtonUi() {
    const muteBtn = document.getElementById('toggleMuteBtn');
    if (!muteBtn) return;
    const muted = SPW.sound.isMuted();
    muteBtn.innerHTML = muted
      ? '<i class="fa-solid fa-volume-xmark text-danger me-1"></i><span>Muted</span>'
      : '<i class="fa-solid fa-volume-high text-neon-blue me-1"></i><span>Sound On</span>';
  }

  function bindGameControls() {
    const spinBtn = document.getElementById('spinNowBtn');
    const muteBtn = document.getElementById('toggleMuteBtn');
    const fsBtn = document.getElementById('toggleFullscreenBtn');
    const socSelect = document.getElementById('gameSocietyFilter');

    if (spinBtn) {
      spinBtn.addEventListener('click', () => startSlotSpin());
    }

    document.addEventListener('keydown', (e) => {
      if (
        e.code === 'Space' &&
        !gameState.isSpinning &&
        !document.querySelector('.modal.show') &&
        !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault();
        startSlotSpin();
      }
    });

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const nextMuted = !SPW.sound.isMuted();
        SPW.sound.setMuted(nextMuted);
        syncMuteButtonUi();
        if (!nextMuted) SPW.sound.play('click');
      });
    }

    if (fsBtn) {
      fsBtn.addEventListener('click', toggleFullScreenMode);
    }

    document.addEventListener('fullscreenchange', () => {
      const isFs = Boolean(document.fullscreenElement);
      document.body.classList.toggle('tv-fullscreen-active', isFs);
      if (fsBtn) {
        fsBtn.innerHTML = isFs
          ? '<i class="fa-solid fa-compress me-1"></i><span>Exit Full Screen</span>'
          : '<i class="fa-solid fa-expand me-1"></i><span>Full Screen</span>';
      }
      if (!gameState.isSpinning) {
        setInitialReels(gameState.currentSymbols);
      }
    });

    window.addEventListener('resize', () => {
      if (!gameState.isSpinning) {
        setInitialReels(gameState.currentSymbols);
      }
    });

    if (socSelect) {
      socSelect.addEventListener('change', () => {
        gameState.selectedSocietyId = socSelect.value;
        loadServerGameState();
      });
    }

    const playAgainBtn = document.getElementById('winnerPlayAgainBtn');
    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', () => {
        SPW.sound.play('click');
        if (winnerModalInstance) winnerModalInstance.hide();
      });
    }

    const viewDetailsBtn = document.getElementById('winnerViewDetailsBtn');
    if (viewDetailsBtn) {
      viewDetailsBtn.addEventListener('click', () => {
        if (!gameState.lastOfficialWinner) return;
        if (winnerModalInstance) winnerModalInstance.hide();
        openWinnerDetailsModal(gameState.lastOfficialWinner);
      });
    }

    const printCertBtn = document.getElementById('winnerPrintCertBtn');
    if (printCertBtn) {
      printCertBtn.addEventListener('click', () => {
        if (gameState.lastOfficialWinner) {
          SPW.printWinnerCertificate(gameState.lastOfficialWinner);
        }
      });
    }

    const detailPrintBtn = document.getElementById('detailModalPrintCertBtn');
    if (detailPrintBtn) {
      detailPrintBtn.addEventListener('click', () => {
        if (gameState.lastOfficialWinner) {
          SPW.printWinnerCertificate(gameState.lastOfficialWinner);
        }
      });
    }
  }

  function toggleFullScreenMode() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        document.body.classList.toggle('tv-fullscreen-active');
      });
    } else {
      document.exitFullscreen().catch(() => {
        document.body.classList.remove('tv-fullscreen-active');
      });
    }
  }

  /**
   * Hardware-accelerated smooth reel spin to targetSymbol.
   */
  function animateReelToSymbol(reelIndex, startSymbol, targetSymbol, durationMs) {
    return new Promise((resolve) => {
      const drum = document.getElementById(`reelDrum${reelIndex + 1}`);
      const strip = document.getElementById(`reelStrip${reelIndex + 1}`);
      if (!drum || !strip) return resolve();

      const cellHeight = drum.clientHeight || 256;
      const totalSteps = 20 + reelIndex * 6;

      const sequence = [startSymbol];
      for (let i = 1; i < totalSteps - 1; i++) {
        sequence.push(SYMBOL_KEYS[(i + randomVisualIndex(SYMBOL_KEYS.length)) % SYMBOL_KEYS.length]);
      }
      sequence.push(targetSymbol);

      strip.style.transition = 'none';
      strip.style.transform = 'translate3d(0, 0, 0)';
      strip.innerHTML = sequence
        .map((sym, idx) => renderSymbolCellHtml(sym, idx === sequence.length - 1))
        .join('');

      void strip.offsetHeight;

      strip.classList.add('spinning-blur');
      const finalOffset = -((sequence.length - 1) * cellHeight);
      strip.style.transition = `transform ${durationMs}ms cubic-bezier(0.15, 0.86, 0.24, 1.02)`;
      strip.style.transform = `translate3d(0, ${finalOffset}px, 0)`;

      setTimeout(() => {
        strip.classList.remove('spinning-blur');
      }, Math.max(200, durationMs - 340));

      setTimeout(() => {
        SPW.sound.play('stop', { volume: 0.65 });
        resolve();
      }, durationMs + 30);
    });
  }

  /**
   * Runs a live, backend-verified lucky draw spin.
   */
  async function startSlotSpin(options = {}) {
    if (gameState.isSpinning) return;

    gameState.isSpinning = true;
    const cabinet = document.getElementById('slotCabinet');
    const spinBtn = document.getElementById('spinNowBtn');

    if (spinBtn) {
      spinBtn.disabled = true;
      spinBtn.classList.add('pressed');
      setTimeout(() => spinBtn.classList.remove('pressed'), 200);
    }

    [1, 2, 3].forEach((n) => {
      const d = document.getElementById(`reelDrum${n}`);
      if (d) d.classList.remove('reel-locked-match', 'reel-suspense');
    });

    if (cabinet) {
      cabinet.classList.remove('cabinet-winning');
    }

    let spinResult;
    try {
      spinResult = await SPW.apiFetch('/game/spin', {
        method: 'POST',
        body: {
          societyId: gameState.selectedSocietyId || undefined
        }
      });
    } catch (err) {
      gameState.isSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
      updateStatusBanner(`<span>${SPW.escapeHtml(err.message)}</span>`, 'try-again');
      if (!options.silentOnError) {
        SPW.alertModal({
          icon: 'info',
          title: 'Notice',
          text: err.message
        });
      }
      return;
    }

    if (cabinet) {
      cabinet.classList.add('cabinet-spinning');
    }

    updateStatusBanner('<span>Spinning reels...</span>');

    if (gameState.settings.SoundEnabled !== false) {
      SPW.sound.play('spin', { loop: true, volume: 0.45 });
    }

    const prevSymbols = [...gameState.currentSymbols];
    const outcome = spinResult.reels;
    const baseMs = Math.max(1800, parseInt(gameState.settings.SpinDurationMs, 10) || 3000);

    const d1 = Math.round(baseMs * 0.6);
    const d2 = Math.round(baseMs * 0.82);
    const d3 = Math.round(baseMs * 1.05);

    const p1 = animateReelToSymbol(0, prevSymbols[0], outcome[0], d1);
    const p2 = animateReelToSymbol(1, prevSymbols[1], outcome[1], d2).then(() => {
      if (outcome[0] === outcome[1]) {
        const drum3 = document.getElementById('reelDrum3');
        if (drum3) drum3.classList.add('reel-suspense');
        updateStatusBanner(
          '<span>First 2 reels matched — watching Reel 3...</span>'
        );
      }
    });
    const p3 = animateReelToSymbol(2, prevSymbols[2], outcome[2], d3);

    await Promise.all([p1, p2, p3]);

    SPW.sound.stop('spin');
    gameState.currentSymbols = outcome;
    setInitialReels(outcome);

    if (cabinet) cabinet.classList.remove('cabinet-spinning');

    if (!spinResult.isWin) {
      if (gameState.settings.SoundEnabled !== false) {
        SPW.sound.play('tryAgain', { volume: 0.5 });
      }
      const m1 = SPW.getSymbolMeta(outcome[0]);
      const m2 = SPW.getSymbolMeta(outcome[1]);
      const m3 = SPW.getSymbolMeta(outcome[2]);

      updateStatusBanner(
        `<span>Result: <strong>${m1.emoji} ${SPW.escapeHtml(m1.label)} • ${m2.emoji} ${SPW.escapeHtml(m2.label)} • ${m3.emoji} ${SPW.escapeHtml(m3.label)}</strong> — No match this round. Click <strong>SPIN</strong> to play again.</span>`,
        'try-again'
      );

      await loadServerGameState();
      gameState.isSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
      return;
    }

    // 3 Matching Symbols -> Official Registered Society Winner!
    [1, 2, 3].forEach((n) => {
      const d = document.getElementById(`reelDrum${n}`);
      if (d) d.classList.add('reel-locked-match');
    });
    if (cabinet) cabinet.classList.add('cabinet-winning');

    const winner = spinResult.winner;
    gameState.lastOfficialWinner = winner;

    if (gameState.settings.SoundEnabled !== false) {
      SPW.sound.play('jackpot', { volume: 0.8 });
    }

    if (gameState.settings.ConfettiEnabled !== false) {
      launchCelebrationConfetti();
    }

    updateStatusBanner(
      `<i class="fa-solid fa-trophy"></i><span>Congratulations! Lucky Flat Winner: <strong>${SPW.escapeHtml(winner.OwnerName)}</strong> — Flat <strong>${SPW.escapeHtml(winner.FlatNumber)}</strong></span>`,
      'jackpot'
    );

    populateAndShowWinnerModal(winner);
    await loadServerGameState();

    gameState.isSpinning = false;
    if (spinBtn) spinBtn.disabled = false;
  }

  function populateAndShowWinnerModal(winner) {
    const sym = SPW.getSymbolMeta(winner.MatchedSymbol);
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('winModalOwnerName', winner.OwnerName);
    setTxt('winModalFlatNumber', winner.FlatNumber);
    setTxt('winModalSocietyName', winner.SocietyName);
    setTxt('winModalDrawDateTime', SPW.formatDateTime(winner.DrawDateTime));
    setTxt('winModalPrizeTitle', winner.PrizeTitle || 'Official Society Play & Win Winner');
    setTxt(
      'winModalCertBadge',
      `${sym.emoji} ${sym.label} • ${winner.SessionCode || 'SPW-' + String(winner.GameID).padStart(6, '0')}`
    );

    if (winnerModalInstance) {
      winnerModalInstance.show();
    }
  }

  function openWinnerDetailsModal(winner) {
    const sym = SPW.getSymbolMeta(winner.MatchedSymbol);
    const body = document.getElementById('winnerDetailModalBody');
    if (!body) return;

    const gameCode = winner.SessionCode || `SPW-${String(winner.GameID).padStart(6, '0')}`;
    const certCode = winner.CertificateNo || `CERT-${String(winner.WinnerID).padStart(6, '0')}`;

    body.innerHTML = `
      <div class="winner-spotlight-card my-0">
        <div class="winner-field-row">
          <span class="text-muted-light">Winner Owner Name</span>
          <span class="fw-bold fs-5 text-gold">${SPW.escapeHtml(winner.OwnerName)}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Flat Number</span>
          <span class="fw-bold text-neon-blue">${SPW.escapeHtml(winner.FlatNumber)}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Society Name</span>
          <span class="fw-semibold">${SPW.escapeHtml(winner.SocietyName)}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Mobile Number</span>
          <span>${SPW.escapeHtml(winner.MobileNumber || 'Not Provided')}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Game Session ID</span>
          <span class="badge-winner-crown">${SPW.escapeHtml(gameCode)}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Certificate Number</span>
          <span class="fw-semibold">${SPW.escapeHtml(certCode)}</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Winning Reel Match</span>
          <span>${sym.emoji} ${sym.emoji} ${sym.emoji} (${SPW.escapeHtml(sym.label)})</span>
        </div>
        <div class="winner-field-row">
          <span class="text-muted-light">Draw Date &amp; Time</span>
          <span>${SPW.escapeHtml(SPW.formatDateTime(winner.DrawDateTime))}</span>
        </div>
      </div>
    `;

    if (detailsModalInstance) detailsModalInstance.show();
  }

  function launchCelebrationConfetti() {
    if (typeof confetti !== 'function') return;

    const colors = ['#c89f49', '#ebd298', '#14213d', '#f7e6bd', '#9e7624'];

    confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.62 },
      colors
    });

    const end = Date.now() + 2000;
    const frame = () => {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 50,
        origin: { x: 0, y: 0.7 },
        colors
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 50,
        origin: { x: 1, y: 0.7 },
        colors
      });
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('slotCabinet')) {
      initGamePage();
    }
  });
})();
