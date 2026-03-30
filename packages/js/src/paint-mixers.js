import { defaultModelArtifact } from './default-model-artifact.js';
import {
  defaultLearnedResidualCorrectionModel,
  LearnedResidualCorrectionModel,
} from './learned-residual-correction-model.js';
import { PipelinePaintMixer } from './pipeline-paint-mixer.js';
import {
  defaultSpectralBaseMixEngine,
  SpectralBaseMixEngine,
} from './spectral-base-mix-engine.js';

export const PaintMixers = {
  defaultArtifact() {
    return defaultModelArtifact;
  },

  default() {
    return new PipelinePaintMixer({
      baseEngine: defaultSpectralBaseMixEngine,
      correctionModel: defaultLearnedResidualCorrectionModel,
    });
  },

  spectralBase({ artifact = defaultModelArtifact } = {}) {
    if (artifact === defaultModelArtifact) {
      return defaultSpectralBaseMixEngine;
    }
    return new SpectralBaseMixEngine({ artifact });
  },

  learnedResidual({ artifact = defaultModelArtifact } = {}) {
    if (artifact === defaultModelArtifact) {
      return defaultLearnedResidualCorrectionModel;
    }
    return new LearnedResidualCorrectionModel({ artifact });
  },

  pipeline({ baseEngine, correctionModel = null, enforceCompatibility = true }) {
    return new PipelinePaintMixer({
      baseEngine,
      correctionModel,
      enforceCompatibility,
    });
  },
};
