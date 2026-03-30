import { defaultModelArtifact } from './default-model-artifact.js';
import { predictBlended } from './learned-mixer-model.js';
import { ResidualCorrectionModel } from './residual-correction-model.js';
import { SrgbColor } from './srgb-color.js';

export class LearnedResidualCorrectionModel extends ResidualCorrectionModel {
  constructor({ artifact = defaultModelArtifact } = {}) {
    super({
      modelId: artifact.modelId,
      expectedBaseEngineId: artifact.baseEngineId,
    });
    this.artifact = artifact;
  }

  correct(portions, baseMix) {
    if (!(baseMix instanceof SrgbColor)) {
      throw new TypeError('baseMix must be an SrgbColor');
    }

    const blend = this.artifact.mixingParameters.learnedMixerBlend;
    if (blend <= 0) return baseMix;

    return (
      predictBlended({
        portions,
        physical: baseMix,
        artifact: this.artifact,
        blend,
      }) ?? baseMix
    );
  }
}

export const defaultLearnedResidualCorrectionModel = new LearnedResidualCorrectionModel();
