import { defaultModelArtifact } from './default-model-artifact.js';
import { createSpectralData } from './spectral-data.js';

export class SpectralBaseMixEngine {
  constructor({ artifact = defaultModelArtifact } = {}) {
    this.artifact = artifact;
    this.engineId = artifact.baseEngineId;
    this.spectralData = createSpectralData(artifact.mixingParameters);
  }

  mixOrNull(portions) {
    if (portions.length === 0) return null;

    const parts = portions.map((portion) => portion.parts);
    const activeIndices = parts.flatMap((part, index) => (part > 0 ? [index] : []));
    if (activeIndices.length === 0) return null;
    if (activeIndices.length === 1) return portions[activeIndices[0]].color;

    const mixSpaces = portions.map((portion) => this.spectralData.colorToMixSpace(portion.color));
    const reflectances = portions.map((portion) => this.spectralData.colorToReflectance(portion.color));
    const darkChromaticWeights = portions.map((portion) => this.spectralData.colorDarkChromaticWeight(portion.color));
    const reflectanceLuminances = reflectances.map((reflectance) => this.spectralData.reflectanceLuminance(reflectance));
    const complementaryProfiles = portions.map((portion) => this.spectralData.colorComplementaryProfile(portion.color));

    return this.spectralData.mixPreparedToColor({
      mixSpaces,
      reflectances,
      darkChromaticWeights,
      reflectanceLuminances,
      complementaryProfiles,
      parts,
    });
  }
}

export const defaultSpectralBaseMixEngine = new SpectralBaseMixEngine();
