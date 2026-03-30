import { SrgbColor } from './srgb-color.js';
import {
  BASE_B,
  BASE_G,
  BASE_M,
  BASE_R,
  BASE_W,
  BASE_Y,
  FIXED_CHROMATIC_BASES,
  LEARNED_DARK_VIOLET_KS_RESIDUAL_BASIS,
  LEARNED_DARK_VIOLET_MIX_RESIDUAL_BASIS,
  LEARNED_GREEN_MIX_RESIDUAL_BASIS,
  LEARNED_VIOLET_KS_RESIDUAL_BASIS,
  LEARNED_VIOLET_MIX_RESIDUAL_BASIS,
  SPECTRAL_SAMPLES,
  SRGB_D65_TO_XYZ,
  X_BAR,
  XYZ_TO_SRGB_D65,
  Y_BAR,
  Z_BAR,
} from './spectral-basis-data.js';

const N = SPECTRAL_SAMPLES * 2;
const EPSILON = 1e-6;
const MIXING_EPSILON = 1e-12;
const NEUTRAL_LINEAR_TOLERANCE = 1e-4;
const MAX_ITERATIONS = 20;
const BASIS_DEFORMATION_FRACTION = 0.35;

const WAVELENGTH_T = Array.from(
  { length: SPECTRAL_SAMPLES },
  (_, index) => index / (SPECTRAL_SAMPLES - 1),
);

const XYZ_BASIS = [X_BAR, Y_BAR, Z_BAR];
const XYZ_GRAM = Array.from({ length: 3 }, (_, row) => (
  Array.from({ length: 3 }, (_, col) => spectralDot(XYZ_BASIS[row], XYZ_BASIS[col]))
));
const BASE_MAGENTA_LUMINANCE = Math.max(spectralDot(BASE_M, Y_BAR), EPSILON);
const BASE_GREEN_LUMINANCE = Math.max(spectralDot(BASE_G, Y_BAR), EPSILON);

const RED_RESIDUAL_BASIS = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.84, 0.12) - 0.22 * gaussian(t, 0.55, 0.18) - 0.08 * gaussian(t, 0.22, 0.16);
  }),
);

const BLUE_RESIDUAL_BASIS = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.16, 0.10) - 0.22 * gaussian(t, 0.46, 0.18) - 0.08 * gaussian(t, 0.78, 0.16);
  }),
);

const MAGENTA_RESIDUAL_BASIS = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.15, 0.10) + gaussian(t, 0.85, 0.10) - 0.30 * gaussian(t, 0.52, 0.16);
  }),
);

const BASIS_BLUE_REGION_RESIDUAL = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.18, 0.09) - 0.40 * gaussian(t, 0.50, 0.18) - 0.10 * gaussian(t, 0.82, 0.20);
  }),
);

const BASIS_GREEN_REGION_RESIDUAL = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.52, 0.10) - 0.22 * gaussian(t, 0.20, 0.18) - 0.22 * gaussian(t, 0.84, 0.18);
  }),
);

const BASIS_RED_REGION_RESIDUAL = xyzNullResidualBasis(
  Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return gaussian(t, 0.84, 0.09) - 0.40 * gaussian(t, 0.52, 0.18) - 0.10 * gaussian(t, 0.18, 0.20);
  }),
);

const LEARNABLE_BASIS_RESIDUALS = [
  BASIS_BLUE_REGION_RESIDUAL,
  BASIS_GREEN_REGION_RESIDUAL,
  BASIS_RED_REGION_RESIDUAL,
];

const BASIS_DEFORMATION_LIMITS = FIXED_CHROMATIC_BASES.map((base) => (
  LEARNABLE_BASIS_RESIDUALS.map((residual) => basisResidualLimits(base, residual))
));

