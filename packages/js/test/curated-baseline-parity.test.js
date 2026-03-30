import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MixPortion, PaintMixers, SrgbColor } from '../src/index.js';

function loadFixtureSet() {
  const url = new URL('../../../artifacts/fixtures/baseline-v1/curated-parity.json', import.meta.url);
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

function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function srgbToLab(color) {
  const r = srgbToLinear(color.red);
  const g = srgbToLinear(color.green);
  const b = srgbToLinear(color.blue);

  const x = 0.4123907992659593 * r + 0.3575843393838777 * g + 0.1804807884018343 * b;
  const y = 0.21263900587151033 * r + 0.7151686787677553 * g + 0.07219231536073373 * b;
  const z = 0.019330818715591832 * r + 0.11919477979462595 * g + 0.9505321522496605 * b;

  function labF(value) {
    return value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  }

  const fx = labF(x / 0.95047);
  const fy = labF(y / 1.0);
  const fz = labF(z / 1.08883);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE76(first, second) {
  const firstLab = srgbToLab(first);
  const secondLab = srgbToLab(second);
  const dl = firstLab.l - secondLab.l;
  const da = firstLab.a - secondLab.a;
  const db = firstLab.b - secondLab.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

const fixtures = loadFixtureSet();
const mixer = PaintMixers.default();

test('curated fixture set targets the bundled baseline artifact', () => {
  assert.equal(fixtures.fixtureSetVersion, 1);
  assert.equal(fixtures.modelId, PaintMixers.defaultArtifact().modelId);
  assert.ok(fixtures.cases.length > 0);
});

test('curated baseline fixtures stay within their frozen envelope', () => {
  const failures = [];

  for (const fixture of fixtures.cases) {
    const result = mixer.mixOrNull(
      fixture.inputs.map((hex, index) => (
        new MixPortion({
          color: SrgbColor.fromHex(hex),
          parts: fixture.parts[index],
        })
      )),
    );

    assert.notEqual(result, null, `Expected a mix result for fixture ${fixture.id}`);

    failures.push(
      ...driftMessages(
        fixture.baselineHex,
        result,
        1,
        fixture.id,
      ),
    );

    const deltaE = deltaE76(result, SrgbColor.fromHex(fixture.targetHex));
    if (deltaE > fixture.maxDeltaE) {
      failures.push(
        `Fixture ${fixture.id} exceeded max ΔE ${fixture.maxDeltaE}: actual=${result.toHexString()}, baseline=${fixture.baselineHex}, target=${fixture.targetHex}, deltaE=${deltaE.toFixed(4)}`,
      );
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
