/* ================= A QR ENCODER, WRITTEN OUT LONGHAND =================
   Chapter 9's share sticker is a vinyl centre label with a scannable code
   printed on it. Every QR library on npm would work, but this project has
   deliberately stayed dependency-light and draws its own props, so the code is
   generated here: QR Model 2, byte mode, error-correction level M, versions 1
   through 10. That tops out at 213 bytes, far more than the deep link it has
   to carry.

   The output is a square boolean matrix; the caller decides how to paint it.

   Reference: ISO/IEC 18004. The tables below are the standard ones for
   level M only, which is all this file offers. */

/* [ec codewords per block, group-1 block count, group-1 data codewords,
    group-2 block count, group-2 data codewords] indexed by version - 1. */
const EC_BLOCKS_M: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

/* Row/column centres of the alignment patterns, indexed by version - 1. */
const ALIGNMENT_CENTRES: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/* ---------- GF(256), primitive polynomial 0x11D ---------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], GF_EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const rem = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ---------- BCH check bits ---------- */

function formatBits(mask: number): number {
  // level M is 0b00, so the 5-bit payload is just the mask in the low 3 bits
  const data = mask;
  let bch = data << 10;
  for (let i = 14; i >= 10; i--) if ((bch >> i) & 1) bch ^= 0x537 << (i - 10);
  return ((data << 10) | bch) ^ 0x5412;
}

function versionBits(version: number): number {
  let bch = version << 12;
  for (let i = 17; i >= 12; i--) if ((bch >> i) & 1) bch ^= 0x1f25 << (i - 12);
  return (version << 12) | bch;
}

/* ---------- bit stream ---------- */

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
}

/* ---------- the matrix ---------- */

type Grid = { size: number; modules: Uint8Array; reserved: Uint8Array };

function makeGrid(size: number): Grid {
  return { size, modules: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
}

function set(g: Grid, r: number, c: number, dark: boolean) {
  g.modules[r * g.size + c] = dark ? 1 : 0;
  g.reserved[r * g.size + c] = 1;
}

function placeFinder(g: Grid, row: number, col: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= g.size || c < 0 || c >= g.size) continue;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark =
        inRing &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(g, r, c, dark);
    }
  }
}

function placeFunctionPatterns(g: Grid, version: number) {
  const size = g.size;

  placeFinder(g, 0, 0);
  placeFinder(g, 0, size - 7);
  placeFinder(g, size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }

  // alignment patterns, skipping the three that would sit on a finder
  const centres = ALIGNMENT_CENTRES[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(g, r + dr, c + dc, ring !== 1);
        }
      }
    }
  }

  /* Reserve the format-information strips, plus the always-dark module.
     Row 8 column 6 and row 6 column 8 are skipped deliberately: those two are
     timing modules that the format strip steps over, and blanking them breaks
     the timing pattern a scanner uses to find the module grid. */
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(g, 8, i, false);
      set(g, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(g, 8, size - 1 - i, false);
    set(g, size - 1 - i, 8, false);
  }
  set(g, size - 8, 8, true);

  // version information block, versions 7 and up
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(g, b, a, dark);
      set(g, a, b, dark);
    }
  }
}

function placeFormatInfo(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const size = g.size;
  /* Coordinates here are (row, column). Getting these two strips the wrong way
     round produces a symbol that passes every structural check and still will
     not scan, because a reader looks for the format bits at exact positions. */
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;

    // copy one: up the left of the top-left finder, then along the top
    if (i < 6) set(g, i, 8, dark);
    else if (i === 6) set(g, 7, 8, dark);
    else if (i === 7) set(g, 8, 8, dark);
    else if (i === 8) set(g, 8, 7, dark);
    else set(g, 8, 14 - i, dark);

    /* Copy two: bits 0 to 7 run leftwards along row 8 from the right edge,
       bits 8 to 14 run down column 8 to the bottom edge. The cell between them,
       (size - 8, 8), is the always-dark module and is not a format bit. */
    if (i < 8) set(g, 8, size - 1 - i, dark);
    else set(g, size - 15 + i, 8, dark);
  }
}