export function createSpectralData(params) {
  let cachedChromaticBasisParams = null;
  let cachedChromaticBases = null;

  function colorToMixSpace(color) {
    return withSpectralParameters(params, () => {
      const linearRgb = colorToLinearRgb(color);
      const pigment = estimatePigment(linearRgb);
      return Array.from({ length: N }, (_, index) => (
        index < SPECTRAL_SAMPLES
          ? pigment.absorption[index]
          : pigment.scattering[index - SPECTRAL_SAMPLES]
      ));
    });
  }

  function colorToReflectance(color) {
    return withSpectralParameters(params, () => reconstructReflectance(colorToLinearRgb(color)));
  }

  function colorComplementaryProfile(color) {
    return complementaryMixProfile(colorToLinearRgb(color));
  }

  function mixSpaceToColor(mixSpace) {
    return reflectanceToColor(mixSpaceToReflectance(mixSpace));
  }

  function reflectanceToColor(reflectance) {
    const xyz = reflectanceToXyz(reflectance);
    const linearRgb = multiply3x3Vector(XYZ_TO_SRGB_D65, xyz);
    return SrgbColor.fromUnitRgb(
      clamp(linearChannelToSrgb(clamp(linearRgb[0], 0, 1)), 0, 1),
      clamp(linearChannelToSrgb(clamp(linearRgb[1], 0, 1)), 0, 1),
      clamp(linearChannelToSrgb(clamp(linearRgb[2], 0, 1)), 0, 1),
    );
  }

  function reflectanceLuminance(reflectance) {
    return clamp(reflectanceToXyz(reflectance)[1], 0, 1);
  }

  function mixPreparedToColor({
    mixSpaces,
    reflectances,
    darkChromaticWeights,
    reflectanceLuminances,
    complementaryProfiles,
    parts,
  }) {
    const reflectance = mixPreparedReflectance({
      mixSpaces,
      reflectances,
      darkChromaticWeights,
      reflectanceLuminances,
      complementaryProfiles,
      parts,
    });
    return reflectance == null ? null : reflectanceToColor(reflectance);
  }

  function mixPreparedReflectance({
    mixSpaces,
    reflectances,
    darkChromaticWeights,
    reflectanceLuminances,
    complementaryProfiles,
    parts,
  }) {
    const activeIndices = parts.flatMap((part, index) => (part > 0 ? [index] : []));
    if (activeIndices.length === 0) return null;
    if (activeIndices.length === 1) return reflectances[activeIndices[0]].slice();

    const spectralJsBlend = clamp(params.spectralJsKsMixBlend, 0, 1);
    const customReflectance = spectralJsBlend >= 1 - EPSILON
      ? null
      : mixPreparedCustomReflectance(mixSpaces, darkChromaticWeights, parts, activeIndices);
    const spectralJsReflectance = spectralJsBlend <= EPSILON
      ? null
      : mixPreparedSpectralJsReflectance(reflectances, reflectanceLuminances, parts, activeIndices);

    let mixedReflectance;
    if (customReflectance == null) {
      mixedReflectance = spectralJsReflectance ?? reflectances[activeIndices[0]];
    } else if (spectralJsReflectance == null) {
      mixedReflectance = customReflectance;
    } else {
      mixedReflectance = blendReflectance(customReflectance, spectralJsReflectance, spectralJsBlend);
    }

    const derivedResidualReflectance = applyDerivedResidualMixCorrection({
      reflectances,
      darkChromaticWeights,
      complementaryProfiles,
      parts,
      activeIndices,
      mixedReflectance,
    });

    const derivedKsResidualReflectance = applyDerivedKsMixCorrection({
      darkChromaticWeights,
      complementaryProfiles,
      parts,
      activeIndices,
      mixedReflectance: derivedResidualReflectance,
    });

    const opponentBlend = clamp(params.opponentPairBasisBlend, 0, 1);
    if (opponentBlend <= EPSILON) return derivedKsResidualReflectance;

    const accent = buildOpponentPairAccentReflectance({
      reflectances,
      reflectanceLuminances,
      complementaryProfiles,
      parts,
      activeIndices,
      mixedReflectance: derivedKsResidualReflectance,
    });
    if (accent == null) return derivedKsResidualReflectance;

    return blendReflectance(
      derivedKsResidualReflectance,
      accent.reflectance,
      opponentBlend * accent.stress,
    );
  }

  function partToEffectiveConcentration(part) {
    return part <= 0 ? 0 : part ** params.concentrationExponent;
  }

  function effectiveWeightToPartDomain(weight) {
    return Math.max(weight, 0) ** (1 / params.concentrationExponent);
  }

  function colorDarkChromaticWeight(color) {
    return withSpectralParameters(params, () => {
      const linearRgb = colorToLinearRgb(color);
      return darkChromaticWeight(linearChroma(linearRgb), linearLuminance(linearRgb));
    });
  }

  function absorptionPowerMeanExponentForStress(mixStress) {
    const baseExponent = params.absorptionPowerMeanExponent;
    const targetExponent = Math.min(baseExponent, params.darkChromaticAbsorptionPowerMeanExponent);
    if (targetExponent >= baseExponent) return baseExponent;
    return lerp(baseExponent, targetExponent, mixStress);
  }

  function darkChromaticScatteringEnvelopeBlendForStress(mixStress) {
    return clamp(params.darkChromaticScatteringEnvelopeBlend * mixStress, 0, 1);
  }

  function darkChromaticMixStressFromWeights(darkChromaticWeights, parts) {
    const activeIndices = parts.flatMap((part, index) => (part > 0 ? [index] : []));
    if (activeIndices.length < 2) return 0;

    const effectiveConcentrations = activeIndices.map((index) => partToEffectiveConcentration(parts[index]));
    const totalEffectiveConcentration = effectiveConcentrations.reduce((sum, value) => sum + value, 0);
    if (totalEffectiveConcentration <= EPSILON) return 0;

    let mixStress = 0;
    for (let leftIndex = 0; leftIndex < activeIndices.length - 1; leftIndex += 1) {
      const leftStress = clamp(darkChromaticWeights[activeIndices[leftIndex]], 0, 1);
      if (leftStress <= 0) continue;
      const leftWeight = effectiveConcentrations[leftIndex] / totalEffectiveConcentration;

      for (let rightIndex = leftIndex + 1; rightIndex < activeIndices.length; rightIndex += 1) {
        const rightStress = clamp(darkChromaticWeights[activeIndices[rightIndex]], 0, 1);
        if (rightStress <= 0) continue;
        const rightWeight = effectiveConcentrations[rightIndex] / totalEffectiveConcentration;
        const pairBalance = Math.sqrt(clamp((leftWeight * rightWeight) / 0.25, 0, 1));
        const pairStress = pairBalance * Math.sqrt(leftStress * rightStress);
        if (pairStress > mixStress) mixStress = pairStress;
      }
    }

    return mixStress;
  }

  function opponentMixStress(complementaryProfiles, parts, activeIndices = null) {
    const resolvedActiveIndices = activeIndices ?? parts.flatMap((part, index) => (part > 0 ? [index] : []));
    if (resolvedActiveIndices.length < 2) {
      return { violet: 0, green: 0 };
    }

    const effectiveConcentrations = resolvedActiveIndices.map((index) => partToEffectiveConcentration(parts[index]));
    const totalEffectiveConcentration = effectiveConcentrations.reduce((sum, value) => sum + value, 0);
    if (totalEffectiveConcentration <= EPSILON) {
      return { violet: 0, green: 0 };
    }

    let violetStress = 0;
    let greenStress = 0;
    for (let leftIndex = 0; leftIndex < resolvedActiveIndices.length - 1; leftIndex += 1) {
      const leftProfile = complementaryProfiles[resolvedActiveIndices[leftIndex]];
      if (leftProfile.chroma <= 0) continue;
      const leftWeight = effectiveConcentrations[leftIndex] / totalEffectiveConcentration;

      for (let rightIndex = leftIndex + 1; rightIndex < resolvedActiveIndices.length; rightIndex += 1) {
        const rightProfile = complementaryProfiles[resolvedActiveIndices[rightIndex]];
        if (rightProfile.chroma <= 0) continue;
        const rightWeight = effectiveConcentrations[rightIndex] / totalEffectiveConcentration;
        const pairBalance = Math.sqrt(clamp((leftWeight * rightWeight) / 0.25, 0, 1));
        const chromaStress = clamp(Math.sqrt(leftProfile.chroma * rightProfile.chroma), 0, 1);
        const violetPair = Math.max(
          leftProfile.redScore * rightProfile.blueScore,
          leftProfile.blueScore * rightProfile.redScore,
        );
        const greenPair = Math.max(
          leftProfile.blueScore * rightProfile.yellowScore,
          leftProfile.yellowScore * rightProfile.blueScore,
        );
        violetStress = Math.max(violetStress, pairBalance * chromaStress * violetPair);
        greenStress = Math.max(greenStress, pairBalance * chromaStress * greenPair);
      }
    }

    return { violet: violetStress, green: greenStress };
  }

  function buildOpponentPairAccentReflectance({
    reflectances,
    reflectanceLuminances,
    complementaryProfiles,
    parts,
    activeIndices,
    mixedReflectance,
  }) {
    if (activeIndices.length < 2) return null;

    const effectiveConcentrations = activeIndices.map((index) => partToEffectiveConcentration(parts[index]));
    const totalEffectiveConcentration = effectiveConcentrations.reduce((sum, value) => sum + value, 0);
    if (totalEffectiveConcentration <= EPSILON) return null;

    let { violet: violetStress, green: greenStress } = opponentMixStress(complementaryProfiles, parts, activeIndices);
    let weightedInputLuminance = 0;
    for (let index = 0; index < activeIndices.length; index += 1) {
      weightedInputLuminance +=
        (effectiveConcentrations[index] / totalEffectiveConcentration) *
        reflectanceLuminances[activeIndices[index]];
    }

    const combinedStress = Math.max(violetStress, greenStress);
    if (combinedStress <= EPSILON) return null;

    const totalStress = violetStress + greenStress;
    const violetWeight = totalStress <= EPSILON ? 0 : violetStress / totalStress;
    const greenWeight = totalStress <= EPSILON ? 0 : greenStress / totalStress;

    const baseLuminance = reflectanceLuminance(mixedReflectance);
    const targetLuminance = lerp(
      baseLuminance,
      Math.max(baseLuminance, weightedInputLuminance),
      params.opponentPairBasisLuminanceLift * combinedStress,
    );

    const magentaBasis = luminanceMatchedBasisReflectance(BASE_M, BASE_MAGENTA_LUMINANCE, targetLuminance);
    const greenBasis = luminanceMatchedBasisReflectance(BASE_G, BASE_GREEN_LUMINANCE, targetLuminance);

    let accentReflectance;
    if (violetWeight <= EPSILON) {
      accentReflectance = greenBasis;
    } else if (greenWeight <= EPSILON) {
      accentReflectance = magentaBasis;
    } else {
      accentReflectance = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
        clamp(lerp(magentaBasis[index], greenBasis[index], greenWeight), EPSILON, 1)
      ));
    }

    return { reflectance: accentReflectance, stress: combinedStress };
  }

  function mixPreparedCustomReflectance(mixSpaces, darkChromaticWeights, parts, activeIndices) {
    const mixedMixSpace = new Array(N).fill(0);
    const maxScatteringEnvelope = new Array(SPECTRAL_SAMPLES).fill(0);
    const totalEffectiveConcentration = activeIndices.reduce(
      (sum, index) => sum + partToEffectiveConcentration(parts[index]),
      0,
    );
    const mixStress = darkChromaticMixStressFromWeights(darkChromaticWeights, parts);
    const p = absorptionPowerMeanExponentForStress(mixStress);
    const scatteringEnvelopeBlend = darkChromaticScatteringEnvelopeBlendForStress(mixStress);
    const invP = 1 / p;

    for (const index of activeIndices) {
      const weight = partToEffectiveConcentration(parts[index]) / totalEffectiveConcentration;
      const mixSpace = mixSpaces[index];
      for (let lambda = 0; lambda < SPECTRAL_SAMPLES; lambda += 1) {
        mixedMixSpace[lambda] += weight * ((mixSpace[lambda] + MIXING_EPSILON) ** p);
      }
      for (let lambda = SPECTRAL_SAMPLES; lambda < N; lambda += 1) {
        const scattering = mixSpace[lambda];
        mixedMixSpace[lambda] += weight * scattering;
        const scatteringIndex = lambda - SPECTRAL_SAMPLES;
        if (scattering > maxScatteringEnvelope[scatteringIndex]) {
          maxScatteringEnvelope[scatteringIndex] = scattering;
        }
      }
    }

    for (let lambda = 0; lambda < SPECTRAL_SAMPLES; lambda += 1) {
      mixedMixSpace[lambda] = Math.max(mixedMixSpace[lambda], 0) ** invP;
    }
    if (scatteringEnvelopeBlend > 0) {
      for (let lambda = SPECTRAL_SAMPLES; lambda < N; lambda += 1) {
        const scatteringIndex = lambda - SPECTRAL_SAMPLES;
        const current = mixedMixSpace[lambda];
        const envelope = maxScatteringEnvelope[scatteringIndex];
        mixedMixSpace[lambda] = current + (envelope - current) * scatteringEnvelopeBlend;
      }
    }

    return mixSpaceToReflectance(mixedMixSpace);
  }

  function mixPreparedSpectralJsReflectance(reflectances, reflectanceLuminances, parts, activeIndices) {
    const mixedKs = new Array(SPECTRAL_SAMPLES).fill(0);
    let totalConcentration = 0;

    for (const index of activeIndices) {
      const factor = parts[index];
      const concentration = factor * factor * Math.max(reflectanceLuminances[index], EPSILON);
      totalConcentration += concentration;
      const reflectance = reflectances[index];
      for (let lambda = 0; lambda < SPECTRAL_SAMPLES; lambda += 1) {
        mixedKs[lambda] += reflectanceToKs(reflectance[lambda]) * concentration;
      }
    }

    if (totalConcentration <= EPSILON) return reflectances[activeIndices[0]].slice();
    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      ksToReflectance(Math.max(mixedKs[index] / totalConcentration, 0))
    ));
  }

  function applyDerivedResidualMixCorrection({
    darkChromaticWeights,
    complementaryProfiles,
    parts,
    activeIndices,
    mixedReflectance,
  }) {
    const violetScale = params.derivedVioletMixResidualScale;
    const greenScale = params.derivedGreenMixResidualScale;
    const darkVioletScale = params.derivedDarkVioletMixResidualScale;
    if (violetScale <= EPSILON && greenScale <= EPSILON && darkVioletScale <= EPSILON) {
      return mixedReflectance;
    }

    const opponentStress = opponentMixStress(complementaryProfiles, parts, activeIndices);
    const darkStress = darkChromaticMixStressFromWeights(darkChromaticWeights, parts);
    const violetStress = opponentStress.violet;
    const greenStress = opponentStress.green;
    const darkVioletStress = Math.sqrt(clamp(violetStress * darkStress, 0, 1));
    if (violetStress <= EPSILON && greenStress <= EPSILON && darkVioletStress <= EPSILON) {
      return mixedReflectance;
    }

    const logResidual = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      violetScale * violetStress * LEARNED_VIOLET_MIX_RESIDUAL_BASIS[index] +
      greenScale * greenStress * LEARNED_GREEN_MIX_RESIDUAL_BASIS[index] +
      darkVioletScale * darkVioletStress * LEARNED_DARK_VIOLET_MIX_RESIDUAL_BASIS[index]
    ));

    return applyBoundedLogReflectanceResidual(mixedReflectance, logResidual);
  }

  function applyDerivedKsMixCorrection({
    darkChromaticWeights,
    complementaryProfiles,
    parts,
    activeIndices,
    mixedReflectance,
  }) {
    const violetScale = params.derivedVioletKsResidualScale;
    const darkVioletScale = params.derivedDarkVioletKsResidualScale;
    if (violetScale <= EPSILON && darkVioletScale <= EPSILON) return mixedReflectance;

    const opponentStress = opponentMixStress(complementaryProfiles, parts, activeIndices);
    const darkStress = darkChromaticMixStressFromWeights(darkChromaticWeights, parts);
    const violetStress = opponentStress.violet;
    const darkVioletStress = Math.sqrt(clamp(violetStress * darkStress, 0, 1));
    if (violetStress <= EPSILON && darkVioletStress <= EPSILON) return mixedReflectance;

    const ksResidual = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      violetScale * violetStress * LEARNED_VIOLET_KS_RESIDUAL_BASIS[index] +
      darkVioletScale * darkVioletStress * LEARNED_DARK_VIOLET_KS_RESIDUAL_BASIS[index]
    ));

    return applyBoundedKsResidual(mixedReflectance, ksResidual);
  }

  function luminanceMatchedBasisReflectance(basisReflectance, basisLuminance, targetLuminance) {
    const scale = Math.max(targetLuminance, EPSILON) / Math.max(basisLuminance, EPSILON);
    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      clamp(basisReflectance[index] * scale, EPSILON, 1)
    ));
  }

  function estimatePigment(linearRgb) {
    const rgb = linearRgb.map((value) => clamp(value, 0, 1));
    const reflectance = reconstructReflectance(rgb);
    const scattering = estimateScatteringCurve(rgb, reflectance);
    const strength = estimatePigmentStrength(rgb);

    const luminance = linearLuminance(rgb);
    const chroma = linearChroma(rgb);
    const darkChromaticScore = darkChromaticWeight(chroma, luminance);

    const luminanceFactor = luminance > params.absorptionBoostLuminanceThreshold
      ? Math.sqrt(luminance)
      : params.absorptionBoostLuminanceFloor +
        ((1 - params.absorptionBoostLuminanceFloor) * luminance) / params.absorptionBoostLuminanceThreshold;

    const standardBoost = params.absorptionBoostFactor * chroma * luminanceFactor;
    const darkChromaFactor = params.darkAbsorptionBoostFactor * chroma * darkChromaticScore;
    const absorptionBoost = 1 + standardBoost + darkChromaFactor;

    return {
      absorption: Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
        reflectanceToKs(reflectance[index]) * scattering[index] * strength * absorptionBoost
      )),
      scattering: Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => scattering[index] * strength),
    };
  }

  function reconstructReflectance(rgb) {
    if (isNeutral(rgb)) {
      const value = clamp((rgb[0] + rgb[1] + rgb[2]) / 3, EPSILON, 1);
      return new Array(SPECTRAL_SAMPLES).fill(value);
    }

    const basisReflectance = reconstructBasisReflectance(rgb);
    const basisBlend = clamp(params.spectralBasisReflectanceBlend, 0, 1);
    if (basisBlend >= 1 - EPSILON) return basisReflectance;

    const targetXyz = multiply3x3Vector(SRGB_D65_TO_XYZ, rgb);
    const legacyReflectance = fitDualSigmoidReflectance(targetXyz, rgb);
    if (basisBlend <= EPSILON) return legacyReflectance;
    return blendReflectance(legacyReflectance, basisReflectance, basisBlend);
  }

  function reconstructBasisReflectance(rgb) {
    const chromaticBases = currentChromaticBases();
    const white = Math.min(rgb[0], rgb[1], rgb[2]);
    const shifted = [rgb[0] - white, rgb[1] - white, rgb[2] - white];

    const cyan = Math.min(shifted[1], shifted[2]);
    const magenta = Math.min(shifted[0], shifted[2]);
    const yellow = Math.min(shifted[0], shifted[1]);
    const red = Math.max(0, Math.min(shifted[0] - shifted[2], shifted[0] - shifted[1]));
    const green = Math.max(0, Math.min(shifted[1] - shifted[2], shifted[1] - shifted[0]));
    const blue = Math.max(0, Math.min(shifted[2] - shifted[1], shifted[2] - shifted[0]));

    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      Math.max(
        EPSILON,
        white * BASE_W[index] +
          cyan * chromaticBases[0][index] +
          magenta * chromaticBases[1][index] +
          yellow * chromaticBases[2][index] +
          red * chromaticBases[3][index] +
          green * chromaticBases[4][index] +
          blue * chromaticBases[5][index],
      )
    ));
  }

  function currentChromaticBases() {
    if (cachedChromaticBasisParams === params && cachedChromaticBases != null) {
      return cachedChromaticBases;
    }

    const controls = basisResidualControls();
    const deformedBases = FIXED_CHROMATIC_BASES.map((base, basisIndex) => (
      deformChromaticBasis(base, controls[basisIndex], BASIS_DEFORMATION_LIMITS[basisIndex])
    ));
    cachedChromaticBasisParams = params;
    cachedChromaticBases = deformedBases;
    return deformedBases;
  }

  function basisResidualControls() {
    return [
      [params.basisCBlueResidual, params.basisCGreenResidual, params.basisCRedResidual],
      [params.basisMBlueResidual, params.basisMGreenResidual, params.basisMRedResidual],
      [params.basisYBlueResidual, params.basisYGreenResidual, params.basisYRedResidual],
      [params.basisRBlueResidual, params.basisRGreenResidual, params.basisRRedResidual],
      [params.basisGBlueResidual, params.basisGGreenResidual, params.basisGRedResidual],
      [params.basisBBlueResidual, params.basisBGreenResidual, params.basisBRedResidual],
    ];
  }

  function deformChromaticBasis(base, control, limits) {
    const scaledCoefficients = control.map((value, index) => (
      scaledBasisResidualCoefficient(value, limits[index])
    ));
    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
      let value = base[index];
      for (let residualIndex = 0; residualIndex < scaledCoefficients.length; residualIndex += 1) {
        value += scaledCoefficients[residualIndex] * LEARNABLE_BASIS_RESIDUALS[residualIndex][index];
      }
      return clamp(value, EPSILON, 1);
    });
  }

  function applyBoundedLogReflectanceResidual(baseReflectance, logResidual) {
    const minLogReflectance = Math.log(EPSILON);
    let boundedScale = 1;
    for (let index = 0; index < logResidual.length; index += 1) {
      const delta = logResidual[index];
      if (Math.abs(delta) <= EPSILON) continue;
      const baseLog = Math.log(clamp(baseReflectance[index], EPSILON, 1));
      const limit = delta > 0 ? (0 - baseLog) / delta : (minLogReflectance - baseLog) / delta;
      boundedScale = Math.min(boundedScale, Math.max(limit, 0));
    }
    if (boundedScale <= EPSILON) return baseReflectance;

    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      clamp(
        Math.exp(Math.log(clamp(baseReflectance[index], EPSILON, 1)) + boundedScale * logResidual[index]),
        EPSILON,
        1 - EPSILON,
      )
    ));
  }

  function applyBoundedKsResidual(baseReflectance, ksResidual) {
    const baseKs = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => reflectanceToKs(baseReflectance[index]));
    let boundedScale = 1;
    for (let index = 0; index < ksResidual.length; index += 1) {
      const delta = ksResidual[index];
      if (delta >= -EPSILON) continue;
      boundedScale = Math.min(boundedScale, Math.max(baseKs[index] / -delta, 0));
    }
    if (boundedScale <= EPSILON) return baseReflectance;

    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
      ksToReflectance(Math.max(baseKs[index] + boundedScale * ksResidual[index], 0))
    ));
  }

  function fitDualSigmoidReflectance(targetXyz, rgb) {
    const { c0, c1, c2, err: singleErr } = fitSingleSigmoid(targetXyz);
    const luminance = linearLuminance(rgb);
    const chroma = linearChroma(rgb);
    const darkChromaticScore = darkChromaticWeight(chroma, luminance);

    if (singleErr < params.dualSigmoidSkipResidualThreshold && darkChromaticScore <= 0) {
      return evalSigmoid(c0, c1, c2);
    }

    const [refDual, dualErr] = fitDualSigmoid(targetXyz, rgb, c0, c1, c2, darkChromaticScore);
    const improvementThreshold = lerp(
      params.dualSigmoidImprovementRatio,
      params.darkChromaticDualSigmoidImprovementRatio,
      darkChromaticScore,
    );
    const baseReflectance = dualErr < singleErr * improvementThreshold
      ? refDual
      : evalSigmoid(c0, c1, c2);

    return applyDarkChromaticResidualBasis(baseReflectance, rgb, darkChromaticScore);
  }

  function estimateScatteringCurve(rgb, reflectance) {
    const luminance = clamp(multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1], 0, 1);
    const chroma = linearChroma(rgb);
    const neutrality = clamp(1 - chroma, 0, 1);

    const chromaticBoost = params.scatteringChromaticMultiplier * chroma *
      (params.scatteringChromaticLuminanceFloor + (1 - params.scatteringChromaticLuminanceFloor) * Math.sqrt(luminance));

    const scatteringStrength = clamp(
      params.scatteringMin +
        params.scatteringBaseLuminanceScale * Math.sqrt(luminance) +
        params.scatteringNeutralLuminanceScale * neutrality * luminance * luminance +
        chromaticBoost,
      params.scatteringMin,
      params.scatteringMax,
    );

    const shapeBase = params.scatteringShapeBase + params.scatteringShapeChromaScale * chroma;
    return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
      const shape = shapeBase + (1 - shapeBase) * Math.sqrt(clamp(reflectance[index], EPSILON, 1));
      return scatteringStrength * shape;
    });
  }

  function estimatePigmentStrength(rgb) {
    const luminance = clamp(multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1], 0, 1);
    const chroma = linearChroma(rgb);
    const neutrality = clamp(1 - chroma, 0, 1);
    return clamp(
      params.pigmentStrengthBase +
        params.pigmentStrengthLuminanceScale * luminance +
        params.pigmentStrengthNeutralityScale * neutrality,
      params.pigmentStrengthMin,
      params.pigmentStrengthMax,
    );
  }

  return {
    N,
    colorToMixSpace,
    colorToReflectance,
    colorComplementaryProfile,
    mixSpaceToColor,
    reflectanceToColor,
    reflectanceLuminance,
    mixPreparedToColor,
    mixPreparedReflectance,
    partToEffectiveConcentration,
    effectiveWeightToPartDomain,
    colorDarkChromaticWeight,
    srgbChannelToLinear,
    linearChannelToSrgb,
  };
}

