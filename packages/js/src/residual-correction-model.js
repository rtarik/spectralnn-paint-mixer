export class ResidualCorrectionModel {
  constructor({ modelId, expectedBaseEngineId = null }) {
    if (!modelId) {
      throw new Error('modelId is required');
    }
    this.modelId = modelId;
    this.expectedBaseEngineId = expectedBaseEngineId;
  }

  correct(_portions, _baseMix) {
    throw new Error('correct must be implemented by subclasses');
  }
}
