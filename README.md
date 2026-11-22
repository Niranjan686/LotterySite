# Royal Palms — Flat Allocation & Live Lucky Draw Lottery Portal

A complete, transparent **Flat Allocation & Live Lucky Draw Lottery Portal** built for **Royal Palms Co-operative Housing Society** using **Node.js, Express, and MongoDB** as the primary database.

It provides two dedicated experiences connected to the same MongoDB backend:
1. **Admin Management Portal (`/admin.html`)**: 11-module management suite for uploading 500+ participants, managing flat sequences, configuring fixed flat mappings, running cryptographic allocations, auditing, database backups, and generating Excel/CSV/PDF reports.
2. **Live Lottery Show Screen (`/live-lottery.html`)**: Full-screen television game-show presentation for LED walls and projectors with a `3... 2... 1...` countdown, original Web Audio suspense & celebration soundscapes, kinetic name & flat reveals, gold confetti, and luxury QR-verified allocation tickets.

---

## 1. Quick Start

```powershell
cd backend
npm install
npm start
```

- **Portal Launchpad & Ticket Verifier**: `http://localhost:5000`
- **Admin Portal**: `http://localhost:5000/admin.html`
- **Live Lottery Show Screen**: `http://localhost:5000/live-lottery.html`
- **Health Check**: `http://localhost:5000/api/health`

### MongoDB Setup
- Copy `.env.example` to `.env` if you want to connect to a custom local or MongoDB Atlas cluster via `MONGODB_URI`:
  ```env
  MONGODB_URI=mongodb://127.0.0.1:27017/royal_palms_lottery
  ```
- If no Windows MongoDB service is running on `27017` and `MONGODB_URI` is unset, the server automatically starts a persistent local WiredTiger MongoDB Replica Set stored in `backend/data/mongodb_rs`.

### Direct Open Access (No Sign-In Required)
- Both **Admin Portal** (`/admin.html`) and **Live Lottery Show Screen** (`/live-lottery.html`) open **immediately without any login, username, or password prompt**.

---

## 2. Instructions for Uploading Participants & Flats (500+)

1. Open `http://localhost:5000/admin.html` (or via Live Server once `cd backend && npm start` is running).
2. **Upload Participants**:
   - Open **Upload Participants** in the left sidebar.
   - Click **Template (.xlsx)** (or **500+ Sample (.xlsx)** to test with 520 realistic records).
   - Fill in `Unique Participant ID` and `Full Name` (plus optional `Registration Number`, `Mobile Number`, `Wing or Building`, `Notes`).
   - Drag & drop your `.xlsx` or `.csv` file into the upload zone.
   - Review the **Validation Preview Table** — any missing names or duplicate IDs are highlighted in red and can be edited inline before clicking **Confirm Import to MongoDB**.
3. **Upload Flat Numbers**:
   - Open **Manage Flat Numbers**.
   - Upload an Excel/CSV sheet (`Flat Number`, `Wing`, `Floor`, `Building`) **or** paste a comma-separated sequence (`101, 102, 103, 201, 202...`) in **Quick Flat Sequence Entry**.
4. **Configure Fixed Flat Mappings (Optional)**:
   - Open **Fixed Flat Mapping**.
   - Select the participant and their pre-assigned flat (e.g., `Rahul Sharma → Flat 101`) and click **Map Fixed Flat**.
   - Both the participant and flat are immediately locked out of the random pools and preserved permanently.

---

## 3. Instructions for Conducting the Live Lottery

1. In **Admin Portal → Lottery Configuration**, verify the **Pre-Lottery Readiness Summary** (Total Participants, Total Flats, Fixed Allocations, Remaining Random Pools, and any count-mismatch notice).
2. Click **Open Live Show Projector** (`http://localhost:5000/live-lottery.html`) and drag the window onto the hall's LED wall or projector, then click **Full Screen**.
3. Click **START DRAW** (confirming the pre-lottery summary on the first draw):
   - **Stage 1**: Dramatic `3... 2... 1...` countdown with timpani strikes.
   - **Stage 2**: Original suspenseful background pad begins (balanced below voice frequencies for stage announcements).
   - **Stage 3 & 4**: Eligible participant drum rolls and locks onto the backend-selected participant.
   - **Stage 5**: Rising dramatic swell reveals the backend-allocated flat number.
   - **Stage 6**: Luxury Digital Allocation Ticket appears with gold confetti, celebration fanfare, soft applause, QR code, **Download PDF**, and **Print Ticket**.
4. Use **Reveal Next Allocation** for subsequent draws, **Replay Animation** to replay the celebration safely (never creates a second allocation), **Pause / Resume Presentation** during speeches, and **End Lottery** when complete.
5. After the ceremony, open **Admin Portal → Reports & Exports** to export Excel (`.xlsx`), CSV, or PDF reports and print individual or batch tickets.

---

## 4. Automated Test Suite (500+ Participants & Concurrency Verification)

```powershell
cd backend
npm test
```
Runs `backend/test-lottery.js` against an isolated ephemeral MongoDB Replica Set (`LOTTERY_TEST_ISOLATED=true`) so live data is never touched.