function fitSingleSigmoid(targetXyz) {
  const luminance = clamp(targetXyz[1], 0.001, 0.999);
  const rgb = multiply3x3Vector(XYZ_TO_SRGB_D65, targetXyz);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2], 0.01);

  const c1Init = 12 * (rgb[0] - rgb[2]) / maxC;
  const c2Init = -16 * (rgb[1] - 0.5 * (rgb[0] + rgb[2])) / maxC;
  const c0Init = logit(luminance) - c1Init * 0.5 - c2Init * 0.25;

  let c0 = c0Init;
  let c1 = c1Init;
  let c2 = c2Init;
  let lastErr = Number.MAX_VALUE;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const reflectance = new Array(SPECTRAL_SAMPLES);
    const dSigmoid = new Array(SPECTRAL_SAMPLES);
    for (let index = 0; index < SPECTRAL_SAMPLES; index += 1) {
      const t = WAVELENGTH_T[index];
      const s = sigmoid(c0 + c1 * t + c2 * t * t);
      reflectance[index] = s;
      dSigmoid[index] = s * (1 - s);
    }

    const xyz = reflectanceToXyz(reflectance);
    const rx = xyz[0] - targetXyz[0];
    const ry = xyz[1] - targetXyz[1];
    const rz = xyz[2] - targetXyz[2];
    const err = rx * rx + ry * ry + rz * rz;
    if (err < 1e-12) {
      return { c0, c1, c2, err };
    }

    const j = Array.from({ length: 3 }, () => new Array(3).fill(0));
    for (let index = 0; index < SPECTRAL_SAMPLES; index += 1) {
      const t = WAVELENGTH_T[index];
      const d = dSigmoid[index];
      const d0 = d;
      const d1 = d * t;
      const d2 = d * t * t;
      j[0][0] += X_BAR[index] * d0; j[0][1] += X_BAR[index] * d1; j[0][2] += X_BAR[index] * d2;
      j[1][0] += Y_BAR[index] * d0; j[1][1] += Y_BAR[index] * d1; j[1][2] += Y_BAR[index] * d2;
      j[2][0] += Z_BAR[index] * d0; j[2][1] += Z_BAR[index] * d1; j[2][2] += Z_BAR[index] * d2;
    }

    const delta = solve3x3(j, [-rx, -ry, -rz]);
    if (delta == null) break;

    let step = 1;
    for (let search = 0; search < 5; search += 1) {
      const nc0 = c0 + step * delta[0];
      const nc1 = c1 + step * delta[1];
      const nc2 = c2 + step * delta[2];
      const nRef = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
        const t = WAVELENGTH_T[index];
        return sigmoid(nc0 + nc1 * t + nc2 * t * t);
      });
      const nXyz = reflectanceToXyz(nRef);
      const newErr = sqr(nXyz[0] - targetXyz[0]) + sqr(nXyz[1] - targetXyz[1]) + sqr(nXyz[2] - targetXyz[2]);
      if (newErr < err) {
        c0 = nc0;
        c1 = nc1;
        c2 = nc2;
        lastErr = newErr;
        break;
      }
      step *= 0.5;
    }
  }

  return { c0, c1, c2, err: lastErr };
}

