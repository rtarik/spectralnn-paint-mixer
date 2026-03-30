export class BaseMixEngine {
  constructor({ engineId }) {
    if (!engineId) {
      throw new Error('engineId is required');
    }
    this.engineId = engineId;
  }

  mixOrNull(_portions) {
    throw new Error('mixOrNull must be implemented by subclasses');
  }
}
