import spectral from 'spectral.js';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const palettes = {
  primary: {
    white: '#FFFFFF',
    black: '#101010',
    red: '#E53935',
    yellow: '#FDD835',
    blue: '#283593',
  },
  modern: {
    white: '#FFFFFF',
    black: '#101010',
    cyan: '#00AEEF',
    magenta: '#EC008C',
    yellow: '#FFF200',
  },
  acrylics: {
    white: '#FFFFFF',
    black: '#18191A',
    red: '#D72828',
    yellow: '#F8C300',
    blue: '#1B3481',
    green: '#005A3B',
    burntSienna: '#6F3B28',
    burntUmber: '#402922',
    yellowLight: '#F5D130',
    orange: '#ED6B23',
    purple: '#442A5C',
    cerulean: '#006EB8',
  },
  oils: {
    white: '#FFFFFF',
    black: '#151515',
    crimson: '#8D0001',
    yellow: '#F7E309',
    phthaloBlue: '#000F89',
    phthaloGreen: '#107463',
    yellowOchre: '#C6781A',
    burntSienna: '#6A3D1F',
    vanDykeBrown: '#4E342E',
    darkSienna: '#5C2C16',
    brightRed: '#D52924',
    prussianBlue: '#1C2D5A',
    sapGreen: '#509B45',
  },
  watercolors: {
    white: '#FFFFFF',
    black: '#141518',
    lemonYellow: '#FBE42E',
    cadYellow: '#F7B511',
    redPale: '#EA3522',
    crimson: '#9E1F30',
    ultramarine: '#243B71',
    cerulean: '#006199',
    viridian: '#00664B',
    yellowOchre: '#C29033',
    burntSienna: '#6C3922',
    purple: '#4B235E',
  },
  miniatures: {
    white: '#FFFFFF',
    black: '#231F20',
    red: '#9A1115',
    yellow: '#FDB825',
    blue: '#0D407F',
    green: '#00401F',
    brown: '#640909',
    sand: '#9F9174',
    purple: '#3D3354',
    gunmetal: '#888D8F',
    gold: '#C39E81',
    orange: '#EE3823',
  },
  industrial: {
    white: '#F1F0EA',
    black: '#0A0A0A',
    red: '#CC0605',
    yellow: '#F2A900',
    blue: '#004F7C',
    green: '#008754',
    orange: '#E25303',
    greyA: '#8D9295',
    ochreBrown: '#9C6B30',
    pigeonBlue: '#6C7C98',
    stoneGrey: '#8B8C89',
    anthracite: '#383E42',
  },
};

const extraColors = {
  pureRed: '#FF0000',
  pureGreen: '#00FF00',
  pureBlue: '#0000FF',
  pureYellow: '#FFFF00',
  pureCyan: '#00FFFF',
  pureMagenta: '#FF00FF',
  midGray: '#808080',
};

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const MANUAL_OPPONENT_CONFIG = JSON.parse(
  readFileSync(resolve(SCRIPT_DIR, '../training/manual_opponent_pairs.json'), 'utf8'),
);

function resolveNamedHex(paletteName, colorName) {
  if (paletteName === 'extra') {
    const hex = extraColors[colorName];
    if (!hex) throw new Error(`Unknown extra color: ${colorName}`);
    return hex.toUpperCase();
  }
  const palette = palettes[paletteName];
  if (!palette) throw new Error(`Unknown palette in manual opponent config: ${paletteName}`);
  const hex = palette[colorName];
  if (!hex) throw new Error(`Unknown color in manual opponent config: ${paletteName}/${colorName}`);
  return hex.toUpperCase();
}

function canonicalHexPairKey(hexes) {
  return hexes.map((hex) => hex.toUpperCase()).sort().join('|');
}

function normalizeManualOpponentTargetPath(targetPath, pairKey) {
  if (targetPath == null) return null;
  if (typeof targetPath !== 'object') {
    throw new Error(`Manual opponent targetPath must be an object for pair: ${pairKey}`);
  }
  const dominantAField = ('firstDominant' in targetPath || 'secondDominant' in targetPath)
    ? 'firstDominant'
    : 'warmDominant';
  const dominantBField = ('firstDominant' in targetPath || 'secondDominant' in targetPath)
    ? 'secondDominant'
    : 'coolDominant';
  const normalized = {};
  for (const [field, normalizedField] of [
    [dominantAField, 'dominantA'],
    ['balanced', 'balanced'],
    [dominantBField, 'dominantB'],
  ]) {
    const value = targetPath[field];
    if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      throw new Error(`Invalid manual opponent ${field} target for pair: ${pairKey}`);
    }
    normalized[normalizedField] = value.toUpperCase();
  }
  return normalized;
}

function buildManualOpponentRules() {
  const seen = new Set();
  return MANUAL_OPPONENT_CONFIG.pairs.map((pair) => {
    if (pair.kind !== 'purple' && pair.kind !== 'earth' && pair.kind !== 'path') {
      throw new Error(`Unsupported manual opponent kind: ${pair.kind}`);
    }
    if (!Array.isArray(pair.entries) || pair.entries.length !== 2) {
      throw new Error('Manual opponent pairs must contain exactly two entries.');
    }
    const hexes = pair.entries.map(({ palette, name }) => resolveNamedHex(palette, name));
    const pairKey = canonicalHexPairKey(hexes);
    if (seen.has(pairKey)) {
      throw new Error(`Duplicate manual opponent pair: ${pairKey}`);
    }
    seen.add(pairKey);
    const targetPath = normalizeManualOpponentTargetPath(pair.targetPath, pairKey);
    return {
      ...pair,
      hexes,
      pairKey,
      targetPath,
      category: pair.kind === 'purple'
        ? 'guardrail_purple_opponent'
        : pair.kind === 'earth'
          ? 'guardrail_earth_opponent'
          : 'guardrail_manual_path',
    };
  });
}

