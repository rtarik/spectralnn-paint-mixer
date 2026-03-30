import assert from 'node:assert/strict';
import test from 'node:test';

import { MixPortion, PipelinePaintMixer, SrgbColor } from '../src/index.js';

test('pipeline applies residual correction after base engine', () => {
  const observed = {
    baseMix: null,
    portionCount: -1,
  };
  const baseEngine = {
    engineId: 'stub-base',
    mixOrNull() {
      return SrgbColor.fromHex('#223344');
    },
  };
  const correctionModel = {
    modelId: 'stub-correction',
    expectedBaseEngineId: 'stub-base',
    correct(portions, baseMix) {
      observed.baseMix = baseMix;
      observed.portionCount = portions.length;
      return SrgbColor.fromHex('#556677');
    },
  };

  const mixer = new PipelinePaintMixer({
    baseEngine,
    correctionModel,
  });

  const result = mixer.mixOrNull([
    new MixPortion({ color: SrgbColor.fromHex('#AA0000'), parts: 1 }),
    new MixPortion({ color: SrgbColor.fromHex('#0000AA'), parts: 1 }),
  ]);

  assert.equal(result.toHexString(), '#556677');
  assert.equal(observed.baseMix?.toHexString(), '#223344');
  assert.equal(observed.portionCount, 2);
});

test('pipeline skips residual correction for a single portion', () => {
  let correctionCalled = false;
  const mixer = new PipelinePaintMixer({
    baseEngine: {
      engineId: 'single-base',
      mixOrNull() {
        return SrgbColor.fromHex('#445566');
      },
    },
    correctionModel: {
      modelId: 'unused-correction',
      expectedBaseEngineId: 'single-base',
      correct() {
        correctionCalled = true;
        return SrgbColor.fromHex('#FFFFFF');
      },
    },
  });

  const result = mixer.mixOrNull([
    new MixPortion({ color: SrgbColor.fromHex('#123456'), parts: 4 }),
  ]);

  assert.equal(result.toHexString(), '#445566');
  assert.equal(correctionCalled, false);
});

test('pipeline rejects incompatible base engine and residual model pairings', () => {
  const mixer = new PipelinePaintMixer({
    baseEngine: {
      engineId: 'custom-engine',
      mixOrNull() {
        return SrgbColor.fromHex('#223344');
      },
    },
    correctionModel: {
      modelId: 'baseline-v1',
      expectedBaseEngineId: 'spectral_ks_v1',
      correct() {
        return SrgbColor.fromHex('#556677');
      },
    },
  });

  assert.throws(
    () => mixer.mixOrNull([
      new MixPortion({ color: SrgbColor.fromHex('#AA0000'), parts: 1 }),
      new MixPortion({ color: SrgbColor.fromHex('#0000AA'), parts: 1 }),
    ]),
    /expects base engine spectral_ks_v1, got custom-engine/,
  );
});