const MASKS: ReadonlyArray<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Standard penalty score, used only to pick the least ugly of the 8 masks. */
function penalty(g: Grid): number {
  const size = g.size;
  const at = (r: number, c: number) => g.modules[r * size + c] === 1;
  let score = 0;

  // rule 1: runs of five or more of the same colour
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      let prev = pass === 0 ? at(a, 0) : at(0, a);
      for (let b = 1; b < size; b++) {
        const cur = pass === 0 ? at(a, b) : at(b, a);
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          prev = cur;
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // rule 2: 2x2 blocks of one colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // rule 3: the finder-lookalike run, with its four light modules on either side
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const line = (r: number, c: number, dr: number, dc: number, pat: boolean[]) => {
    for (let i = 0; i < 11; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) return false;
      if (at(rr, cc) !== pat[i]) return false;
    }
    return true;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (line(r, c, 0, 1, A) || line(r, c, 0, 1, B)) score += 40;
      if (line(r, c, 1, 0, A) || line(r, c, 1, 0, B)) score += 40;
    }
  }

  // rule 4: overall imbalance of dark to light
  let dark = 0;
  for (let i = 0; i < size * size; i++) dark += g.modules[i];
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * Encode `text` as a QR matrix (level M).
 * Returns `size` rows of `size` booleans, dark = true.
 * Throws if the text is longer than a version-10 symbol can hold.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  // pick the smallest version the payload fits in
  let version = 0;
  let dataCodewords = 0;
  for (let v = 1; v <= 10; v++) {
    const [, g1, d1, g2, d2] = EC_BLOCKS_M[v - 1];
    const total = g1 * d1 + g2 * d2;
    const countBits = v >= 10 ? 16 : 8;
    if (bytes.length * 8 + 4 + countBits <= total * 8) {
      version = v;
      dataCodewords = total;
      break;
    }
  }
  if (!version) throw new Error("QR payload too long");

  // 1. bit stream: mode, length, payload, terminator, byte padding, pad bytes
  const buf = new BitBuffer();
  buf.push(0b0100, 4);
  buf.push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) buf.push(b, 8);

  const capacityBits = dataCodewords * 8;
  buf.push(0, Math.min(4, capacityBits - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);

  const data = new Uint8Array(dataCodewords);
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | buf.bits[i + b];
    data[i / 8] = byte;
  }
  for (let i = buf.bits.length / 8, pad = 0; i < dataCodewords; i++, pad++) {
    data[i] = pad % 2 === 0 ? 0xec : 0x11;
  }

  // 2. split into blocks, compute error correction, interleave
  const [ecPerBlock, g1Count, g1Data, g2Count, g2Data] = EC_BLOCKS_M[version - 1];
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1Count + g2Count; i++) {
    const len = i < g1Count ? g1Data : g2Data;
    const block = data.slice(offset, offset + len);
    offset += len;
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }

  // 3. lay the function patterns down, then snake the data through the gaps
  const size = version * 4 + 17;
  const grid = makeGrid(size);
  placeFunctionPatterns(grid, version);

  let bitIndex = 0;
  const totalBits = interleaved.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is the vertical timing pattern
    for (let step = 0; step < size; step++) {
      const upward = ((size - 1 - right) & 2) === 0;
      const r = upward ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (grid.reserved[r * size + c]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((interleaved[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        grid.modules[r * size + c] = dark ? 1 : 0;
      }
    }
  }

  // 4. try every mask, keep the one with the lowest penalty
  const dataCells: number[] = [];
  for (let i = 0; i < size * size; i++) if (!grid.reserved[i]) dataCells.push(i);

  let best: Uint8Array = grid.modules;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate: Grid = {
      size,
      modules: Uint8Array.from(grid.modules),
      reserved: Uint8Array.from(grid.reserved),
    };
    for (const idx of dataCells) {
      const r = Math.floor(idx / size);
      const c = idx % size;
      if (MASKS[mask](r, c)) candidate.modules[idx] ^= 1;
    }
    placeFormatInfo(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate.modules;
    }
  }

  const out: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(best[r * size + c] === 1);
    out.push(row);
  }
  return out;
}
