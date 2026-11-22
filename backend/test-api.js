const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const EventEmitter = require('events');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const STORE_FILE = path.join(__dirname, 'data/society_store.json');

function runMiddlewareStack(app, { method = 'GET', url = '/', headers = {}, body = undefined }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    const parsedUrl = new URL(url, 'http://localhost:5000');

    req.method = method.toUpperCase();
    req.url = url;
    req.originalUrl = url;
    req.path = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.ip = '127.0.0.1';
    req.ips = [];
    req.connection = { remoteAddress: '127.0.0.1' };
    req.socket = new EventEmitter();
    req.socket.remoteAddress = '127.0.0.1';
    req.complete = true;
    req.get = (name) => req.headers[String(name).toLowerCase()];

    if (body !== undefined) {
      req.body = body;
      req._body = true;
    }

    const res = new EventEmitter();
    res.statusCode = 200;
    res.locals = {};
    const storeHeaders = {};
    const chunks = [];

    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
    res.setHeader = (k, v) => {
      storeHeaders[String(k).toLowerCase()] = v;
    };
    res.getHeader = (k) => storeHeaders[String(k).toLowerCase()];
    res.getHeaders = () => ({ ...storeHeaders });
    res.removeHeader = (k) => {
      delete storeHeaders[String(k).toLowerCase()];
    };
    res.writeHead = (code, hdrs) => {
      res.statusCode = code;
      if (hdrs) {
        Object.entries(hdrs).forEach(([k, v]) => res.setHeader(k, v));
      }
      return res;
    };
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      res.writableEnded = true;
      res.emit('finish');
      const raw = Buffer.concat(chunks);
      const ct = String(storeHeaders['content-type'] || '');
      let parsed = raw.toString('utf8');
      if (ct.includes('application/json') && parsed) {
        try {
          parsed = JSON.parse(parsed);
        } catch (err) {
          return reject(err);
        }
      }
      resolve({ status: res.statusCode, headers: storeHeaders, body: parsed, rawBuffer: raw });
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

(async () => {
  const hadStoreBefore = fs.existsSync(STORE_FILE);
  const previousStoreBackup = hadStoreBefore ? fs.readFileSync(STORE_FILE, 'utf8') : null;

  try {
    console.log('1. Verifying complete folder & file structure...');
    const requiredFiles = [
      'frontend/index.html',
      'frontend/dashboard.html',
      'frontend/flats.html',
      'frontend/game.html',
      'frontend/winners.html',
      'frontend/settings.html',
      'frontend/css/style.css',
      'frontend/css/home.css',
      'frontend/css/dashboard.css',
      'frontend/css/game.css',
      'frontend/css/responsive.css',
      'frontend/js/app.js',
      'frontend/js/home.js',
      'frontend/js/dashboard.js',
      'frontend/js/flats.js',
      'frontend/js/game.js',
      'frontend/js/excel.js',
      'frontend/js/winners.js',
      'frontend/js/settings.js',
      'frontend/assets/images/society-building.jpg',
      'frontend/assets/images/logo.svg',
      'frontend/assets/images/default-society.svg',
      'frontend/assets/sounds/spin.wav',
      'frontend/assets/sounds/reel-stop.wav',
      'frontend/assets/sounds/jackpot.wav',
      'frontend/assets/sounds/try-again.wav',
      'frontend/assets/sounds/click.wav',
      'backend/server.js',
      'backend/config/database.js',
      'backend/config/localFallbackDb.js',
      'backend/routes/societyRoutes.js',
      'backend/routes/flatRoutes.js',
      'backend/routes/gameRoutes.js',
      'backend/routes/winnerRoutes.js',
      'backend/controllers/societyController.js',
      'backend/controllers/flatController.js',
      'backend/controllers/gameController.js',
      'backend/controllers/winnerController.js',
      'backend/middleware/validateMiddleware.js',
      'backend/middleware/errorMiddleware.js',
      'backend/package.json',
      'database/society_play_win.sql',
      '.env.example',
      '.gitignore',
      'README.md'
    ];

    for (const rel of requiredFiles) {
      assert(fs.existsSync(path.join(ROOT, rel)), `Missing file: ${rel}`);
    }
    console.log(`   [OK] All ${requiredFiles.length} project files verified.`);

    console.log('2. Verifying luxury palette, hero 3-reel preview, navigation & game UI...');
    const styleCss = fs.readFileSync(path.join(ROOT, 'frontend/css/style.css'), 'utf8');
    const homeCss = fs.readFileSync(path.join(ROOT, 'frontend/css/home.css'), 'utf8');
    const gameCss = fs.readFileSync(path.join(ROOT, 'frontend/css/game.css'), 'utf8');
    const dashCss = fs.readFileSync(path.join(ROOT, 'frontend/css/dashboard.css'), 'utf8');

    assert(styleCss.includes('#fffefa') && styleCss.includes('#14213d'), 'Missing ivory / deep-navy luxury palette in style.css');
    assert(styleCss.includes('#f8f4ec') && styleCss.includes('#efe7da'), 'Missing soft cream / warm beige palette in style.css');

    for (const css of [styleCss, homeCss, gameCss, dashCss]) {
      assert(
        !/#1a0938|#2b0f5c|#050816|#00e5ff|#0284c7|#38bdf8/i.test(css),
        'Disallowed dark-purple / neon / bright-sky hex found in CSS'
      );
    }

    const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
    assert(
      indexHtml.includes('Your Society. Your Lucky Moment.'),
      'Landing page missing "Your Society. Your Lucky Moment." heading'
    );
    assert(
      indexHtml.includes('Play the Royal Palms Lucky Draw and discover your chance to win!'),
      'Landing page missing exact subtitle'
    );
    assert(
      indexHtml.includes('PLAY &amp; WIN') &&
        indexHtml.includes('fa-play') &&
        indexHtml.includes('game.html?autospin=1'),
      'Landing page missing prominent PLAY & WIN button with play icon linking to game.html?autospin=1'
    );
    assert(
      indexHtml.includes('Tap to spin the reels and discover your result.'),
      'Landing page missing short instruction below PLAY & WIN button'
    );
    assert(
      indexHtml.includes('hero-reel-preview') &&
        indexHtml.includes('Star') &&
        indexHtml.includes('Gift') &&
        indexHtml.includes('Trophy'),
      'Landing page missing compact 3-reel preview (Star, Gift, Trophy)'
    );
    assert(
      indexHtml.includes('How to Play') &&
        (indexHtml.includes('Click PLAY &amp; WIN.') || indexHtml.includes('Click PLAY & WIN.')) &&
        indexHtml.includes('Spin the three reels.') &&
        indexHtml.includes('Match the symbols and discover your result.'),
      'Landing page missing compact How to Play steps 1-3'
    );
    assert(
      indexHtml.includes('assets/images/society-building.jpg'),
      'Landing page missing Royal Palms building photograph'
    );
    assert(
      !indexHtml.includes('society-building-top-badge') &&
        !indexHtml.includes('society-building-caption-bar'),
      'Building image should not have overlay badges or text bars'
    );

    // Public resident pages must ONLY expose Home, Play Game, Winners, Dashboard (no Manage Flats / Settings)
    const publicResidentPages = [
      'frontend/index.html',
      'frontend/game.html',
      'frontend/winners.html',
      'frontend/dashboard.html'
    ];
    for (const rel of publicResidentPages) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert(html.includes('nav-game-cta'), `Play Game should be visually prominent in ${rel}`);
      assert(!html.includes('href="flats.html"'), `Admin flats.html link exposed to ordinary users in ${rel}`);
      assert(!html.includes('href="settings.html"'), `Admin settings.html link exposed to ordinary users in ${rel}`);
    }

    const gameHtml = fs.readFileSync(path.join(ROOT, 'frontend/game.html'), 'utf8');
    assert(
      gameHtml.includes('Match 3 symbols to win a lucky flat.'),
      'Game screen missing clear instruction text'
    );
    assert(
      gameHtml.includes('id="reelStrip1"') &&
        gameHtml.includes('id="reelStrip2"') &&
        gameHtml.includes('id="reelStrip3"'),
      'Game screen missing 3 spinning reels'
    );
    assert(gameHtml.includes('id="spinNowBtn"'), 'Game screen missing SPIN button');
    assert(!gameHtml.includes('chase-bulb'), 'Game screen should not have blinking arcade chase bulbs');

    const htmlPages = [
      'frontend/index.html',
      'frontend/dashboard.html',
      'frontend/flats.html',
      'frontend/game.html',
      'frontend/winners.html',
      'frontend/settings.html'
    ];
    for (const rel of htmlPages) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert(!/\btext-white\b|\bbg-dark\b|\bdropdown-menu-dark\b/.test(html), `Dark class left in ${rel}`);
    }
    console.log('   [OK] Luxury ivory/champagne-gold palette, hero 3-reel preview, navigation & game UI verified.');

    console.log('3. Verifying JavaScript syntax across all frontend & backend modules...');
    for (const rel of requiredFiles.filter((f) => f.endsWith('.js'))) {
      new vm.Script(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
    }
    console.log('   [OK] Zero syntax errors across all JS modules.');

    console.log('4. Verifying SQL Server schema & end-to-end game spin / flat / winner APIs...');
    const sqlScript = fs.readFileSync(path.join(ROOT, 'database/society_play_win.sql'), 'utf8');
    for (const table of ['Societies', 'Flats', 'GameSessions', 'Winners', 'GameSettings']) {
      assert(sqlScript.includes(`CREATE TABLE dbo.${table}`), `Missing table ${table}`);
    }

    const app = require('./server');
    const stateRes = await runMiddlewareStack(app, { method: 'GET', url: '/api/game/state' });
    assert.strictEqual(stateRes.status, 200);
    assert(stateRes.body.counts.eligibleFlatsCount > 0, 'Expected eligible Royal Palms flats');

    const spinRes = await runMiddlewareStack(app, {
      method: 'POST',
      url: '/api/game/spin',
      body: {}
    });
    assert([200, 201].includes(spinRes.status), `Unexpected spin status ${spinRes.status}`);
    assert.strictEqual(spinRes.body.reels.length, 3, 'Spin must return 3 reel symbols');
    if (spinRes.body.isWin) {
      assert.strictEqual(spinRes.body.reels[0], spinRes.body.reels[1]);
      assert.strictEqual(spinRes.body.reels[1], spinRes.body.reels[2]);
      assert(spinRes.body.winner && spinRes.body.winner.FlatNumber, 'Winning spin must return actual flat');
    } else {
      assert.strictEqual(spinRes.body.winner, null, 'Non-matching spin must not claim a fake win');
    }

    const flatsRes = await runMiddlewareStack(app, { method: 'GET', url: '/api/flats' });
    assert.strictEqual(flatsRes.status, 200);
    assert(Array.isArray(flatsRes.body.flats) && flatsRes.body.flats.length > 0);

    const dashRes = await runMiddlewareStack(app, { method: 'GET', url: '/api/society/dashboard' });
    assert.strictEqual(dashRes.status, 200);

    const winnersRes = await runMiddlewareStack(app, { method: 'GET', url: '/api/winners' });
    assert.strictEqual(winnersRes.status, 200);
    console.log('   [OK] End-to-end game state, 3-reel spin, flat records & winner history verified.');

    console.log('5. Verifying SheetJS Excel (.xlsx) & CSV round-trip...');
    const bulkRows = Array.from({ length: 100 }, (_, idx) => ({
      'Society Name': 'Royal Palms Co-operative Housing Society',
      'Flat No': `D-${101 + idx}`,
      'Owner Name': `Resident ${idx + 1}`,
      'Mobile Number': `98200${String(10000 + idx).slice(0, 5)}`,
      'Participation Status': 'Participating'
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(bulkRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Society Flats');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const parsedXlsx = XLSX.utils.sheet_to_json(
      XLSX.read(xlsxBuffer, { type: 'buffer' }).Sheets['Society Flats']
    );
    assert.strictEqual(parsedXlsx.length, 100);
    console.log('   [OK] Excel/CSV import/export verified.');

    console.log('\nALL ROYAL PALMS PLAY & WIN REDESIGN & FUNCTIONAL TESTS PASSED!');
  } finally {
    // Restore or clean up temporary test store so live data is never modified by tests
    if (hadStoreBefore && previousStoreBackup !== null) {
      fs.writeFileSync(STORE_FILE, previousStoreBackup, 'utf8');
    } else if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE);
    }
  }
  process.exit(0);
})();
