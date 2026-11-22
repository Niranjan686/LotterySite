/* =========================================================================
   SOCIETY PLAY & WIN - SOCIETY PROFILE & GAME SETTINGS (settings.js)
   Open Direct Access — Society Info, Replaceable Building Photo & Draw Rules
   ========================================================================= */

(function () {
  let currentLogoDataUri = undefined;
  let currentHeroDataUri = undefined;

  async function initSettingsPage() {
    await loadSettingsData();
    bindHeroPhotoUpload();
    bindLogoUpload();
    bindSocietyForm();
    bindGameSettingsForm();
    bindResetDrawPool();
  }

  async function loadSettingsData() {
    try {
      const data = await SPW.apiFetch('/society');
      const s = data.society;
      const gs = data.settings;

      if (s) {
        document.getElementById('setSocietyId').value = s.SocietyID;
        document.getElementById('setSocietyName').value = s.SocietyName || '';
        document.getElementById('setSocietyAddress').value = s.SocietyAddress || '';
        document.getElementById('setTotalFlats').value = s.TotalFlats || 500;
        document.getElementById('setCommitteeName').value =
          s.CommitteeName || 'Society Cultural & Events Committee';
        document.getElementById('setContactPhone').value = s.ContactPhone || '';

        const logoImg = document.getElementById('logoPreviewImg');
        if (logoImg) {
          logoImg.src = s.SocietyLogo || SPW.DEFAULT_LOGO_IMAGE;
        }

        const heroImg = document.getElementById('heroPhotoPreviewImg');
        if (heroImg) {
          heroImg.src = s.SocietyImage || SPW.DEFAULT_HERO_IMAGE;
        }
      }

      if (gs) {
        document.getElementById('setEventTitle').value =
          gs.EventTitle || 'Annual Society Family Festival & Lucky Draw';
        document.getElementById('setPrizeTitle').value =
          gs.PrizeTitle || 'Official Society Play & Win Winner';
        document.getElementById('setNoRepeatWinner').checked = Boolean(gs.NoRepeatWinner);
        document.getElementById('setSoundEnabled').checked = Boolean(gs.SoundEnabled);
        document.getElementById('setConfettiEnabled').checked = Boolean(gs.ConfettiEnabled);
        document.getElementById('setSpinDuration').value = gs.SpinDurationMs || 3200;
        document.getElementById('setMatchRate').value = gs.MatchRatePercent || 35;
        document.getElementById('matchRateValueLabel').textContent = `${gs.MatchRatePercent || 35}%`;
      }
    } catch (_) {
      // Keep clean defaults if SQL Server is not yet connected
    }
  }

  function bindHeroPhotoUpload() {
    const fileInp = document.getElementById('societyHeroFileInput');
    const resetBtn = document.getElementById('resetHeroPhotoBtn');
    const preview = document.getElementById('heroPhotoPreviewImg');

    if (fileInp) {
      fileInp.addEventListener('change', () => {
        const file = fileInp.files?.[0];
        if (!file) return;

        if (file.size > 4 * 1024 * 1024) {
          SPW.alertModal({
            icon: 'warning',
            title: 'Photo Too Large',
            text: 'Please choose a JPG, PNG, or WebP society building image under 4 MB.'
          });
          fileInp.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          currentHeroDataUri = String(reader.result);
          if (preview) preview.src = currentHeroDataUri;
        };
        reader.readAsDataURL(file);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        currentHeroDataUri = '';
        if (preview) preview.src = SPW.DEFAULT_HERO_IMAGE;
        if (fileInp) fileInp.value = '';
        SPW.toast('info', 'Reset to default residential building photo (click Save to apply).');
      });
    }
  }

  function bindLogoUpload() {
    const fileInp = document.getElementById('societyLogoFileInput');
    const clearBtn = document.getElementById('clearLogoBtn');
    const preview = document.getElementById('logoPreviewImg');

    if (fileInp) {
      fileInp.addEventListener('change', () => {
        const file = fileInp.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
          SPW.alertModal({
            icon: 'warning',
            title: 'Logo Too Large',
            text: 'Please choose a PNG, JPG, SVG, or WebP logo under 2 MB.'
          });
          fileInp.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          currentLogoDataUri = String(reader.result);
          if (preview) preview.src = currentLogoDataUri;
        };
        reader.readAsDataURL(file);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        currentLogoDataUri = '';
        if (preview) preview.src = SPW.DEFAULT_LOGO_IMAGE;
        if (fileInp) fileInp.value = '';
      });
    }
  }

  function bindSocietyForm() {
    const form = document.getElementById('societyProfileForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveSocietyBtn');
      btn.disabled = true;

      const payload = {
        societyId: parseInt(document.getElementById('setSocietyId').value, 10) || undefined,
        societyName: document.getElementById('setSocietyName').value.trim(),
        societyAddress: document.getElementById('setSocietyAddress').value.trim(),
        totalFlats: parseInt(document.getElementById('setTotalFlats').value, 10) || 500,
        committeeName: document.getElementById('setCommitteeName').value.trim(),
        contactPhone: document.getElementById('setContactPhone').value.trim()
      };

      if (currentLogoDataUri !== undefined) {
        payload.societyLogo = currentLogoDataUri;
      }
      if (currentHeroDataUri !== undefined) {
        payload.societyImage = currentHeroDataUri;
      }

      try {
        const res = await SPW.apiFetch('/society', {
          method: 'PUT',
          body: payload
        });
        SPW.toast('success', res.message || 'Society profile saved!');
        if (res.society) {
          SPW.applySocietyBrandingToDom(res.society);
        }
      } catch (err) {
        SPW.alertModal({ icon: 'error', title: 'Save Failed', text: err.message });
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindGameSettingsForm() {
    const form = document.getElementById('gameSettingsForm');
    const rangeInp = document.getElementById('setMatchRate');
    const rangeLbl = document.getElementById('matchRateValueLabel');

    if (rangeInp && rangeLbl) {
      rangeInp.addEventListener('input', () => {
        rangeLbl.textContent = `${rangeInp.value}%`;
      });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveGameSettingsBtn');
      btn.disabled = true;

      const payload = {
        eventTitle: document.getElementById('setEventTitle').value.trim(),
        prizeTitle: document.getElementById('setPrizeTitle').value.trim(),
        noRepeatWinner: document.getElementById('setNoRepeatWinner').checked,
        soundEnabled: document.getElementById('setSoundEnabled').checked,
        confettiEnabled: document.getElementById('setConfettiEnabled').checked,
        spinDurationMs: parseInt(document.getElementById('setSpinDuration').value, 10) || 3200,
        matchRatePercent: parseInt(document.getElementById('setMatchRate').value, 10) || 35
      };

      try {
        const res = await SPW.apiFetch('/game/settings', {
          method: 'PUT',
          body: payload
        });
        SPW.sound.setMuted(!payload.soundEnabled);
        SPW.toast('success', res.message || 'Game rules saved!');
      } catch (err) {
        SPW.alertModal({ icon: 'error', title: 'Settings Error', text: err.message });
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindResetDrawPool() {
    const btn = document.getElementById('resetSeasonWinnersBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      if (typeof Swal === 'undefined') return;
      const { value: text } = await Swal.fire({
        title: 'Start New Event Season?',
        html: 'This clears previous winner and spin records so every flat becomes eligible again for a fresh society event.<br/><br/>Type <strong class="text-warning">RESET</strong> below to confirm:',
        input: 'text',
        inputPlaceholder: 'Type RESET',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Reset Winner Pool',
        customClass: { popup: 'arcade-swal' }
      });

      if (!text) return;

      try {
        const res = await SPW.apiFetch('/winners/reset', {
          method: 'DELETE',
          body: { confirmText: text }
        });
        SPW.toast('success', res.message);
      } catch (err) {
        SPW.alertModal({ icon: 'error', title: 'Reset Cancelled', text: err.message });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('societyProfileForm')) {
      initSettingsPage();
    }
  });
})();