function fitDualSigmoid(targetXyz, rgb, a0Init, a1Init, a2Init, darkChromaticScore) {
  const luminance = clamp(targetXyz[1], 0.001, 0.999);
  const dominantChannel = clamp(Math.max(rgb[0], rgb[1], rgb[2]), 0.02, 0.98);
  const secondaryLobeLuminance = clamp(
    lerp(luminance, 0.5 * (luminance + dominantChannel), darkChromaticScore),
    0.001,
    0.999,
  );
  const b0Init = logit(secondaryLobeLuminance);
  const slopeScale = lerp(0.5, 0.9, darkChromaticScore);
  const curvatureScale = lerp(0.3, 0.6, darkChromaticScore);
  const b1Init = -a1Init * slopeScale;
  const b2Init = -a2Init * curvatureScale;

  let alpha = lerp(0.8, 0.6, darkChromaticScore);
  let a0 = a0Init;
  let a1 = a1Init;
  let a2 = a2Init;
  let b0 = b0Init;
  let b1 = b1Init;
  let b2 = b2Init;

  let lastErr = Number.MAX_VALUE;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const reflectance = evalDualSigmoid(alpha, a0, a1, a2, b0, b1, b2);
    const xyz = reflectanceToXyz(reflectance);
    const rx = xyz[0] - targetXyz[0];
    const ry = xyz[1] - targetXyz[1];
    const rz = xyz[2] - targetXyz[2];

    const regularisation = currentRegularisation(darkChromaticScore);
    const rAlpha = regularisation * (alpha - 1);
    const err = rx * rx + ry * ry + rz * rz + rAlpha * rAlpha;
    if (err < 1e-12) break;
    lastErr = err;

    const nParams = 7;
    const nResiduals = 4;
    const j = Array.from({ length: nResiduals }, () => new Array(nParams).fill(0));
    const residuals = [rx, ry, rz, rAlpha];

    for (let index = 0; index < SPECTRAL_SAMPLES; index += 1) {
      const t = WAVELENGTH_T[index];
      const xA = a0 + a1 * t + a2 * t * t;
      const xB = b0 + b1 * t + b2 * t * t;
      const sA = sigmoid(xA);
      const sB = sigmoid(xB);
      const dsA = sA * (1 - sA);
      const dsB = sB * (1 - sB);

      const dRdAlpha = sA - sB;
      const dRda0 = alpha * dsA;
      const dRda1 = alpha * dsA * t;
      const dRda2 = alpha * dsA * t * t;
      const beta = 1 - alpha;
      const dRdb0 = beta * dsB;
      const dRdb1 = beta * dsB * t;
      const dRdb2 = beta * dsB * t * t;

      const bars = [X_BAR, Y_BAR, Z_BAR];
      for (let row = 0; row < 3; row += 1) {
        const w = bars[row][index];
        j[row][0] += w * dRdAlpha;
        j[row][1] += w * dRda0;
        j[row][2] += w * dRda1;
        j[row][3] += w * dRda2;
        j[row][4] += w * dRdb0;
        j[row][5] += w * dRdb1;
        j[row][6] += w * dRdb2;
      }
    }

    j[3][0] = currentRegularisation(darkChromaticScore);

    const jtj = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
    const jtr = new Array(nParams).fill(0);
    for (let row = 0; row < nResiduals; row += 1) {
      for (let p = 0; p < nParams; p += 1) {
        jtr[p] += j[row][p] * residuals[row];
        for (let q = p; q < nParams; q += 1) {
          jtj[p][q] += j[row][p] * j[row][q];
        }
      }
    }
    for (let p = 0; p < nParams; p += 1) {
      for (let q = 0; q < p; q += 1) {
        jtj[p][q] = jtj[q][p];
      }
      jtj[p][p] *= 1.001;
      jtj[p][p] += 1e-8;
    }

    const delta = solveNxN(jtj, jtr.map((value) => -value));
    if (delta == null) break;

    let step = 1;
    for (let search = 0; search < 6; search += 1) {
      const nAlpha = clamp(alpha + step * delta[0], 0.05, 0.99);
      const na0 = a0 + step * delta[1];
      const na1 = a1 + step * delta[2];
      const na2 = a2 + step * delta[3];
      const nb0 = b0 + step * delta[4];
      const nb1 = b1 + step * delta[5];
      const nb2 = b2 + step * delta[6];
      const nRef = evalDualSigmoid(nAlpha, na0, na1, na2, nb0, nb1, nb2);
      const nXyz = reflectanceToXyz(nRef);
      const nrAlpha = currentRegularisation(darkChromaticScore) * (nAlpha - 1);
      const newErr =
        sqr(nXyz[0] - targetXyz[0]) +
        sqr(nXyz[1] - targetXyz[1]) +
        sqr(nXyz[2] - targetXyz[2]) +
        nrAlpha * nrAlpha;
      if (newErr < err) {
        alpha = nAlpha;
        a0 = na0;
        a1 = na1;
        a2 = na2;
        b0 = nb0;
        b1 = nb1;
        b2 = nb2;
        lastErr = newErr;
        break;
      }
      step *= 0.5;
    }
  }

  const finalRef = evalDualSigmoid(alpha, a0, a1, a2, b0, b1, b2);
  const finalXyz = reflectanceToXyz(finalRef);
  const finalErr =
    sqr(finalXyz[0] - targetXyz[0]) +
    sqr(finalXyz[1] - targetXyz[1]) +
    sqr(finalXyz[2] - targetXyz[2]);

  return [finalRef, finalErr];
}