const MANUAL_OPPONENT_RULES = buildManualOpponentRules();
const MANUAL_OPPONENT_RULE_BY_PAIR_KEY = new Map(
  MANUAL_OPPONENT_RULES.map((rule) => [rule.pairKey, rule]),
);

const DARK_NEUTRAL_COLOR_NAMES = new Set([
  'anthracite',
  'stoneGrey',
  'gunmetal',
  'greyA',
  'midGray',
]);

const paletteKeyColors = {
  primary: { red: 'red', blue: 'blue', yellow: 'yellow' },
  modern: { cyan: 'cyan', magenta: 'magenta', yellow: 'yellow' },
  acrylics: { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', orange: 'orange', cerulean: 'cerulean' },
  oils: { red: 'brightRed', crimson: 'crimson', blue: 'phthaloBlue', yellow: 'yellow', green: 'phthaloGreen', prussian: 'prussianBlue' },
  watercolors: { red: 'redPale', crimson: 'crimson', blue: 'ultramarine', yellow: 'lemonYellow', cerulean: 'cerulean', green: 'viridian' },
  miniatures: { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', orange: 'orange' },
  industrial: { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', orange: 'orange' },
};

const curatedThreeColorSets = [
  ['primary', 'red', 'yellow', 'blue'],
  ['acrylics', 'red', 'yellow', 'blue'],
  ['oils', 'brightRed', 'yellow', 'phthaloBlue'],
  ['oils', 'crimson', 'yellow', 'phthaloBlue'],
  ['watercolors', 'redPale', 'lemonYellow', 'ultramarine'],
  ['watercolors', 'crimson', 'cadYellow', 'ultramarine'],
  ['miniatures', 'red', 'yellow', 'blue'],
  ['industrial', 'red', 'yellow', 'blue'],
  ['primary', 'red', 'blue', 'white'],
  ['primary', 'red', 'yellow', 'white'],
  ['primary', 'blue', 'yellow', 'white'],
  ['acrylics', 'red', 'blue', 'white'],
  ['oils', 'crimson', 'phthaloBlue', 'white'],
  ['acrylics', 'red', 'yellow', 'white'],
  ['watercolors', 'redPale', 'ultramarine', 'white'],
  ['miniatures', 'red', 'blue', 'white'],
  ['industrial', 'red', 'blue', 'white'],
  ['oils', 'brightRed', 'phthaloBlue', 'white'],
];

const DEFAULT_SYNTHETIC_COUNT = 50000;
const DEFAULT_SEED = 42;
const DEFAULT_OUTPUT_DIR = 'tools/training/out/data';
const HUE_GUARDRAIL_RATIO_PAIRS = [
  [4, 1],
  [3, 1],
  [2, 1],
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
];
const WHITE_GUARDRAIL_RATIO_PAIRS = [
  [3, 1],
  [2, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 8],
  [1, 16],
  [1, 32],
  [1, 64],
  [1, 100],
];
const BLACK_GUARDRAIL_RATIO_PAIRS = [
  [3, 1],
  [2, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 6],
  [1, 8],
];
const NEUTRAL_GUARDRAIL_RATIO_PAIRS = [
  [100, 1],
  [64, 1],
  [32, 1],
  [16, 1],
  [8, 1],
  [4, 1],
  [3, 1],
  [2, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 6],
  [1, 8],
];
const DARK_NEUTRAL_GUARDRAIL_RATIO_PAIRS = [
  [4, 1],
  [3, 1],
  [2, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 6],
  [1, 8],
];
const MANUAL_OPPONENT_RATIO_PAIRS = MANUAL_OPPONENT_CONFIG.guardrailRatios;
const ITERATIVE_TINT_SHADE_CHAIN_STEPS = [2, 3];

function parseArgs(argv) {
  const args = {
    syntheticCount: DEFAULT_SYNTHETIC_COUNT,
    seed: DEFAULT_SEED,
    outputDir: DEFAULT_OUTPUT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--synthetic-count') args.syntheticCount = Number(argv[++index]);
    else if (arg === '--seed') args.seed = Number(argv[++index]);
    else if (arg === '--output-dir') args.outputDir = argv[++index];
    else if (arg === '--help') {
      console.log('Usage: node tools/dataset-generator/export-training-data.js [--synthetic-count N] [--seed N] [--output-dir PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function randomChoice(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function buildNamedHexSet(colorNames) {
  const set = new Set();
  for (const palette of Object.values(palettes)) {
    for (const [name, hex] of Object.entries(palette)) {
      if (colorNames.has(name)) set.add(hex.toUpperCase());
    }
  }
  for (const [name, hex] of Object.entries(extraColors)) {
    if (colorNames.has(name)) set.add(hex.toUpperCase());
  }
  return set;
}

const DARK_NEUTRAL_HEXES = buildNamedHexSet(DARK_NEUTRAL_COLOR_NAMES);

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / delta + 2) / 6;
  else hue = ((r - g) / delta + 4) / 6;
  return [hue * 360, saturation, lightness];
}

function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }
  const hue2rgb = (p, q, t) => {
    let wrapped = t;
    if (wrapped < 0) wrapped += 1;
    if (wrapped > 1) wrapped -= 1;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  ];
}

function srgbByteToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(value) {
  const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * (value ** (1 / 2.4)) - 0.055;
  return clampByte(srgb * 255);
}

function hexToLinearRgb(hex) {
  const [r, g, b] = hexToRgb(hex);
  return [srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b)];
}

function linearRgbToHex(r, g, b) {
  return rgbToHex(linearToSrgbByte(r), linearToSrgbByte(g), linearToSrgbByte(b));
}

function linearRgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(Math.max(l, 1e-12));
  const mRoot = Math.cbrt(Math.max(m, 1e-12));
  const sRoot = Math.cbrt(Math.max(s, 1e-12));

  return [
    0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  ];
}

