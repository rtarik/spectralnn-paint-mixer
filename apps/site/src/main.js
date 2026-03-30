import runtimeCatalog from './lib/runtime-catalog.js';

const PAPER_COLOR = '#FFFFFF';
const DEFAULT_CUSTOM_HEX = '#7A5A3A';
const MAX_PROBE_ROWS = 4;

const DEFAULT_PALETTE = [
  { id: 'white', hex: '#FFFFFF' },
  { id: 'black', hex: '#101010' },
  { id: 'red', hex: '#E53935' },
  { id: 'yellow', hex: '#FDD835' },
  { id: 'blue', hex: '#283593' },
];

const DEFAULT_PROBE = [
  { pigmentId: 'red', parts: 1 },
  { pigmentId: 'blue', parts: 1 },
];

const availableRuntimes = Array.isArray(runtimeCatalog.availableRuntimes)
  ? runtimeCatalog.availableRuntimes
  : [];

const elements = {
  probePaletteList: document.querySelector('[data-probe-palette-list]'),
  probeRows: document.querySelector('[data-probe-rows]'),
  probeAddButton: document.querySelector('[data-probe-add-button]'),
  probeResetButton: document.querySelector('[data-probe-reset-button]'),
  addColorForm: document.querySelector('[data-add-color-form]'),
  colorPickerInput: document.querySelector('[data-color-picker-input]'),
  colorHexInput: document.querySelector('[data-color-hex-input]'),
  probeHexCorrected: document.querySelector('[data-probe-hex="corrected"]'),
  probeHexBase: document.querySelector('[data-probe-hex="base"]'),
  probeSwatchCorrected: document.querySelector('[data-probe-swatch="corrected"]'),
  probeSwatchBase: document.querySelector('[data-probe-swatch="base"]'),
  probeSummary: document.querySelector('[data-probe-summary]'),
  probeIngredientCount: document.querySelector('[data-probe-ingredient-count]'),
  probeTotalParts: document.querySelector('[data-probe-total-parts]'),
  probeRatioBar: document.querySelector('[data-probe-ratio-bar]'),
  runtimeSelector: document.querySelector('[data-runtime-selector]'),
  runtimeSelectorHeading: document.querySelector('[data-runtime-selector-heading]'),
  runtimeSelectorSelect: document.querySelector('[data-runtime-selector-select]'),
  usageTabs: Array.from(document.querySelectorAll('[data-usage-tab]')),
  usagePanels: Array.from(document.querySelectorAll('[data-usage-panel]')),
};

const state = {
  palette: DEFAULT_PALETTE.map((entry) => ({
    id: entry.id,
    hex: entry.hex,
  })),
  probeEntries: DEFAULT_PROBE.map((entry) => ({ ...entry })),
  nextCustomColorIndex: 1,
  usageTab: 'javascript',
  runtimeId: resolveInitialRuntimeId(),
  runtimeStatus: 'idle',
  runtimeLoadSequence: 0,
  runtimeError: null,
  runtimeApi: null,
  correctedMixer: null,
  baseMixer: null,
};

elements.colorPickerInput.value = DEFAULT_CUSTOM_HEX;
elements.colorHexInput.value = DEFAULT_CUSTOM_HEX;

wireEvents();
render();

if (state.runtimeId != null) {
  void selectRuntime(state.runtimeId);
}

function wireEvents() {
  elements.probeAddButton.addEventListener('click', handleProbeAddRow);
  elements.probeResetButton.addEventListener('click', handleProbeReset);
  elements.addColorForm.addEventListener('submit', handleAddColorSubmit);

  elements.colorPickerInput.addEventListener('input', () => {
    elements.colorHexInput.value = elements.colorPickerInput.value.toUpperCase();
  });

  elements.colorHexInput.addEventListener('input', () => {
    const normalized = normalizeHex(elements.colorHexInput.value);
    if (normalized != null) {
      elements.colorPickerInput.value = normalized;
    }
  });

  elements.usageTabs.forEach((button) => {
    button.addEventListener('click', () => {
      state.usageTab = button.dataset.usageTab ?? 'javascript';
      renderUsageTabs();
    });
  });

  if (elements.runtimeSelectorSelect != null) {
    elements.runtimeSelectorSelect.addEventListener('change', () => {
      const selectedRuntimeId = elements.runtimeSelectorSelect.value;
      if (selectedRuntimeId === '' || selectedRuntimeId === state.runtimeId) return;
      void selectRuntime(selectedRuntimeId);
    });
  }
}