let currentRegularisationParameters = null;
function currentRegularisation(darkChromaticScore) {
  if (currentRegularisationParameters == null) {
    throw new Error('Regularisation parameters not initialised');
  }
  return currentRegularisationParameters.dualSigmoidRegularisation *
    lerp(1, currentRegularisationParameters.darkChromaticRegularisationScale, darkChromaticScore);
}

function evalSigmoid(c0, c1, c2) {
  return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    return clamp(sigmoid(c0 + c1 * t + c2 * t * t), EPSILON, 1 - EPSILON);
  });
}

function evalDualSigmoid(alpha, a0, a1, a2, b0, b1, b2) {
  return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const t = WAVELENGTH_T[index];
    const sa = sigmoid(a0 + a1 * t + a2 * t * t);
    const sb = sigmoid(b0 + b1 * t + b2 * t * t);
    return clamp(alpha * sa + (1 - alpha) * sb, EPSILON, 1 - EPSILON);
  });
}

function applyDarkChromaticResidualBasis(baseReflectance, rgb, darkChromaticScore) {
  const params = currentRegularisationParameters;
  const scale = params.darkChromaticResidualBasisScale * darkChromaticScore;
  if (scale <= 0) return baseReflectance;

  const maxChannel = Math.max(rgb[0], rgb[1], rgb[2], EPSILON);
  const red = rgb[0] / maxChannel;
  const green = rgb[1] / maxChannel;
  const blue = rgb[2] / maxChannel;
  const redDominance = clamp(red - 0.5 * (green + blue), 0, 1);
  const blueDominance = clamp(blue - 0.5 * (red + green), 0, 1);
  const magentaDominance = clamp(0.5 * (red + blue) - green, 0, 1);
  if (redDominance <= 0 && blueDominance <= 0 && magentaDominance <= 0) {
    return baseReflectance;
  }

  const residual = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
    scale * (
      redDominance * RED_RESIDUAL_BASIS[index] +
      blueDominance * BLUE_RESIDUAL_BASIS[index] +
      0.6 * magentaDominance * MAGENTA_RESIDUAL_BASIS[index]
    )
  ));

  let boundedScale = 1;
  for (let index = 0; index < residual.length; index += 1) {
    const delta = residual[index];
    if (delta > 0) {
      boundedScale = Math.min(boundedScale, (1 - EPSILON - baseReflectance[index]) / delta);
    } else if (delta < 0) {
      boundedScale = Math.min(boundedScale, (baseReflectance[index] - EPSILON) / -delta);
    }
  }
  if (boundedScale <= EPSILON) return baseReflectance;

  return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
    clamp(baseReflectance[index] + boundedScale * residual[index], EPSILON, 1 - EPSILON)
  ));
}

