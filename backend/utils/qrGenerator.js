/**
 * Pure JavaScript ISO/IEC 18004 QR Code Generator (Byte Mode, Versions 1-10, ECC Level L)
 * Generates both 2D boolean module matrices (for PDF vector drawing) and crisp SVG strings
 * for Official Royal Palms Flat Allocation Tickets — zero external dependencies.
 */

// Total codewords & ECC codewords per version (1..10) at Error Correction Level L (1 block for v1-v5, 2 blocks for v6-v10)
const VERSION_SPECS_L = [
  null,
  { total: 26, ecPerBlock: 7, blocks: [19], align: [] },
  { total: 44, ecPerBlock: 10, blocks: [34], align: [6, 18] },
  { total: 70, ecPerBlock: 15, blocks: [55], align: [6, 22] },
  { total: 100, ecPerBlock: 20, blocks: [80], align: [6, 26] },
  { total: 134, ecPerBlock: 26, blocks: [108], align: [6, 30] },
  { total: 172, ecPerBlock: 18, blocks: [68, 68], align: [6, 34] },
  { total: 196, ecPerBlock: 20, blocks: [78, 78], align: [6, 22, 38] },
  { total: 242, ecPerBlock: 24, blocks: [97, 97], align: [6, 24, 42] },
  { total: 292, ecPerBlock: 30, blocks: [116, 116], align: [6, 26, 46] },
  { total: 346, ecPerBlock: 18, blocks: [68, 68, 69, 69], align: [6, 28, 50] }
];

// GF(256) log/exp tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomon(dataBytes, ecLen) {
  const gen = buildGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return Array.from(rem);
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const spec = VERSION_SPECS_L[v];
    const dataCapacity = spec.blocks.reduce((a, b) => a + b, 0);
    const headerBytes = v <= 9 ? 2 : 3; // 4-bit mode + 8/16-bit length + 4-bit terminator
    if (byteLen + headerBytes <= dataCapacity) {
      return v;
    }
  }
  return 10;
}

function encodeCodewords(utf8Bytes, version) {
  const spec = VERSION_SPECS_L[version];
  const dataCapacity = spec.blocks.reduce((a, b) => a + b, 0);
  const maxPayload = dataCapacity - (version <= 9 ? 2 : 3);
  const payload = utf8Bytes.slice(0, maxPayload);

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator = 0100
  pushBits(0b0100, 4);
  pushBits(payload.length, version <= 9 ? 8 : 16);
  for (const b of payload) pushBits(b, 8);

  const totalDataBits = dataCapacity * 8;
  const termLen = Math.min(4, totalDataBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    dataWords.push(byte);
  }

  let padToggle = true;
  while (dataWords.length < dataCapacity) {
    dataWords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  // Split into blocks & interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const blkLen of spec.blocks) {
    const block = dataWords.slice(offset, offset + blkLen);
    offset += blkLen;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomon(block, spec.ecPerBlock));
  }

  const finalWords = [];
  const maxBlockLen = Math.max(...spec.blocks);
  for (let i = 0; i < maxBlockLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalWords.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      finalWords.push(ec[i]);
    }
  }

  return finalWords;
}

function computeFormatBits(ecLevelBits, maskPattern) {
  const data = (ecLevelBits << 3) | maskPattern;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

/**
 * Generates a 2D QR matrix for any verification string.
 */
function generateQrMatrix(text) {
  const utf8Bytes = Array.from(Buffer.from(String(text || 'ROYAL-PALMS'), 'utf8'));
  const version = chooseVersion(utf8Bytes.length);
  const size = version * 4 + 17;

  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunctionModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = Boolean(dark);
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (topR, leftC) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inCenter));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const alignCoords = VERSION_SPECS_L[version].align;
  for (const r of alignCoords) {
    for (const c of alignCoords) {
      const overlapsFinder =
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 8) ||
        (r >= size - 8 && c <= 8);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunctionModule(r + dr, c + dc, dist !== 1);
        }
      }
    }
  }

  // Dark module & reserve format/version areas
  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (!isFunction[8][i]) setFunctionModule(8, i, false);
    if (!isFunction[i][8]) setFunctionModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(8, size - 1 - i, false);
    setFunctionModule(size - 1 - i, 8, false);
  }

  if (version >= 7) {
    const vBits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = Boolean((vBits >>> i) & 1);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  // Place data & ECC bits upward/downward in 2-column zig-zag
  const codewords = encodeCodewords(utf8Bytes, version);
  const allBits = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) allBits.push((cw >>> b) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r][c]) {
          const dark = bitIdx < allBits.length ? Boolean(allBits[bitIdx++]) : false;
          // Apply Mask Pattern 0: (r + c) % 2 === 0
          modules[r][c] = (r + c) % 2 === 0 ? !dark : dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information (Level L = 01, Mask = 000)
  const formatBits = computeFormatBits(0b01, 0);
  for (let i = 0; i <= 5; i++) modules[8][i] = Boolean((formatBits >>> i) & 1);
  modules[8][7] = Boolean((formatBits >>> 6) & 1);
  modules[8][8] = Boolean((formatBits >>> 7) & 1);
  modules[7][8] = Boolean((formatBits >>> 8) & 1);
  for (let i = 9; i < 15; i++) modules[14 - i][8] = Boolean((formatBits >>> i) & 1);

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = Boolean((formatBits >>> i) & 1);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = Boolean((formatBits >>> i) & 1);

  return { size, modules };
}

/**
 * Renders a crisp vector SVG string for embedding in HTML tickets & print layouts.
 */
function generateQrSvg(text, options = {}) {
  const { size, modules } = generateQrMatrix(text);
  const margin = 2;
  const total = size + margin * 2;
  const sizePx = options.sizePx || 128;
  const darkColor = options.darkColor || '#0b1630';
  const lightColor = options.lightColor || '#fffdf8';

  const paths = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        paths.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" role="img" aria-label="Allocation Verification QR Code"><rect width="${total}" height="${total}" fill="${lightColor}" rx="1.5"/><path d="${paths.join('')}" fill="${darkColor}"/></svg>`;
}

module.exports = {
  generateQrMatrix,
  generateQrSvg
};
