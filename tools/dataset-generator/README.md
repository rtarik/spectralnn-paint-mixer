# Dataset Generator

This directory exports the synthetic and curated training JSONL files used by the staged
residual-training loop.

## Install

```bash
npm install
```

## Run

From the staged repo root:

```bash
node tools/dataset-generator/export-training-data.js
```

Useful flags:

```bash
node tools/dataset-generator/export-training-data.js \
  --synthetic-count 50000 \
  --seed 42 \
  --output-dir tools/training/out/data
```

The exact-pair guardrail configuration lives in:

```text
tools/training/manual_opponent_pairs.json
```

Outputs land in:

```text
tools/training/out/data/
```

## Import Measured Source Data

Import the recovered Sensors 2021 supplementary spreadsheets into a measured
source-of-truth dataset:

```bash
python3 tools/dataset-generator/import_sensors_2021_measured.py \
  --concentration-xlsx /path/to/mockups_concentration.xlsx \
  --reflectance-xlsx /path/to/mockups_reflectance.xlsx \
  --output-dir artifacts/measured/sensors-2021-v1
```

This writes:

```text
artifacts/measured/sensors-2021-v1/
  manifest.json
  wavelengths_nm.json
  samples.jsonl
  pure-samples.jsonl
  binary-samples.jsonl
  ternary-samples.jsonl
```

Derive a binary `A + B = C` ground-truth dataset from that measured source:

```bash
node tools/dataset-generator/derive-sensors-2021-binary-ground-truth.mjs \
  --measured-dir artifacts/measured/sensors-2021-v1 \
  --output-dir artifacts/ground-truth/sensors-2021-binary-v1
```

This writes:

```text
artifacts/ground-truth/sensors-2021-binary-v1/
  manifest.json
  paints.json
  samples.jsonl
```

Review the measured reflectance-to-color conversion for a measured dataset:

```bash
node tools/dataset-generator/review-measured-color-conversion.mjs \
  --measured-dir artifacts/measured/sensors-2021-v1 \
  --output-dir artifacts/measured/sensors-2021-v1
```

This writes:

```text
artifacts/measured/sensors-2021-v1/
  color-conversion-review.json
  color-conversion-review.txt
```

Import the recovered HYPERDOC 2025 supplementary files into a measured
source-of-truth dataset:

```bash
python3 tools/dataset-generator/import_hyperdoc_2025_measured.py \
  --info-ods 'Supplementary information/Information_Mockups/MOCK-UP-SAMPLES_DATABASE .ods' \
  --color-ods 'Supplementary information/Color_analysis/Chromatic_Coordinates_HSI_Hyperdoc.ods' \
  --hsi-csv-dir 'Supplementary information/HSI_Mean_Spectra/csv' \
  --output-dir artifacts/measured/hyperdoc-2025-v1
```

This writes:

```text
artifacts/measured/hyperdoc-2025-v1/
  manifest.json
  wavelengths_vnir_nm.json
  wavelengths_swir_nm.json
  samples.jsonl
  pure-colorant-samples.jsonl
  control-samples.jsonl
  binary-mixture-samples.jsonl
  ternary-mixture-samples.jsonl
  binary-superposition-samples.jsonl
```

Derive a binary `A + B = C` ground-truth dataset from that measured source:

```bash
node tools/dataset-generator/derive-hyperdoc-2025-binary-ground-truth.mjs \
  --measured-dir artifacts/measured/hyperdoc-2025-v1 \
  --output-dir artifacts/ground-truth/hyperdoc-2025-binary-v1
```

This writes:

```text
artifacts/ground-truth/hyperdoc-2025-binary-v1/
  manifest.json
  paints.json
  samples.jsonl
```

Import the workbook-accessible subset of the Cutajar 2024 oil-paint libraries:

```bash
python3 tools/dataset-generator/import_cutajar_2024_measured.py \
  --library1-xlsx 'Library (1).xlsx' \
  --library2-xlsx 'Library (2) .xlsx' \
  --metadata-pdf 'VNIR- and SWIR-HSI libraries for unvarnished oil paints.pdf' \
  --output-dir artifacts/measured/cutajar-2024-v1
```

This writes:

```text
artifacts/measured/cutajar-2024-v1/
  manifest.json
  wavelengths_library1_vnir_nm.json
  wavelengths_library2_vnir_nm.json
  wavelengths_library2_swir_nm.json
  samples.jsonl
  library1-pure-samples.jsonl
  library2-ground-samples.jsonl
  library2-pure-samples.jsonl
  library2-binary-samples.jsonl
  library2-ternary-samples.jsonl
```

Derive the workbook-accessible binary `A + B = C` view from Library (2):

```bash
node tools/dataset-generator/derive-cutajar-2024-binary-ground-truth.mjs \
  --measured-dir artifacts/measured/cutajar-2024-v1 \
  --output-dir artifacts/ground-truth/cutajar-2024-binary-v1
```

This writes:

```text
artifacts/ground-truth/cutajar-2024-binary-v1/
  manifest.json
  paints.json
  samples.jsonl
```

Build a quick static gallery to visually inspect the measured binary datasets:

```bash
node tools/dataset-generator/build-ground-truth-gallery.mjs
```

This writes:

```text
artifacts/ground-truth/gallery/index.html
```

Import the Bath 2016 reflectance archive into a measured source-of-truth
dataset:

```bash
python3 tools/dataset-generator/import_bath_2016_measured.py \
  --reflectance-dir Reflectance-Spectra \
  --paper-pdf source-5.pdf \
  --modelling-dir Computational-Modelling \
  --output-dir artifacts/measured/bath-2016-v1
```

This writes:

```text
artifacts/measured/bath-2016-v1/
  manifest.json
  wavelengths_nm.json
  samples.jsonl
  pure-samples.jsonl
  binary-mixture-samples.jsonl
  resolved-binary-mixture-samples.jsonl
  unresolved-binary-mixture-samples.jsonl
  binary-glaze-samples.jsonl
```

Derive a binary `A + B = C` ground-truth dataset from that measured source:

```bash
node tools/dataset-generator/derive-bath-2016-binary-ground-truth.mjs \
  --measured-dir artifacts/measured/bath-2016-v1 \
  --output-dir artifacts/ground-truth/bath-2016-binary-v1
```

This writes:

```text
artifacts/ground-truth/bath-2016-binary-v1/
  manifest.json
  paints.json
  samples.jsonl
```

Import reviewed short-form video screenshots into an observational `A + B = C`
dataset:

```bash
python3 tools/dataset-generator/import_color_mixing_screenshots.py \
  --metadata-json tools/dataset-generator/color-mixing-screenshots-v1.metadata.json \
  --screenshots-dir color-mixing \
  --output-dir artifacts/ground-truth/color-mixing-screenshots-v1
```

This writes:

```text
artifacts/ground-truth/color-mixing-screenshots-v1/
  manifest.json
  paints.json
  samples.jsonl
  screenshots.json
```