function blendReflectance(legacyReflectance, basisReflectance, blend) {
  const t = clamp(blend, 0, 1);
  return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
    clamp(lerp(legacyReflectance[index], basisReflectance[index], t), EPSILON, 1 - EPSILON)
  ));
}

function mixSpaceToReflectance(mixSpace) {
  return Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => {
    const absorption = Math.max(mixSpace[index], 0);
    const scattering = Math.max(mixSpace[index + SPECTRAL_SAMPLES], EPSILON);
    return ksToReflectance(absorption / scattering);
  });
}

function reflectanceToXyz(reflectance) {
  return [
    spectralDot(reflectance, X_BAR),
    spectralDot(reflectance, Y_BAR),
    spectralDot(reflectance, Z_BAR),
  ];
}

function spectralDot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }
  return sum;
}

function basisResidualLimits(base, residual) {
  let positiveLimit = Number.POSITIVE_INFINITY;
  let negativeLimit = Number.POSITIVE_INFINITY;

  for (let index = 0; index < base.length; index += 1) {
    const residualValue = residual[index];
    if (residualValue > EPSILON) {
      positiveLimit = Math.min(positiveLimit, (1 - base[index]) / residualValue);
    } else if (residualValue < -EPSILON) {
      negativeLimit = Math.min(negativeLimit, (base[index] - EPSILON) / -residualValue);
    }
  }

  if (!Number.isFinite(positiveLimit)) positiveLimit = 0;
  if (!Number.isFinite(negativeLimit)) negativeLimit = 0;
  return {
    negative: Math.max(negativeLimit, 0),
    positive: Math.max(positiveLimit, 0),
  };
}

