import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultModelArtifact } from '../src/index.js';

test('bundled artifact parses into expected runtime shape', () => {
  assert.equal(defaultModelArtifact.modelId, 'baseline-v1');
  assert.equal(defaultModelArtifact.baseEngineId, 'spectral_ks_v1');
  assert.equal(defaultModelArtifact.inputDim, 23);
  assert.deepEqual(defaultModelArtifact.hiddenDims, [32, 32]);
  assert.equal(defaultModelArtifact.outputDim, 3);
  assert.equal(defaultModelArtifact.featureMean.length, defaultModelArtifact.inputDim);
  assert.equal(defaultModelArtifact.featureStd.length, defaultModelArtifact.inputDim);
  assert.equal(defaultModelArtifact.targetMean.length, defaultModelArtifact.outputDim);
  assert.equal(defaultModelArtifact.targetStd.length, defaultModelArtifact.outputDim);
  assert.ok(defaultModelArtifact.mixingParameters.learnedMixerBlend > 0);
});