function resolveInitialRuntimeId() {
  const params = new URLSearchParams(window.location.search);
  const requestedRuntimeId = params.get('runtime');
  if (requestedRuntimeId != null && availableRuntimes.some((entry) => entry.id === requestedRuntimeId)) {
    return requestedRuntimeId;
  }

  if (runtimeCatalog.defaultRuntimeId != null && availableRuntimes.some((entry) => entry.id === runtimeCatalog.defaultRuntimeId)) {
    return runtimeCatalog.defaultRuntimeId;
  }

  return availableRuntimes[0]?.id ?? null;
}

function currentRuntimeEntry() {
  return availableRuntimes.find((entry) => entry.id === state.runtimeId) ?? null;
}

function syncRuntimeUrl() {
  const url = new URL(window.location.href);
  if (state.runtimeId == null || state.runtimeId === runtimeCatalog.defaultRuntimeId) {
    url.searchParams.delete('runtime');
  } else {
    url.searchParams.set('runtime', state.runtimeId);
  }
  window.history.replaceState({}, '', url);
}

async function selectRuntime(runtimeId) {
  const runtimeEntry = availableRuntimes.find((entry) => entry.id === runtimeId);
  if (runtimeEntry == null) return;

  state.runtimeId = runtimeId;
  state.runtimeStatus = 'loading';
  state.runtimeError = null;
  state.runtimeLoadSequence += 1;
  const loadSequence = state.runtimeLoadSequence;
  render();

  try {
    const runtimeModule = await import(runtimeEntry.modulePath);
    if (loadSequence !== state.runtimeLoadSequence) return;

    state.runtimeApi = {
      MixPortion: runtimeModule.MixPortion,
      PaintMixers: runtimeModule.PaintMixers,
      SrgbColor: runtimeModule.SrgbColor,
    };
    state.correctedMixer = runtimeModule.PaintMixers.default();
    state.baseMixer = runtimeModule.PaintMixers.spectralBase();
    state.runtimeStatus = 'ready';
    syncRuntimeUrl();
    render();
  } catch (error) {
    if (loadSequence !== state.runtimeLoadSequence) return;

    state.runtimeApi = null;
    state.correctedMixer = null;
    state.baseMixer = null;
    state.runtimeStatus = 'error';
    state.runtimeError = error instanceof Error ? error.message : String(error);
    render();
  }
}

function handleProbeAddRow() {
  if (state.probeEntries.length >= MAX_PROBE_ROWS) return;
  const fallbackPigmentId = state.palette.find((pigment) => (
    !state.probeEntries.some((entry) => entry.pigmentId === pigment.id)
  ))?.id ?? state.palette[0]?.id;
  if (fallbackPigmentId == null) return;
  state.probeEntries.push({ pigmentId: fallbackPigmentId, parts: 1 });
  render();
}

function handleProbeReset() {
  state.probeEntries = DEFAULT_PROBE.map((entry) => ({ ...entry }));
  render();
}

function handleAddColorSubmit(event) {
  event.preventDefault();
  const normalizedHex = normalizeHex(elements.colorHexInput.value) ?? elements.colorPickerInput.value.toUpperCase();
  const existing = state.palette.find((pigment) => pigment.hex === normalizedHex);
  if (existing != null) {
    addPigmentToProbe(existing.id);
    elements.colorPickerInput.value = normalizedHex;
    elements.colorHexInput.value = normalizedHex;
    return;
  }

  const pigmentId = `custom-${state.nextCustomColorIndex}`;
  state.nextCustomColorIndex += 1;
  state.palette.push({
    id: pigmentId,
    hex: normalizedHex,
  });
  elements.colorPickerInput.value = normalizedHex;
  elements.colorHexInput.value = normalizedHex;
  addPigmentToProbe(pigmentId);
}

function render() {
  renderProbe();
  renderUsageTabs();
  renderRuntimeSelector();
}

