/**
 * Production Build & Vercel Deployment Packaging Script for:
 * Royal Palms — Flat Allocation & Live Lucky Draw Lottery Portal
 *
 * 1. Validates syntax of all backend & frontend JavaScript modules.
 * 2. Generates fresh repeatable demo Excel/CSV spreadsheets in demo_data/.
 * 3. Populates public/ with static frontend assets & demo files for Vercel Edge CDN.
 * 4. Assembles a clean, self-contained production release bundle in dist/.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');

const EXCLUDED_DIRS = new Set(['node_modules', 'data', '.git', 'dist', 'build', 'public']);
const EXCLUDED_FILES = new Set(['test-lottery.js', 'test-api.js', '.env']);

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirectoryFiltered(srcDir, destDir, stats) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name) || EXCLUDED_FILES.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryFiltered(srcPath, destPath, stats);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.js') && stats) {
        const code = fs.readFileSync(srcPath, 'utf8');
        new vm.Script(code, { filename: path.relative(ROOT, srcPath) });
        stats.jsChecked += 1;
      }
      fs.copyFileSync(srcPath, destPath);
      if (stats) {
        stats.filesCopied += 1;
        stats.totalBytes += fs.statSync(destPath).size;
      }
    }
  }
}

(function buildProductionBundle() {
  console.log('==================================================================');
  console.log('  ROYAL PALMS LOTTERY PORTAL — VERCEL & PRODUCTION BUILD');
  console.log('==================================================================');

  // 1. Refresh demo spreadsheets
  console.log('1. Generating repeatable demo Excel & CSV spreadsheets...');
  require('../backend/seed-demo');

  // 2. Populate public/ for Vercel Static Output Directory (outputDirectory: "public")
  console.log('2. Building public/ static directory for Vercel Edge CDN...');
  ensureCleanDir(PUBLIC_DIR);
  copyDirectoryFiltered(path.join(ROOT, 'frontend'), PUBLIC_DIR, null);
  copyDirectoryFiltered(path.join(ROOT, 'demo_data'), path.join(PUBLIC_DIR, 'demo_data'), null);

  // 3. Clean & build dist/ standalone release bundle
  console.log('3. Preparing clean production output directory (dist/)...');
  ensureCleanDir(DIST);

  const stats = {
    filesCopied: 0,
    jsChecked: 0,
    totalBytes: 0
  };

  console.log('4. Validating JS syntax & packaging backend, frontend, api, and demo assets...');
  copyDirectoryFiltered(path.join(ROOT, 'api'), path.join(DIST, 'api'), stats);
  copyDirectoryFiltered(path.join(ROOT, 'backend'), path.join(DIST, 'backend'), stats);
  copyDirectoryFiltered(path.join(ROOT, 'frontend'), path.join(DIST, 'frontend'), stats);
  copyDirectoryFiltered(path.join(ROOT, 'demo_data'), path.join(DIST, 'demo_data'), stats);

  const rootConfigFiles = [
    'package.json',
    'vercel.json',
    '.env.example',
    'README.md',
    'Dockerfile',
    'docker-compose.yml',
    'render.yaml',
    'ecosystem.config.js'
  ];

  for (const file of rootConfigFiles) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST, file));
      stats.filesCopied += 1;
    }
  }

  const manifest = {
    app: 'Royal Palms — Flat Allocation & Live Lucky Draw Lottery Portal',
    version: '2.0.0',
    builtAt: new Date().toISOString(),
    nodeVersion: process.version,
    vercelReady: true,
    vercelOutputDirectory: 'public',
    vercelFunctionEntry: 'api/index.js',
    filesPackaged: stats.filesCopied,
    jsModulesVerified: stats.jsChecked,
    bundleSizeKB: Math.round((stats.totalBytes / 1024) * 10) / 10,
    entryPoint: 'backend/server.js',
    endpoints: {
      portalHome: '/',
      adminPortal: '/admin.html',
      liveLotteryShow: '/live-lottery.html',
      healthCheck: '/api/health'
    }
  };

  fs.writeFileSync(
    path.join(DIST, 'BUILD_MANIFEST.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  console.log(`   [OK] Verified ${stats.jsChecked} JavaScript modules with 0 syntax errors.`);
  console.log('   [OK] Populated public/ for Vercel static CDN + api/index.js for Vercel Serverless.');
  console.log(
    `   [OK] Packaged ${stats.filesCopied} production files (${manifest.bundleSizeKB} KB) into: ${DIST}`
  );
  console.log('==================================================================');
  console.log('  VERCEL & PRODUCTION BUILD COMPLETE');
  console.log('==================================================================');
})();