function scaledBasisResidualCoefficient(control, limits) {
  const clampedControl = clamp(control, -1, 1);
  return clampedControl >= 0
    ? clampedControl * limits.positive * BASIS_DEFORMATION_FRACTION
    : clampedControl * limits.negative * BASIS_DEFORMATION_FRACTION;
}

function linearLuminance(rgb) {
  return clamp(multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1], 0, 1);
}

function linearChroma(rgb) {
  const maxValue = Math.max(rgb[0], rgb[1], rgb[2]);
  if (maxValue <= EPSILON) return 0;
  const minValue = Math.min(rgb[0], rgb[1], rgb[2]);
  return clamp((maxValue - minValue) / maxValue, 0, 1);
}

function complementaryMixProfile(rgb) {
  const maxValue = Math.max(rgb[0], rgb[1], rgb[2]);
  if (maxValue <= EPSILON) {
    return { chroma: 0, redScore: 0, blueScore: 0, yellowScore: 0 };
  }

  const normalisedRgb = [rgb[0] / maxValue, rgb[1] / maxValue, rgb[2] / maxValue];
  return {
    chroma: linearChroma(rgb),
    redScore: clamp(normalisedRgb[0] - 0.5 * (normalisedRgb[1] + normalisedRgb[2]), 0, 1),
    blueScore: clamp(normalisedRgb[2] - 0.5 * (normalisedRgb[0] + normalisedRgb[1]), 0, 1),
    yellowScore: clamp(Math.min(normalisedRgb[0], normalisedRgb[1]) * (1 - normalisedRgb[2]), 0, 1),
  };
}