function oklabToLinearRgb([l, a, b]) {
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.2914855480 * b;

  const lCube = lPrime ** 3;
  const mCube = mPrime ** 3;
  const sCube = sPrime ** 3;

  return [
    Math.max(0, Math.min(1, 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube)),
    Math.max(0, Math.min(1, -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube)),
    Math.max(0, Math.min(1, -0.0041960863 * lCube - 0.7034186147 * mCube + 1.7076147010 * sCube)),
  ];
}

function hexToOklab(hex) {
  return linearRgbToOklab(hexToLinearRgb(hex));
}

function oklabToHex(lab) {
  const [r, g, b] = oklabToLinearRgb(lab);
  return linearRgbToHex(r, g, b);
}

function blendOklabHex(hex1, hex2, amount, chromaRetention = 1.0) {
  const left = hexToOklab(hex1);
  const right = hexToOklab(hex2);
  const t = Math.max(0, Math.min(1, amount));
  const mixed = [
    left[0] + (right[0] - left[0]) * t,
    (left[1] + (right[1] - left[1]) * t) * chromaRetention,
    (left[2] + (right[2] - left[2]) * t) * chromaRetention,
  ];
  return oklabToHex(mixed);
}

function hueDistanceDegrees(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function interpolateHueDegrees(from, to, amount) {
  return (from + hueDistanceDegrees(from, to) * amount + 360) % 360;
}

function spectralMix(hexes, parts) {
  const total = parts.reduce((sum, part) => sum + part, 0);
  const args = hexes.map((hex, index) => [
    new spectral.Color(hex),
    parts[index] / total,
  ]);
  return spectral.mix(...args).toString().toUpperCase();
}

function isReddish(r, g, b) {
  return r > g * 1.3 && r > b * 1.2 && r > 60;
}

function isYellowish(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 40 && h <= 78 && s >= 0.35 && l >= 0.18;
}

function isBluePaintLike(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 180 && h <= 255 && s >= 0.22 && l >= 0.05 && l <= 0.75;
}

function isMagentaLike(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 285 && h <= 345 && s >= 0.22 && l >= 0.08;
}

function isOrangeLike(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 12 && h <= 42 && s >= 0.18 && l >= 0.10 && l <= 0.78;
}

function isBrownLike(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 12 && h <= 48 && s >= 0.16 && l >= 0.08 && l <= 0.48 && r > b * 1.05;
}

function isNearWhiteHex(hex) {
  const [r, g, b] = hexToRgb(hex);
  return Math.min(r, g, b) >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 36;
}

function isNearBlackHex(hex) {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) <= 40;
}

function isDarkNeutralHex(hex) {
  return DARK_NEUTRAL_HEXES.has(hex.toUpperCase());
}

function isRedBluePair(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return (isReddish(r1, g1, b1) && isBluePaintLike(r2, g2, b2)) ||
    (isReddish(r2, g2, b2) && isBluePaintLike(r1, g1, b1));
}

function isYellowBluePair(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return (isYellowish(r1, g1, b1) && isBluePaintLike(r2, g2, b2)) ||
    (isYellowish(r2, g2, b2) && isBluePaintLike(r1, g1, b1));
}

function isYellowMagentaPair(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return (isYellowish(r1, g1, b1) && isMagentaLike(r2, g2, b2)) ||
    (isYellowish(r2, g2, b2) && isMagentaLike(r1, g1, b1));
}

function isRedYellowPair(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return (isReddish(r1, g1, b1) && isYellowish(r2, g2, b2)) ||
    (isReddish(r2, g2, b2) && isYellowish(r1, g1, b1));
}

function findManualOpponentRule(hexes) {
  if (hexes.length !== 2) return null;
  return MANUAL_OPPONENT_RULE_BY_PAIR_KEY.get(canonicalHexPairKey(hexes)) || null;
}

function brightenPurple(spectralHex) {
  const [r, g, b] = hexToRgb(spectralHex);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l > 0.35) return spectralHex;

  const targetL = Math.max(l, 0.22 + (0.35 - 0.22) * Math.min(s * 2, 1));
  const targetS = Math.max(s, 0.30);
  const [nr, ng, nb] = hslToRgb(h, targetS, targetL);
  return rgbToHex(nr, ng, nb);
}