function renderProbe() {
  normalizeProbeEntries();
  renderProbePalette();
  renderProbeRows();

  const recipe = resolveProbeRecipe();
  const { correctedHex, baseHex, summary } = summarizeProbe(recipe);
  elements.probeAddButton.disabled = state.probeEntries.length >= MAX_PROBE_ROWS;
  elements.probeIngredientCount.textContent = String(recipe.length);
  elements.probeTotalParts.textContent = String(recipe.reduce((sum, entry) => sum + entry.parts, 0));
  elements.probeSummary.textContent = summary;
  setProbeCompare(correctedHex, baseHex);
  renderProbeRatioBar(recipe);
}

function renderRuntimeSelector() {
  if (
    elements.runtimeSelector == null
    || elements.runtimeSelectorHeading == null
    || elements.runtimeSelectorSelect == null
  ) {
    return;
  }

  const options = availableRuntimes.length > 0
    ? availableRuntimes
    : [{
      id: '',
      label: 'No runtimes available',
    }];

  elements.runtimeSelector.hidden = false;
  elements.runtimeSelectorHeading.textContent = runtimeCatalog.heading ?? 'Runtime';
  elements.runtimeSelectorSelect.innerHTML = '';

  for (const optionData of options) {
    const option = document.createElement('option');
    option.textContent = optionData.label;
    option.value = optionData.id;
    option.selected = optionData.id === state.runtimeId;
    elements.runtimeSelectorSelect.append(option);
  }

  elements.runtimeSelectorSelect.disabled = options.length <= 1 || state.runtimeStatus === 'loading';
}

function renderProbePalette() {
  elements.probePaletteList.innerHTML = '';

  for (const pigment of state.palette) {
    const hex = pigment.hex;
    const button = document.createElement('button');
    button.className = 'quick-mix-chip';
    button.type = 'button';
    button.dataset.active = String(state.probeEntries.some((entry) => entry.pigmentId === pigment.id));
    button.title = hex;
    button.addEventListener('click', () => {
      addPigmentToProbe(pigment.id);
    });

    const swatch = document.createElement('span');
    swatch.className = 'quick-mix-chip-swatch';
    swatch.style.setProperty('--swatch', hex);

    const hexLabel = document.createElement('span');
    hexLabel.className = 'quick-mix-chip-hex';
    hexLabel.textContent = hex;

    button.append(swatch, hexLabel);
    elements.probePaletteList.append(button);
  }
}

function renderProbeRows() {
  elements.probeRows.innerHTML = '';

  const paletteOptions = state.palette.map((pigment) => ({
    id: pigment.id,
    label: pigment.hex,
  }));

  state.probeEntries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'probe-row';

    const pigmentField = document.createElement('label');
    pigmentField.className = 'probe-field';
    const pigmentLabel = document.createElement('span');
    pigmentLabel.textContent = 'Color';
    const pigmentSelect = document.createElement('select');
    for (const option of paletteOptions) {
      const optionElement = document.createElement('option');
      optionElement.value = option.id;
      optionElement.textContent = option.label;
      optionElement.selected = option.id === entry.pigmentId;
      pigmentSelect.append(optionElement);
    }
    pigmentSelect.addEventListener('change', () => {
      entry.pigmentId = pigmentSelect.value;
      render();
    });
    pigmentField.append(pigmentLabel, pigmentSelect);

    const partsField = document.createElement('label');
    partsField.className = 'probe-field probe-field-parts';
    const partsLabel = document.createElement('span');
    partsLabel.textContent = 'Parts';
    const partsInput = document.createElement('input');
    partsInput.type = 'number';
    partsInput.min = '1';
    partsInput.max = '999';
    partsInput.step = '1';
    partsInput.value = String(entry.parts);
    partsInput.addEventListener('input', () => {
      entry.parts = sanitizePositiveInt(partsInput.value, 1);
      render();
    });
    partsField.append(partsLabel, partsInput);

    row.append(pigmentField, partsField);

    if (state.probeEntries.length > 1) {
      const removeButton = document.createElement('button');
      removeButton.className = 'probe-remove';
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        state.probeEntries.splice(index, 1);
        render();
      });
      row.append(removeButton);
    }

    elements.probeRows.append(row);
  });
}

function addPigmentToProbe(pigmentId) {
  const existing = state.probeEntries.find((entry) => entry.pigmentId === pigmentId);
  if (existing != null) {
    existing.parts += 1;
    render();
    return;
  }

  if (state.probeEntries.length >= MAX_PROBE_ROWS) return;
  state.probeEntries.push({ pigmentId, parts: 1 });
  render();
}