function darkChromaticWeight(chroma, luminance) {
  const params = currentRegularisationParameters;
  const chromaDenominator = Math.max(1 - params.darkChromaticChromaThreshold, EPSILON);
  const chromaWeight = clamp((chroma - params.darkChromaticChromaThreshold) / chromaDenominator, 0, 1);
  const luminanceThreshold = Math.max(params.darkChromaticLuminanceThreshold, EPSILON);
  const luminanceWeight = clamp((luminanceThreshold - luminance) / luminanceThreshold, 0, 1);
  return chromaWeight * luminanceWeight;
}

function gaussian(t, center, width) {
  const scaled = (t - center) / Math.max(width, EPSILON);
  return Math.exp(-0.5 * scaled * scaled);
}

function xyzNullResidualBasis(raw) {
  const rhs = [
    spectralDot(raw, X_BAR),
    spectralDot(raw, Y_BAR),
    spectralDot(raw, Z_BAR),
  ];
  const coeffs = solve3x3(XYZ_GRAM, rhs) ?? [0, 0, 0];
  const corrected = Array.from({ length: SPECTRAL_SAMPLES }, (_, index) => (
    raw[index] - coeffs[0] * X_BAR[index] - coeffs[1] * Y_BAR[index] - coeffs[2] * Z_BAR[index]
  ));
  const maxAbs = corrected.reduce((maxValue, value) => Math.max(maxValue, Math.abs(value)), 0);
  const denominator = Math.max(maxAbs, EPSILON);
  return corrected.map((value) => value / denominator);
}

function reflectanceToKs(reflectance) {
  const r = clamp(reflectance, EPSILON, 1);
  return ((1 - r) * (1 - r)) / (2 * r);
}

function ksToReflectance(ks) {
  return clamp(1 + ks - Math.sqrt(ks * ks + 2 * ks), EPSILON, 1);
}

function multiply3x3Vector(matrix, vector) {
  return Array.from({ length: 3 }, (_, row) => (
    matrix[row][0] * vector[0] + matrix[row][1] * vector[1] + matrix[row][2] * vector[2]
  ));
}

function isNeutral(linearRgb) {
  const maxValue = Math.max(linearRgb[0], linearRgb[1], linearRgb[2]);
  const minValue = Math.min(linearRgb[0], linearRgb[1], linearRgb[2]);
  return maxValue - minValue <= NEUTRAL_LINEAR_TOLERANCE;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-clamp(x, -80, 80)));
}

function lerp(start, end, t) {
  return start + (end - start) * clamp(t, 0, 1);
}

function logit(p) {
  return Math.log(p / (1 - p));
}

function sqr(x) {
  return x * x;
}

function solve3x3(m, b) {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-20) return null;
  const invDet = 1 / det;
  return [
    (
      b[0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (b[1] * m[2][2] - m[1][2] * b[2]) +
      m[0][2] * (b[1] * m[2][1] - m[1][1] * b[2])
    ) * invDet,
    (
      m[0][0] * (b[1] * m[2][2] - m[1][2] * b[2]) -
      b[0] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * b[2] - b[1] * m[2][0])
    ) * invDet,
    (
      m[0][0] * (m[1][1] * b[2] - b[1] * m[2][1]) -
      m[0][1] * (m[1][0] * b[2] - b[1] * m[2][0]) +
      b[0] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    ) * invDet,
  ];
}

function solveNxN(m, b) {
  const n = m.length;
  const a = Array.from({ length: n }, (_, row) => (
    Array.from({ length: n + 1 }, (_, col) => (col < n ? m[row][col] : b[row]))
  ));

  for (let col = 0; col < n; col += 1) {
    let maxRow = col;
    let maxValue = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(a[row][col]);
      if (value > maxValue) {
        maxValue = value;
        maxRow = row;
      }
    }
    if (maxValue < 1e-20) return null;
    if (maxRow !== col) {
      const tmp = a[col];
      a[col] = a[maxRow];
      a[maxRow] = tmp;
    }
    const pivot = a[col][col];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / pivot;
      for (let k = col; k < n + 1; k += 1) {
        a[row][k] -= factor * a[col][k];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k += 1) {
      sum -= a[row][k] * x[k];
    }
    x[row] = sum / a[row][row];
  }
  return x;
}

function colorToLinearRgb(color) {
  return [
    srgbChannelToLinear(color.red),
    srgbChannelToLinear(color.green),
    srgbChannelToLinear(color.blue),
  ];
}

export function srgbChannelToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearChannelToSrgb(v) {
  return v <= 0.0031308
    ? clamp(v * 12.92, 0, 1)
    : clamp(1.055 * (v ** (1 / 2.4)) - 0.055, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function withSpectralParameters(params, callback) {
  const previous = currentRegularisationParameters;
  currentRegularisationParameters = params;
  try {
    return callback();
  } finally {
    currentRegularisationParameters = previous;
  }
}