function exactManualOpponentTarget(targetPath, coolShare) {
  if (!targetPath) return null;

  const clampedCoolShare = Math.max(0, Math.min(1, coolShare));
  const warmDominantShare = 1 / 3;
  const balancedShare = 1 / 2;
  const coolDominantShare = 2 / 3;

  // Exact whitelist pairs get a smooth hand-shaped path through 2:1, 1:1, and 1:2
  // so the equal-mix target does not jump away from its neighboring ratios.
  if (clampedCoolShare <= warmDominantShare) return targetPath.dominantA;
  if (clampedCoolShare >= coolDominantShare) return targetPath.dominantB;
  if (clampedCoolShare <= balancedShare) {
    return blendOklabHex(
      targetPath.dominantA,
      targetPath.balanced,
      (clampedCoolShare - warmDominantShare) / (balancedShare - warmDominantShare),
    );
  }
  return blendOklabHex(
    targetPath.balanced,
    targetPath.dominantB,
    (clampedCoolShare - balancedShare) / (coolDominantShare - balancedShare),
  );
}

function shareOfRuleSecondEntry(hexes, parts, rule) {
  if (!rule || hexes.length !== 2 || parts.length !== 2 || !Array.isArray(rule.hexes) || rule.hexes.length !== 2) {
    return 0.5;
  }
  const total = Math.max(1, parts[0] + parts[1]);
  const secondHex = rule.hexes[1].toUpperCase();
  if (hexes[0].toUpperCase() === secondHex) return parts[0] / total;
  if (hexes[1].toUpperCase() === secondHex) return parts[1] / total;
  return 0.5;
}

function correctedManualPathTarget(spectralHex, hexes, parts, rule) {
  if (!rule || rule.kind !== 'path') return spectralHex;
  const secondEntryShare = shareOfRuleSecondEntry(hexes, parts, rule);
  return exactManualOpponentTarget(rule.targetPath, secondEntryShare) || spectralHex;
}

