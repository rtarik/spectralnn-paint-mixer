import { SrgbColor } from './srgb-color.js';

const MAX_COLORS = 3;
const BASE_INPUT_DIM = 20;
const PHYSICAL_INPUT_DIM = 3;
const OUTPUT_DIM = 3;
const EPSILON = 1e-12;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * (channel ** (1 / 2.4)) - 0.055;
}

function colorToLinearRgb(color) {
  return [
    srgbChannelToLinear(color.red),
    srgbChannelToLinear(color.green),
    srgbChannelToLinear(color.blue),
  ];
}

function luminance(rgb) {
  return (
    0.21263900587151033 * rgb[0] +
    0.7151686787677553 * rgb[1] +
    0.07219231536073373 * rgb[2]
  );
}

function chroma(rgb) {
  const maxChannel = Math.max(rgb[0], rgb[1], rgb[2]);
  if (maxChannel <= 1e-8) return 0;
  const minChannel = Math.min(rgb[0], rgb[1], rgb[2]);
  return clamp((maxChannel - minChannel) / maxChannel, 0, 1);
}

function colorRoleScores(rgb) {
  const maxChannel = Math.max(rgb[0], rgb[1], rgb[2]);
  if (maxChannel <= 1e-8) return [0, 0, 0];

  const normalisedR = rgb[0] / maxChannel;
  const normalisedG = rgb[1] / maxChannel;
  const normalisedB = rgb[2] / maxChannel;
  const redScore = clamp(normalisedR - 0.5 * (normalisedG + normalisedB), 0, 1);
  const blueScore = clamp(normalisedB - 0.5 * (normalisedR + normalisedG), 0, 1);
  const yellowScore = clamp(Math.min(normalisedR, normalisedG) * (1 - normalisedB), 0, 1);
  return [redScore, blueScore, yellowScore];
}

function darkChromaticWeight(rgb) {
  const luma = luminance(rgb);
  const colorfulness = chroma(rgb);
  const chromaWeight = clamp((colorfulness - 0.45) / 0.55, 0, 1);
  const luminanceWeight = clamp((0.35 - luma) / 0.35, 0, 1);
  return chromaWeight * luminanceWeight;
}

function pairStresses(entries) {
  let violet = 0;
  let yellowBlue = 0;
  let dark = 0;
  if (entries.length < 2) return [violet, yellowBlue, dark];

  for (let leftIndex = 0; leftIndex < entries.length - 1; leftIndex += 1) {
    const left = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      const pairBalance = Math.sqrt(clamp((left.weight * right.weight) / 0.25, 0, 1));
      const chromaStress = Math.sqrt(left.chroma * right.chroma);
      const violetPair = Math.max(
        left.redScore * right.blueScore,
        left.blueScore * right.redScore,
      );
      const yellowBluePair = Math.max(
        left.blueScore * right.yellowScore,
        left.yellowScore * right.blueScore,
      );
      violet = Math.max(violet, pairBalance * chromaStress * violetPair);
      yellowBlue = Math.max(yellowBlue, pairBalance * chromaStress * yellowBluePair);
      dark = Math.max(dark, pairBalance * Math.sqrt(left.darkWeight * right.darkWeight));
    }
  }

  return [violet, yellowBlue, dark];
}

function linearRgbToOklab(rgb) {
  const l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2];
  const m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2];
  const s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2];

  const lRoot = Math.max(l, EPSILON) ** (1 / 3);
  const mRoot = Math.max(m, EPSILON) ** (1 / 3);
  const sRoot = Math.max(s, EPSILON) ** (1 / 3);

  return [
    0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  ];
}

function colorToOklab(color) {
  return linearRgbToOklab(colorToLinearRgb(color));
}

function oklabToColor(lab) {
  const lPrime = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const mPrime = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const sPrime = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linearB = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return SrgbColor.fromUnitRgb(
    clamp(linearChannelToSrgb(clamp(linearR, 0, 1)), 0, 1),
    clamp(linearChannelToSrgb(clamp(linearG, 0, 1)), 0, 1),
    clamp(linearChannelToSrgb(clamp(linearB, 0, 1)), 0, 1),
  );
}

function denseLayer(input, weights, bias, activate) {
  const output = new Array(weights.length).fill(0);
  for (let rowIndex = 0; rowIndex < weights.length; rowIndex += 1) {
    const row = weights[rowIndex];
    let sum = bias[rowIndex];
    for (let columnIndex = 0; columnIndex < input.length; columnIndex += 1) {
      sum += row[columnIndex] * input[columnIndex];
    }
    output[rowIndex] = activate ? Math.tanh(sum) : sum;
  }
  return output;
}

function usesResidualModel(artifact) {
  return artifact.inputDim >= BASE_INPUT_DIM + PHYSICAL_INPUT_DIM;
}

function hasValidShapes(artifact) {
  return (
    artifact.inputDim >= BASE_INPUT_DIM &&
    artifact.featureMean.length === artifact.inputDim &&
    artifact.featureStd.length === artifact.inputDim &&
    artifact.targetMean.length === OUTPUT_DIM &&
    artifact.targetStd.length === OUTPUT_DIM &&
    artifact.w1.length === artifact.hiddenDims[0] &&
    artifact.w1.every((row) => row.length === artifact.inputDim) &&
    artifact.b1.length === artifact.hiddenDims[0] &&
    artifact.w2.length === artifact.hiddenDims[1] &&
    artifact.w2.every((row) => row.length === artifact.hiddenDims[0]) &&
    artifact.b2.length === artifact.hiddenDims[1] &&
    artifact.w3.length === OUTPUT_DIM &&
    artifact.w3.every((row) => row.length === artifact.hiddenDims[1]) &&
    artifact.b3.length === OUTPUT_DIM
  );
}

