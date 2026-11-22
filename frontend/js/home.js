/* =========================================================================
   ROYAL PALMS PORTAL LAUNCHPAD & TICKET VERIFICATION (home.js)
   Connected to Real MongoDB Overview & Verification APIs
   ========================================================================= */

(function () {
  async function loadPortalOverview() {
    try {
      const data = await RPLottery.apiFetch('/overview');
      const ev = data.event || {};
      const s = data.summary || {};

      const setTxt = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };

      if (ev.societyName) {
        setTxt('portalNavSociety', ev.societyName);
        setTxt('heroSocietyName', ev.societyName);
        setTxt('footerSocietyLabel', ev.societyName);
      }

      setTxt('homeStatParticipants', (s.totalParticipants || 0).toLocaleString());
      setTxt('homeStatFlats', (s.totalFlats || 0).toLocaleString());
      setTxt('homeStatAllocated', (s.totalAllocated || 0).toLocaleString());
      setTxt('homeStatRemaining', (s.remainingFlats || 0).toLocaleString());
    } catch (_) {}
  }

  async function verifyAllocationById(code) {
    const mount = document.getElementById('homeVerifiedTicketMount');
    if (!mount || !code) return;

    try {
      const res = await RPLottery.apiFetch(`/verify/${encodeURIComponent(code.trim())}`);
      mount.innerHTML = RPLottery.renderLuxuryTicketHtml(res.ticket, {
        societyName: res.societyName,
        eventName: res.eventName
      });
      RPLottery.bindTicketActionButtons(mount, async () => res.ticket, {
        societyName: res.societyName
      });
      mount.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      Swal.fire({
        icon: 'warning',
        title: 'Ticket Not Found',
        text: err.message
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPortalOverview();

    const form = document.getElementById('homeVerifyTicketForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('verifyTicketInput').value.trim();
        if (code) verifyAllocationById(code);
      });
    }

    const params = new URLSearchParams(window.location.search);
    const verifyParam = params.get('verify');
    if (verifyParam) {
      const inp = document.getElementById('verifyTicketInput');
      if (inp) inp.value = verifyParam;
      verifyAllocationById(verifyParam);
    }
  });
})();