function correctedYellowBlueTarget(spectralHex, hexes, parts) {
  if (hexes.length !== 2 || !isYellowBluePair(hexes[0], hexes[1])) return spectralHex;

  const [r1, g1, b1] = hexToRgb(hexes[0]);
  const firstIsBlue = isBluePaintLike(r1, g1, b1);
  const blueIndex = firstIsBlue ? 0 : 1;
  const total = Math.max(1, parts[0] + parts[1]);
  const blueShare = parts[blueIndex] / total;
  const balance = 1.0 - Math.abs(1.0 - 2.0 * blueShare);

  const [r, g, b] = hexToRgb(spectralHex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const targetHue = 100 + 30 * blueShare;
  const targetS = Math.max(s, 0.32 + 0.16 * balance);
  const targetL = Math.max(l, 0.26 + 0.14 * balance);
  const hueError = Math.min(1, Math.abs(hueDistanceDegrees(h, targetHue)) / 55);
  const satError = Math.min(1, Math.max(0, targetS - s) / 0.28);
  const lightError = Math.min(1, Math.max(0, targetL - l) / 0.22);

  if (h >= 110 && h <= 145 && s >= 0.26 && l >= 0.18) {
    return spectralHex;
  }
  if (Math.abs(hueDistanceDegrees(h, targetHue)) < 8 && s >= targetS - 0.05 && l >= targetL - 0.04) {
    return spectralHex;
  }

  const blend = Math.min(0.82, 0.10 + 0.44 * hueError + 0.24 * satError + 0.16 * lightError);
  const nh = interpolateHueDegrees(h, targetHue, blend);
  const ns = s + (targetS - s) * blend;
  const nl = l + (targetL - l) * blend;
  const [nr, ng, nb] = hslToRgb(nh, ns, nl);
  return rgbToHex(nr, ng, nb);
}

function correctedRedYellowTarget(spectralHex, hexes, parts) {
  if (hexes.length !== 2 || !isRedYellowPair(hexes[0], hexes[1])) return spectralHex;

  const [r1, g1, b1] = hexToRgb(hexes[0]);
  const firstIsRed = isReddish(r1, g1, b1);
  const redIndex = firstIsRed ? 0 : 1;
  const total = Math.max(1, parts[0] + parts[1]);
  const redShare = parts[redIndex] / total;
  const yellowShare = 1.0 - redShare;
  const balance = 1.0 - Math.abs(1.0 - 2.0 * redShare);

  const [r, g, b] = hexToRgb(spectralHex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const targetHue = 14 + 32 * yellowShare;
  const targetS = Math.max(s, 0.42 + 0.16 * balance);
  const targetL = Math.max(l, 0.28 + 0.16 * yellowShare + 0.06 * balance);
  const hueError = Math.min(1, Math.abs(hueDistanceDegrees(h, targetHue)) / 48);
  const satError = Math.min(1, Math.max(0, targetS - s) / 0.25);
  const lightError = Math.min(1, Math.max(0, targetL - l) / 0.20);

  if (h >= 12 && h <= 52 && s >= targetS - 0.05 && l >= targetL - 0.04) {
    return spectralHex;
  }

  const blend = Math.min(0.78, 0.10 + 0.42 * hueError + 0.20 * satError + 0.14 * lightError);
  const nh = interpolateHueDegrees(h, targetHue, blend);
  const ns = s + (targetS - s) * blend;
  const nl = l + (targetL - l) * blend;
  const [nr, ng, nb] = hslToRgb(nh, ns, nl);
  return rgbToHex(nr, ng, nb);
}

function correctedPurpleOpponentTarget(spectralHex, hexes, parts, rule) {
  if (!rule || rule.kind !== 'purple') return spectralHex;

  const [r1, g1, b1] = hexToRgb(hexes[0]);
  const total = Math.max(1, parts[0] + parts[1]);
  const coolShare = (isReddish(r1, g1, b1) ? parts[1] : parts[0]) / total;
  const exactTarget = exactManualOpponentTarget(rule.targetPath, coolShare);
  if (exactTarget) {
    return exactTarget;
  }
  const [ar, ag, ab] = hexToRgb(brightenPurple(spectralHex));
  const [, , anchorL] = rgbToHsl(ar, ag, ab);

  if (Math.abs(coolShare - 0.5) < 1e-6) {
    return brightenPurple(spectralHex);
  }

  const targetHue = 352 - 72 * coolShare;
  const targetS = 0.26 + 0.12 * (1.0 - Math.abs(1.0 - 2.0 * coolShare));
  const targetL = Math.max(0.24, Math.min(0.46, anchorL + 0.01));
  const pathTarget = rgbToHex(...hslToRgb(targetHue, targetS, targetL));
  return blendOklabHex(brightenPurple(spectralHex), pathTarget, 0.76, 0.98);
}

function correctedEarthOpponentTarget(spectralHex, hexes, parts, rule) {
  if (!rule || rule.kind !== 'earth') return spectralHex;

  const [r1, g1, b1] = hexToRgb(hexes[0]);
  const warmIndex = (isOrangeLike(r1, g1, b1) || isBrownLike(r1, g1, b1)) ? 0 : 1;
  const coolIndex = 1 - warmIndex;
  const total = Math.max(1, parts[0] + parts[1]);
  const coolShare = parts[coolIndex] / total;
  const exactTarget = exactManualOpponentTarget(rule.targetPath, coolShare);
  if (exactTarget) {
    return exactTarget;
  }
  const warmShare = 1.0 - coolShare;
  const warmIsBrown = isBrownLike(...hexToRgb(hexes[warmIndex]));
  const [ar, ag, ab] = hexToRgb(spectralHex);
  const [, , anchorL] = rgbToHsl(ar, ag, ab);

  if (Math.abs(coolShare - 0.5) < 1e-6) {
    return spectralHex;
  }

  if (coolShare > 0.5) {
    const coolTarget = rgbToHex(...hslToRgb(
      warmIsBrown ? 228 : 220,
      warmIsBrown ? 0.26 : 0.14,
      Math.max(0.18, Math.min(0.42, anchorL - 0.01)),
    ));
    return blendOklabHex(spectralHex, coolTarget, 0.78, 0.92);
  }

  const warmTarget = rgbToHex(...hslToRgb(
    warmIsBrown ? 24 : 28,
    warmIsBrown ? 0.30 : 0.42,
    Math.max(0.18, Math.min(0.48, anchorL + 0.02 * warmShare)),
  ));
  return blendOklabHex(spectralHex, warmTarget, 0.74, 0.94);
}

function correctedTintShadeTarget(spectralHex, hexes, parts) {
  if (hexes.length !== 2) return spectralHex;

  const whiteFlags = hexes.map(isNearWhiteHex);
  const blackFlags = hexes.map(isNearBlackHex);
  const darkNeutralFlags = hexes.map(isDarkNeutralHex);
  const total = Math.max(1, parts[0] + parts[1]);

  if ((whiteFlags[0] && blackFlags[1]) || (whiteFlags[1] && blackFlags[0])) {
    const whiteIndex = whiteFlags[0] ? 0 : 1;
    const whiteShare = parts[whiteIndex] / total;
    const intensifiedWhiteShare = 1 - ((1 - whiteShare) ** 1.20);
    return blendOklabHex(hexes[1 - whiteIndex], hexes[whiteIndex], intensifiedWhiteShare, 1.0);
  }

  if (whiteFlags.some(Boolean)) {
    const whiteIndex = whiteFlags[0] ? 0 : 1;
    const colorIndex = 1 - whiteIndex;
    const whiteShare = parts[whiteIndex] / total;
    const intensifiedWhiteShare = 1 - ((1 - whiteShare) ** 1.16);
    const ideal = blendOklabHex(hexes[colorIndex], hexes[whiteIndex], intensifiedWhiteShare, 1.06);
    return blendOklabHex(spectralHex, ideal, 0.84, 1.0);
  }

  if (blackFlags.some(Boolean)) {
    const blackIndex = blackFlags[0] ? 0 : 1;
    const colorIndex = 1 - blackIndex;
    const blackShare = parts[blackIndex] / total;
    const intensifiedShare = 1 - ((1 - blackShare) ** 1.45);
    const ideal = blendOklabHex(hexes[colorIndex], hexes[blackIndex], intensifiedShare, 0.92);
    return blendOklabHex(spectralHex, ideal, 0.84, 1.0);
  }

  if (darkNeutralFlags.some(Boolean)) {
    const neutralIndex = darkNeutralFlags[0] ? 0 : 1;
    const colorIndex = 1 - neutralIndex;
    const neutralShare = parts[neutralIndex] / total;
    const intensifiedShare = 1 - ((1 - neutralShare) ** 1.28);
    const ideal = blendOklabHex(hexes[colorIndex], hexes[neutralIndex], intensifiedShare, 0.95);
    return blendOklabHex(spectralHex, ideal, 0.76, 1.0);
  }

  return spectralHex;
}

function adjustedTeacherTarget(hexes, parts) {
  let target = spectralMix(hexes, parts);
  const manualOpponentRule = findManualOpponentRule(hexes);
  if (hexes.length === 2 && parts[0] === parts[1] && isRedBluePair(hexes[0], hexes[1])) {
    target = brightenPurple(target);
  }
  target = correctedYellowBlueTarget(target, hexes, parts);
  target = correctedRedYellowTarget(target, hexes, parts);
  target = correctedManualPathTarget(target, hexes, parts, manualOpponentRule);
  target = correctedPurpleOpponentTarget(target, hexes, parts, manualOpponentRule);
  target = correctedEarthOpponentTarget(target, hexes, parts, manualOpponentRule);
  target = correctedTintShadeTarget(target, hexes, parts);
  return target;
}

function allPaletteColors() {
  return Object.values(palettes).flatMap((palette) => Object.values(palette));
}

function allNamedColors() {
  const values = [];
  for (const [paletteName, colors] of Object.entries(palettes)) {
    for (const [name, hex] of Object.entries(colors)) {
      values.push({ source: paletteName, name, hex });
    }
  }
  for (const [name, hex] of Object.entries(extraColors)) {
    values.push({ source: 'extra', name, hex });
  }
  return values;
}

function randomHueHex(rng, hueMin, hueMax, saturationRange, lightnessRange) {
  const hue = hueMin + rng() * (hueMax - hueMin);
  const saturation = saturationRange[0] + rng() * (saturationRange[1] - saturationRange[0]);
  const lightness = lightnessRange[0] + rng() * (lightnessRange[1] - lightnessRange[0]);
  const [r, g, b] = hslToRgb(hue, saturation, lightness);
  return rgbToHex(r, g, b);
}

function randomGeneralHex(rng) {
  if (rng() < 0.35) return randomChoice(rng, allPaletteColors());
  const [r, g, b] = hslToRgb(rng() * 360, 0.15 + rng() * 0.85, 0.08 + rng() * 0.82);
  return rgbToHex(r, g, b);
}

function randomReddishHex(rng, dark = false) {
  return randomHueHex(
    rng,
    rng() < 0.5 ? 345 : 0,
    rng() < 0.5 ? 360 : 20,
    [0.45, 1.0],
    dark ? [0.10, 0.38] : [0.18, 0.60],
  );
}

function randomBluishHex(rng, dark = false) {
  return randomHueHex(rng, 215, 260, [0.45, 1.0], dark ? [0.08, 0.32] : [0.16, 0.55]);
}

function randomYellowishHex(rng) {
  return randomHueHex(rng, 45, 72, [0.55, 1.0], [0.28, 0.72]);
}

function randomPart(rng) {
  return randomChoice(rng, [1, 1, 1, 2, 2, 3, 4]);
}

function createSample({ inputs, parts, target, source, category, palette, label, teacher }) {
  return {
    inputs: inputs.map((hex) => hex.toUpperCase()),
    parts: parts.slice(),
    target: target.toUpperCase(),
    source,
    teacher,
    category,
    palette,
    label,
  };
}

function buildCuratedSamples() {
  const samples = [];
  const addCurated = (hexes, parts, category, palette, label) => {
    samples.push(createSample({
      inputs: hexes,
      parts,
      target: adjustedTeacherTarget(hexes, parts),
      source: 'curated',
      teacher: 'spectral_js_adjusted',
      category,
      palette,
      label,
    }));
  };
  const addGuardrailRamp = (hexes, category, palette, labelBase, ratios = HUE_GUARDRAIL_RATIO_PAIRS) => {
    for (const [leftPart, rightPart] of ratios) {
      addCurated(hexes, [leftPart, rightPart], category, palette, `${labelBase}@${leftPart}:${rightPart}`);
    }
  };
  const addIterativeTintShadeChain = (baseHex, tintHex, category, palette, labelBase) => {
    let currentHex = adjustedTeacherTarget([baseHex, tintHex], [1, 1]);
    for (const step of ITERATIVE_TINT_SHADE_CHAIN_STEPS) {
      addCurated([currentHex, tintHex], [1, 1], category, palette, `${labelBase}_chain${step}`);
      currentHex = adjustedTeacherTarget([currentHex, tintHex], [1, 1]);
    }
  };

  const allUniqueColors = new Map();
  for (const [paletteName, colors] of Object.entries(palettes)) {
    for (const [name, hex] of Object.entries(colors)) {
      const upper = hex.toUpperCase();
      if (!allUniqueColors.has(upper)) {
        allUniqueColors.set(upper, { paletteName, name });
        addCurated([hex], [1], 'identity', paletteName, name);
      }
    }
  }
  for (const [name, hex] of Object.entries(extraColors)) {
    const upper = hex.toUpperCase();
    if (!allUniqueColors.has(upper)) addCurated([hex], [1], 'identity', 'extra', name);
  }

  for (const [paletteName, colors] of Object.entries(palettes)) {
    const entries = Object.entries(colors);
    const whiteEntry = entries.find(([name]) => name === 'white');
    const blackEntry = entries.find(([name]) => name === 'black');
    const chromaticEntries = entries.filter(([name]) => name !== 'white' && name !== 'black');
    const darkNeutralEntries = chromaticEntries.filter(([name]) => DARK_NEUTRAL_COLOR_NAMES.has(name));
    const colorfulEntries = chromaticEntries.filter(([name]) => !DARK_NEUTRAL_COLOR_NAMES.has(name));

    for (let left = 0; left < chromaticEntries.length; left += 1) {
      for (let right = left + 1; right < chromaticEntries.length; right += 1) {
        const [name1, hex1] = chromaticEntries[left];
        const [name2, hex2] = chromaticEntries[right];
        addCurated([hex1, hex2], [1, 1], 'chromatic', paletteName, `${name1}+${name2}`);
        if (isYellowBluePair(hex1, hex2)) {
          addGuardrailRamp([hex1, hex2], 'guardrail_yellow_blue', paletteName, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
        }
        if (isYellowMagentaPair(hex1, hex2)) {
          addGuardrailRamp([hex1, hex2], 'guardrail_yellow_magenta', paletteName, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
        }
        if (isRedYellowPair(hex1, hex2)) {
          addGuardrailRamp([hex1, hex2], 'guardrail_red_yellow', paletteName, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
        }
        const manualOpponentRule = findManualOpponentRule([hex1, hex2]);
        if (manualOpponentRule) {
          addGuardrailRamp([hex1, hex2], manualOpponentRule.category, paletteName, `${name1}+${name2}`, MANUAL_OPPONENT_RATIO_PAIRS);
        }
      }
    }

    if (whiteEntry) {
      for (const [name, hex] of chromaticEntries) {
        addCurated([hex, whiteEntry[1]], [1, 1], 'white_tint', paletteName, `${name}+white`);
        addGuardrailRamp([hex, whiteEntry[1]], 'guardrail_white_tint', paletteName, `${name}+white`, WHITE_GUARDRAIL_RATIO_PAIRS);
        addIterativeTintShadeChain(hex, whiteEntry[1], 'guardrail_white_tint_chain', paletteName, `${name}+white`);
      }
    }
    if (blackEntry) {
      for (const [name, hex] of chromaticEntries) {
        addCurated([hex, blackEntry[1]], [1, 1], 'black_shade', paletteName, `${name}+black`);
        addGuardrailRamp(
          [hex, blackEntry[1]],
          'guardrail_black_shade',
          paletteName,
          `${name}+black`,
          BLACK_GUARDRAIL_RATIO_PAIRS,
        );
        addIterativeTintShadeChain(hex, blackEntry[1], 'guardrail_black_shade_chain', paletteName, `${name}+black`);
      }
    }
    if (whiteEntry && blackEntry) {
      addCurated([whiteEntry[1], blackEntry[1]], [1, 1], 'neutral', paletteName, 'white+black');
      addGuardrailRamp(
        [whiteEntry[1], blackEntry[1]],
        'guardrail_neutral',
        paletteName,
        'white+black',
        NEUTRAL_GUARDRAIL_RATIO_PAIRS,
      );
      const neutralBaseHex = adjustedTeacherTarget([whiteEntry[1], blackEntry[1]], [1, 1]);
      addIterativeTintShadeChain(neutralBaseHex, whiteEntry[1], 'guardrail_white_tint_chain', paletteName, 'white+black_then_white');
      addIterativeTintShadeChain(neutralBaseHex, blackEntry[1], 'guardrail_black_shade_chain', paletteName, 'white+black_then_black');
    }

    for (const [neutralName, neutralHex] of darkNeutralEntries) {
      for (const [colorName, colorHex] of colorfulEntries) {
        addGuardrailRamp(
          [colorHex, neutralHex],
          'guardrail_dark_neutral',
          paletteName,
          `${colorName}+${neutralName}`,
          DARK_NEUTRAL_GUARDRAIL_RATIO_PAIRS,
        );
      }
    }
  }

  const extraEntries = Object.entries(extraColors);
  for (let left = 0; left < extraEntries.length; left += 1) {
    for (let right = left + 1; right < extraEntries.length; right += 1) {
      const [name1, hex1] = extraEntries[left];
      const [name2, hex2] = extraEntries[right];
      addCurated([hex1, hex2], [1, 1], 'chromatic', 'extra', `${name1}+${name2}`);
      if (isYellowBluePair(hex1, hex2)) {
        addGuardrailRamp([hex1, hex2], 'guardrail_yellow_blue', 'extra', `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
      }
      if (isYellowMagentaPair(hex1, hex2)) {
        addGuardrailRamp([hex1, hex2], 'guardrail_yellow_magenta', 'extra', `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
      }
      if (isRedYellowPair(hex1, hex2)) {
        addGuardrailRamp([hex1, hex2], 'guardrail_red_yellow', 'extra', `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
      }
      const manualOpponentRule = findManualOpponentRule([hex1, hex2]);
      if (manualOpponentRule) {
        addGuardrailRamp([hex1, hex2], manualOpponentRule.category, 'extra', `${name1}+${name2}`, MANUAL_OPPONENT_RATIO_PAIRS);
      }
    }
  }

  const crossPaletteSeen = new Set();
  const paletteNames = Object.keys(paletteKeyColors);
  for (let left = 0; left < paletteNames.length; left += 1) {
    for (let right = left + 1; right < paletteNames.length; right += 1) {
      const palette1 = paletteNames[left];
      const palette2 = paletteNames[right];
      const keys1 = Object.entries(paletteKeyColors[palette1]);
      const keys2 = Object.entries(paletteKeyColors[palette2]);
      for (const [role1, name1] of keys1) {
        for (const [role2, name2] of keys2) {
          if (role1 === role2) continue;
          const hex1 = palettes[palette1][name1];
          const hex2 = palettes[palette2][name2];
          const dedupeKey = [hex1, hex2].sort().join('|');
          if (crossPaletteSeen.has(dedupeKey)) continue;
          crossPaletteSeen.add(dedupeKey);
          addCurated([hex1, hex2], [1, 1], 'cross_palette', `${palette1}×${palette2}`, `${name1}+${name2}`);
          if (isYellowBluePair(hex1, hex2)) {
            addGuardrailRamp([hex1, hex2], 'guardrail_yellow_blue', `${palette1}×${palette2}`, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
          }
          if (isYellowMagentaPair(hex1, hex2)) {
            addGuardrailRamp([hex1, hex2], 'guardrail_yellow_magenta', `${palette1}×${palette2}`, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
          }
          if (isRedYellowPair(hex1, hex2)) {
            addGuardrailRamp([hex1, hex2], 'guardrail_red_yellow', `${palette1}×${palette2}`, `${name1}+${name2}`, HUE_GUARDRAIL_RATIO_PAIRS);
          }
          const manualOpponentRule = findManualOpponentRule([hex1, hex2]);
          if (manualOpponentRule) {
            addGuardrailRamp([hex1, hex2], manualOpponentRule.category, `${palette1}×${palette2}`, `${name1}+${name2}`, MANUAL_OPPONENT_RATIO_PAIRS);
          }
        }
      }
    }
  }

  for (const [paletteName, name1, name2, name3] of curatedThreeColorSets) {
    addCurated(
      [palettes[paletteName][name1], palettes[paletteName][name2], palettes[paletteName][name3]],
      [1, 1, 1],
      'three_color',
      paletteName,
      `${name1}+${name2}+${name3}`,
    );
  }

  return samples;
}

function buildSyntheticSamples(count, seed) {
  const rng = mulberry32(seed);
  const namedColorPool = allNamedColors();
  const samples = [];

  const addSynthetic = (inputs, parts, category, label) => {
    samples.push(createSample({
      inputs,
      parts,
      target: spectralMix(inputs, parts),
      source: 'synthetic',
      teacher: 'spectral_js',
      category,
      palette: 'synthetic',
      label,
    }));
  };

  for (let index = 0; index < count; index += 1) {
    const roll = rng();

    if (roll < 0.12) {
      const color = rng() < 0.5 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng);
      addSynthetic([color], [1], 'identity', `synthetic_identity_${index}`);
      continue;
    }

    if (roll < 0.32) {
      const dark = rng() < 0.45;
      addSynthetic(
        [randomReddishHex(rng, dark), randomBluishHex(rng, dark)],
        [randomPart(rng), randomPart(rng)],
        dark ? 'synthetic_dark_violet' : 'synthetic_violet',
        `synthetic_violet_${index}`,
      );
      continue;
    }

    if (roll < 0.46) {
      addSynthetic(
        [randomYellowishHex(rng), randomBluishHex(rng, rng() < 0.2)],
        [randomPart(rng), randomPart(rng)],
        'synthetic_yellow_blue',
        `synthetic_yellow_blue_${index}`,
      );
      continue;
    }

    if (roll < 0.58) {
      const colors = [
        rng() < 0.6 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng),
        rng() < 0.6 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng),
        rng() < 0.6 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng),
      ];
      addSynthetic(colors, [randomPart(rng), randomPart(rng), randomPart(rng)], 'synthetic_three_color', `synthetic_three_${index}`);
      continue;
    }

    addSynthetic(
      [
        rng() < 0.5 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng),
        rng() < 0.5 ? randomChoice(rng, namedColorPool).hex : randomGeneralHex(rng),
      ],
      [randomPart(rng), randomPart(rng)],
      'synthetic_random_pair',
      `synthetic_pair_${index}`,
    );
  }

  return samples;
}

function writeJsonl(filePath, samples) {
  const lines = samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n';
  writeFileSync(filePath, lines);
}

function summarise(samples) {
  const bySource = {};
  const byCategory = {};
  for (const sample of samples) {
    bySource[sample.source] = (bySource[sample.source] || 0) + 1;
    byCategory[sample.category] = (byCategory[sample.category] || 0) + 1;
  }
  return { bySource, byCategory, total: samples.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolve(process.cwd(), args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const curatedSamples = buildCuratedSamples();
  const syntheticSamples = buildSyntheticSamples(args.syntheticCount, args.seed);
  const manifest = {
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    syntheticCount: args.syntheticCount,
    curated: summarise(curatedSamples),
    synthetic: summarise(syntheticSamples),
  };

  const curatedPath = resolve(outputDir, 'curated.jsonl');
  const syntheticPath = resolve(outputDir, 'synthetic.jsonl');
  const manifestPath = resolve(outputDir, 'manifest.json');

  writeJsonl(curatedPath, curatedSamples);
  writeJsonl(syntheticPath, syntheticSamples);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.error(`Wrote ${curatedSamples.length} curated samples to ${curatedPath}`);
  console.error(`Wrote ${syntheticSamples.length} synthetic samples to ${syntheticPath}`);
  console.error(`Wrote manifest to ${manifestPath}`);
}

main();