function buildFeatures(portions, physical, artifact) {
  const active = portions.filter((portion) => portion.parts > 0);
  const totalParts = Math.max(
    1,
    active.reduce((sum, portion) => sum + portion.parts, 0),
  );
  const entries = active
    .map((portion) => {
      const rgb = colorToLinearRgb(portion.color);
      const [redScore, blueScore, yellowScore] = colorRoleScores(rgb);
      return {
        rgb,
        weight: portion.parts / totalParts,
        luminance: luminance(rgb),
        chroma: chroma(rgb),
        redScore,
        blueScore,
        yellowScore,
        darkWeight: darkChromaticWeight(rgb),
      };
    })
    .sort((left, right) => (
      (right.weight - left.weight) ||
      (right.rgb[0] - left.rgb[0]) ||
      (right.rgb[1] - left.rgb[1]) ||
      (right.rgb[2] - left.rgb[2])
    ));

  const features = new Array(artifact.inputDim).fill(0);
  let featureIndex = 0;
  for (let slot = 0; slot < MAX_COLORS; slot += 1) {
    if (slot < entries.length) {
      const entry = entries[slot];
      features[featureIndex] = entry.rgb[0];
      features[featureIndex + 1] = entry.rgb[1];
      features[featureIndex + 2] = entry.rgb[2];
      features[featureIndex + 3] = entry.weight;
    }
    featureIndex += 4;
  }

  const weightedMeanRgb = [0, 0, 0];
  let weightedMeanLuminance = 0;
  for (const entry of entries) {
    weightedMeanRgb[0] += entry.rgb[0] * entry.weight;
    weightedMeanRgb[1] += entry.rgb[1] * entry.weight;
    weightedMeanRgb[2] += entry.rgb[2] * entry.weight;
    weightedMeanLuminance += entry.luminance * entry.weight;
  }
  const [violetStress, yellowBlueStress, darkStress] = pairStresses(entries);

  features[featureIndex] = entries.length / MAX_COLORS;
  featureIndex += 1;
  features[featureIndex] = weightedMeanRgb[0];
  features[featureIndex + 1] = weightedMeanRgb[1];
  features[featureIndex + 2] = weightedMeanRgb[2];
  featureIndex += 3;
  features[featureIndex] = weightedMeanLuminance;
  featureIndex += 1;
  features[featureIndex] = violetStress;
  featureIndex += 1;
  features[featureIndex] = yellowBlueStress;
  featureIndex += 1;
  features[featureIndex] = darkStress;
  featureIndex += 1;

  if (usesResidualModel(artifact) && artifact.inputDim >= BASE_INPUT_DIM + PHYSICAL_INPUT_DIM) {
    const physicalLab = colorToOklab(physical);
    features[featureIndex] = physicalLab[0];
    features[featureIndex + 1] = physicalLab[1];
    features[featureIndex + 2] = physicalLab[2];
  }

  return features;
}

export function predictBlended({ portions, physical, artifact, blend }) {
  if (!hasValidShapes(artifact)) return null;

  const amount = clamp(blend, 0, 1);
  if (amount <= 0) return physical;

  const active = portions.filter((portion) => portion.parts > 0);
  if (active.length === 0) return null;
  if (active.length > MAX_COLORS) return null;

  const features = buildFeatures(portions, physical, artifact);
  const standardised = new Array(artifact.inputDim);
  for (let index = 0; index < artifact.inputDim; index += 1) {
    standardised[index] = (
      features[index] - artifact.featureMean[index]
    ) / artifact.featureStd[index];
  }

  const hidden1 = denseLayer(standardised, artifact.w1, artifact.b1, true);
  const hidden2 = denseLayer(hidden1, artifact.w2, artifact.b2, true);
  const output = denseLayer(hidden2, artifact.w3, artifact.b3, false);
  const outputVector = new Array(OUTPUT_DIM);
  for (let index = 0; index < OUTPUT_DIM; index += 1) {
    outputVector[index] = output[index] * artifact.targetStd[index] + artifact.targetMean[index];
  }

  if (usesResidualModel(artifact)) {
    const physicalLab = colorToOklab(physical);
    const correctedLab = new Array(OUTPUT_DIM);
    for (let index = 0; index < OUTPUT_DIM; index += 1) {
      correctedLab[index] = physicalLab[index] + outputVector[index] * amount;
    }
    return oklabToColor(correctedLab);
  }

  const learned = oklabToColor(outputVector);
  return blendWithPhysical(physical, learned, amount);
}

export function blendWithPhysical(physical, learned, blend) {
  const amount = clamp(blend, 0, 1);
  if (amount <= 0) return physical;
  if (amount >= 1) return learned;

  const physicalLab = colorToOklab(physical);
  const learnedLab = colorToOklab(learned);
  const blended = new Array(OUTPUT_DIM);
  for (let index = 0; index < OUTPUT_DIM; index += 1) {
    blended[index] = physicalLab[index] + (learnedLab[index] - physicalLab[index]) * amount;
  }
  return oklabToColor(blended);
}
