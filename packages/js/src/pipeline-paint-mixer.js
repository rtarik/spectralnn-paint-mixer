export class PipelinePaintMixer {
  constructor({ baseEngine, correctionModel = null, enforceCompatibility = true }) {
    if (!baseEngine || typeof baseEngine.mixOrNull !== 'function') {
      throw new TypeError('baseEngine must expose mixOrNull(portions)');
    }
    this.baseEngine = baseEngine;
    this.correctionModel = correctionModel;
    this.enforceCompatibility = enforceCompatibility;
  }

  mixOrNull(portions) {
    const baseMix = this.baseEngine.mixOrNull(portions);
    if (baseMix == null) return null;
    if (this.correctionModel == null || portions.length <= 1) return baseMix;

    const expectedBaseEngineId = this.correctionModel.expectedBaseEngineId;
    if (
      this.enforceCompatibility &&
      expectedBaseEngineId != null &&
      expectedBaseEngineId !== this.baseEngine.engineId
    ) {
      throw new Error(
        `Correction model ${this.correctionModel.modelId} expects base engine ${expectedBaseEngineId}, got ${this.baseEngine.engineId}`,
      );
    }

    return this.correctionModel.correct(portions, baseMix);
  }
}
