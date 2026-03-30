import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  defaultModelArtifact,
  LearnedResidualCorrectionModel,
  MixPortion,
  SrgbColor,
} from '../src/index.js';

function loadFixtureSet() {
  const url = new URL('../../../artifacts/fixtures/baseline-v1/residual-parity.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

function rgb8FromHex(hex) {
  const raw = hex.startsWith('#') ? hex.slice(1) : hex;
  return {
    red: Number.parseInt(raw.slice(0, 2), 16),
    green: Number.parseInt(raw.slice(2, 4), 16),
    blue: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function driftMessages(expectedHex, actual, maxChannelStep, fixtureId) {
  const expected = rgb8FromHex(expectedHex);
  const actualRgb8 = rgb8FromHex(actual.toHexString());
  const failures = [];
  if (Math.abs(expected.red - actualRgb8.red) > maxChannelStep) {
    failures.push(`Fixture ${fixtureId} red channel drifted: expected ${expectedHex}, got ${actual.toHexString()}`);
  }
  if (Math.abs(expected.green - actualRgb8.green) > maxChannelStep) {
    failures.push(`Fixture ${fixtureId} green channel drifted: expected ${expectedHex}, got ${actual.toHexString()}`);
  }
  if (Math.abs(expected.blue - actualRgb8.blue) > maxChannelStep) {
    failures.push(`Fixture ${fixtureId} blue channel drifted: expected ${expectedHex}, got ${actual.toHexString()}`);
  }
  return failures;
}

const fixtures = loadFixtureSet();
const correctionModel = new LearnedResidualCorrectionModel({ artifact: defaultModelArtifact });

test('residual parity fixture set targets the bundled baseline artifact', () => {
  assert.equal(fixtures.fixtureSetVersion, 1);
  assert.equal(fixtures.modelId, defaultModelArtifact.modelId);
  assert.ok(fixtures.cases.length > 0);
});

test('learned residual correction stays within its frozen envelope', () => {
  const failures = [];

  for (const fixture of fixtures.cases) {
    const portions = fixture.inputs.map((hex, index) => (
      new MixPortion({
        color: SrgbColor.fromHex(hex),
        parts: fixture.parts[index],
      })
    ));
    const actual = correctionModel.correct(
      portions,
      SrgbColor.fromHex(fixture.physicalHex),
    );

    failures.push(
      ...driftMessages(
        fixture.predictedHex,
        actual,
        fixture.maxChannelStep,
        fixture.id,
      ),
    );
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