function normalizeProbeEntries() {
  const fallbackPigmentId = state.palette[0]?.id ?? null;
  const normalized = state.probeEntries
    .map((entry) => ({
      pigmentId: state.palette.some((pigment) => pigment.id === entry.pigmentId) ? entry.pigmentId : fallbackPigmentId,
      parts: sanitizePositiveInt(entry.parts, 1),
    }))
    .filter((entry) => entry.pigmentId != null);

  const merged = [];
  for (const entry of normalized) {
    const existing = merged.find((candidate) => candidate.pigmentId === entry.pigmentId);
    if (existing != null) {
      existing.parts += entry.parts;
    } else {
      merged.push(entry);
    }
  }

  state.probeEntries = merged.slice(0, MAX_PROBE_ROWS);

  if (state.probeEntries.length === 0 && fallbackPigmentId != null) {
    state.probeEntries = [{ pigmentId: fallbackPigmentId, parts: 1 }];
  }
}

function sanitizePositiveInt(value, fallback) {
  const numeric = Number.parseInt(String(value), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveProbeRecipe() {
  const paletteById = new Map(state.palette.map((pigment) => [pigment.id, pigment]));
  return state.probeEntries.flatMap((entry) => {
    const pigment = paletteById.get(entry.pigmentId);
    if (pigment == null || entry.parts <= 0) return [];
    return [{
      id: pigment.id,
      label: pigment.hex,
      hex: pigment.hex,
      parts: entry.parts,
    }];
  });
}

function summarizeProbe(recipe) {
  if (recipe.length === 0) {
    return {
      correctedHex: PAPER_COLOR,
      baseHex: PAPER_COLOR,
      summary: 'Add at least one color to inspect the full model against the physical base model.',
    };
  }

  if (state.runtimeStatus === 'loading' || state.runtimeStatus === 'idle') {
    return {
      correctedHex: PAPER_COLOR,
      baseHex: PAPER_COLOR,
      summary: `Loading ${currentRuntimeEntry()?.label ?? 'selected'} runtime...`,
    };
  }

  if (state.runtimeStatus === 'error' || state.runtimeApi == null || state.correctedMixer == null || state.baseMixer == null) {
    return {
      correctedHex: PAPER_COLOR,
      baseHex: PAPER_COLOR,
      summary: `Unable to load ${currentRuntimeEntry()?.label ?? 'selected'} runtime.`,
    };
  }

  const { MixPortion, SrgbColor } = state.runtimeApi;
  const portions = recipe.map((entry) => new MixPortion({
    color: SrgbColor.fromHex(entry.hex),
    parts: entry.parts,
  }));
  const correctedHex = state.correctedMixer.mixOrNull(portions)?.toHexString() ?? PAPER_COLOR;
  const baseHex = state.baseMixer.mixOrNull(portions)?.toHexString() ?? PAPER_COLOR;
  const recipeLabel = recipe.map((entry) => `${entry.label} × ${entry.parts}`).join(' + ');

  return {
    correctedHex,
    baseHex,
    summary: recipeLabel,
  };
}

function setProbeCompare(correctedHex, baseHex) {
  elements.probeHexCorrected.textContent = correctedHex;
  elements.probeHexBase.textContent = baseHex;
  elements.probeSwatchCorrected.style.setProperty('--probe-result', correctedHex);
  elements.probeSwatchBase.style.setProperty('--probe-result', baseHex);
}

function renderProbeRatioBar(recipe) {
  elements.probeRatioBar.innerHTML = '';
  if (recipe.length === 0) return;

  for (const entry of recipe) {
    const segment = document.createElement('span');
    segment.className = 'quick-mix-ratio-segment';
    segment.style.setProperty('--segment-color', entry.hex);
    segment.style.setProperty('flex-grow', String(entry.parts));
    segment.title = `${entry.label} × ${entry.parts}`;
    elements.probeRatioBar.append(segment);
  }
}

function renderUsageTabs() {
  elements.usageTabs.forEach((button) => {
    const active = button.dataset.usageTab === state.usageTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });

  elements.usagePanels.forEach((panel) => {
    const active = panel.dataset.usagePanel === state.usageTab;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
}

function normalizeHex(value) {
  const raw = String(value).trim();
  if (raw.length === 0) return null;
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(prefixed)) {
    return null;
  }
  return `#${prefixed.slice(1).toUpperCase()}`;
}
