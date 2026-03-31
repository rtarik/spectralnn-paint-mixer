#!/usr/bin/env python3

import argparse
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


ODS_TABLE_NS = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
ODS_TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"

SUPPORTS = {
    "A": {
        "label": "Paper",
        "description": "Paper (cotton-linen(1:1))",
    },
    "B": {
        "label": "Parchment",
        "description": "Parchment",
    },
}

BINDER_CODES = {
    "Gum arabic": "ga",
    "Egg glair": "eg",
    "-": "none",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import the HYPERDOC 2025 measured mock-up data into a JSONL dataset."
    )
    parser.add_argument(
        "--info-ods",
        required=True,
        type=Path,
        help="Path to MOCK-UP-SAMPLES_DATABASE .ods",
    )
    parser.add_argument(
        "--color-ods",
        type=Path,
        default=None,
        help="Optional path to Chromatic_Coordinates_HSI_Hyperdoc.ods",
    )
    parser.add_argument(
        "--hsi-csv-dir",
        required=True,
        type=Path,
        help="Path to HSI_Mean_Spectra/csv directory",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/measured/hyperdoc-2025-v1"),
    )
    return parser.parse_args()


def normalize_text(value):
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def read_ods_rows(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("content.xml"))

    table = root.find(f".//{ODS_TABLE_NS}table")
    if table is None:
        raise ValueError(f"No worksheet found in {path}")

    rows = []
    for row_node in table.findall(f"{ODS_TABLE_NS}table-row"):
        values = []
        for cell_node in row_node.findall(f"{ODS_TABLE_NS}table-cell"):
            repeat = int(cell_node.attrib.get(f"{ODS_TABLE_NS}number-columns-repeated", "1"))
            paragraphs = [
                normalize_text("".join(paragraph.itertext()))
                for paragraph in cell_node.findall(f".//{ODS_TEXT_NS}p")
            ]
            text = " ".join(part for part in paragraphs if part)
            values.extend([text] * repeat)
        if any(values):
            rows.append(values)
    return rows


def detect_interaction_type(sample_name):
    upper_name = sample_name.upper()
    if upper_name.startswith("SUPERPOSITION:"):
        return "superposition"
    if upper_name.startswith("MIXTURE:") or upper_name.startswith("MEZCLA:"):
        return "mixture"
    return "single_layer"


def split_components(acronym, interaction_type):
    delimiter = "/" if interaction_type == "superposition" else "+"
    return [part.strip() for part in acronym.split(delimiter) if part.strip()]


def category_for_logical_sample(sample_name, binder):
    interaction_type = detect_interaction_type(sample_name)
    if interaction_type == "mixture":
        return "mixture"
    if interaction_type == "superposition":
        return "superposition"
    if binder == "-":
        return "control"
    return "pure_colorant"


def logical_sample_id(number):
    return f"hyperdoc-2025-{number:02d}"


def measured_sample_id(number, support_code):
    return f"hyperdoc-2025-{number:02d}{support_code}"


def build_logical_samples(info_rows):
    data_rows = info_rows[2:]
    logical_samples = []
    for row in data_rows:
        number = int(row[1])
        sample_name = normalize_text(row[2])
        acronym = normalize_text(row[3])
        binder = normalize_text(row[4])
        composition = normalize_text(row[5])
        supports = normalize_text(row[6])
        interaction_type = detect_interaction_type(sample_name)
        category = category_for_logical_sample(sample_name, binder)
        component_codes = split_components(acronym, interaction_type) if interaction_type != "single_layer" else [acronym]

        if interaction_type == "mixture" and len(component_codes) not in {2, 3}:
            raise ValueError(f"Unexpected mixture arity for sample {number}: {acronym}")
        if interaction_type == "superposition" and len(component_codes) != 2:
            raise ValueError(f"Unexpected superposition arity for sample {number}: {acronym}")

        if category == "mixture":
            ratio_basis = "prepared_paint_volume"
        elif category == "superposition":
            ratio_basis = "layer_order_with_equal_application_recipe"
        elif category == "pure_colorant":
            ratio_basis = "single_paint_recipe"
        else:
            ratio_basis = "reference_control"

        logical_samples.append(
            {
                "id": logical_sample_id(number),
                "number": number,
                "sampleName": sample_name,
                "acronym": acronym,
                "binder": binder,
                "binderCode": BINDER_CODES.get(binder, "unknown"),
                "compositionText": composition,
                "supportsText": supports,
                "interactionType": interaction_type,
                "category": category,
                "mixtureArity": len(component_codes),
                "ratioBasis": ratio_basis,
                "nominalParts": [1] * len(component_codes),
                "componentCodes": component_codes,
            }
        )
    return logical_samples


def build_endpoint_lookup(logical_samples):
    endpoint_lookup = {}
    for logical_sample in logical_samples:
        if logical_sample["category"] != "pure_colorant":
            continue
        key = (logical_sample["binder"], logical_sample["acronym"])
        if key in endpoint_lookup:
            raise ValueError(f"Duplicate pure endpoint for {key}")
        endpoint_lookup[key] = logical_sample
    return endpoint_lookup


def attach_component_metadata(logical_samples, endpoint_lookup):
    unresolved_samples = []

    for logical_sample in logical_samples:
        if logical_sample["category"] in {"pure_colorant", "control"}:
            component_kind = "prepared_colorant" if logical_sample["category"] == "pure_colorant" else "reference_control"
            logical_sample["components"] = [
                {
                    "componentCode": logical_sample["acronym"],
                    "componentName": logical_sample["sampleName"],
                    "componentKind": component_kind,
                    "binder": logical_sample["binder"],
                    "sourceLogicalSampleId": logical_sample["id"],
                    "sourceLogicalSampleNumber": logical_sample["number"],
                    "resolutionStatus": "self",
                    "nominalPart": 1,
                }
            ]
            logical_sample["hasResolvedPureColorantEndpoints"] = logical_sample["category"] == "pure_colorant"
            continue

        components = []
        unresolved_components = []
        for component_code in logical_sample["componentCodes"]:
            endpoint = endpoint_lookup.get((logical_sample["binder"], component_code))
            if endpoint is None:
                unresolved_components.append(component_code)
                components.append(
                    {
                        "componentCode": component_code,
                        "componentName": component_code,
                        "componentKind": "unresolved_endpoint",
                        "binder": logical_sample["binder"],
                        "sourceLogicalSampleId": None,
                        "sourceLogicalSampleNumber": None,
                        "resolutionStatus": "missing",
                        "nominalPart": 1,
                    }
                )
                continue

            components.append(
                {
                    "componentCode": component_code,
                    "componentName": endpoint["sampleName"],
                    "componentKind": "prepared_colorant",
                    "binder": logical_sample["binder"],
                    "sourceLogicalSampleId": endpoint["id"],
                    "sourceLogicalSampleNumber": endpoint["number"],
                    "resolutionStatus": "resolved",
                    "nominalPart": 1,
                }
            )

        logical_sample["components"] = components
        logical_sample["hasResolvedPureColorantEndpoints"] = len(unresolved_components) == 0
        if unresolved_components:
            unresolved_samples.append(
                {
                    "logicalSampleId": logical_sample["id"],
                    "logicalSampleNumber": logical_sample["number"],
                    "acronym": logical_sample["acronym"],
                    "binder": logical_sample["binder"],
                    "missingComponentCodes": unresolved_components,
                }
            )

    return unresolved_samples


def read_spectral_csv(path):
    wavelengths = []
    reflectance = []
    for raw_line in path.read_text(encoding="utf8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        wavelength_text, reflectance_text = line.split(",", 1)
        wavelengths.append(float(wavelength_text))
        reflectance.append(float(reflectance_text))
    return wavelengths, reflectance


def load_hsi_spectra(csv_dir):
    pattern = re.compile(r"^(?P<number>\d+)(?P<support>[AB])-HSI_(?P<kind>VNIR|SWIR)-")
    records_by_sample = defaultdict(dict)
    wavelengths_by_kind = {}

    for path in sorted(csv_dir.glob("*.csv")):
        match = pattern.match(path.name)
        if match is None:
            continue

        sample_code = f"{int(match.group('number')):02d}{match.group('support')}"
        kind = match.group("kind").lower()
        wavelengths, reflectance = read_spectral_csv(path)

        known_wavelengths = wavelengths_by_kind.get(kind)
        if known_wavelengths is None:
            wavelengths_by_kind[kind] = wavelengths
        elif known_wavelengths != wavelengths:
            raise ValueError(f"Inconsistent {kind.upper()} wavelength grid in {path}")

        records_by_sample[sample_code][kind] = {
            "fileName": path.name,
            "reflectance": reflectance,
        }

    expected_kinds = {"vnir", "swir"}
    missing = [
        sample_code
        for sample_code, kinds in sorted(records_by_sample.items())
        if set(kinds.keys()) != expected_kinds
    ]
    if missing:
        raise ValueError(f"Some HSI samples are missing VNIR or SWIR files: {missing[:10]}")

    return records_by_sample, wavelengths_by_kind["vnir"], wavelengths_by_kind["swir"]


def summarize(samples):
    counter = Counter()
    for sample in samples:
        counter[sample["category"]] += 1
    return dict(counter)


def jsonl_dump(path, records):
    path.write_text("".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records), encoding="utf8")


def build_measured_samples(logical_samples, spectra_by_sample):
    samples = []
    for logical_sample in logical_samples:
        for support_code, support_meta in SUPPORTS.items():
            sample_code = f"{logical_sample['number']:02d}{support_code}"
            spectra = spectra_by_sample.get(sample_code)
            if spectra is None:
                raise ValueError(f"Missing HSI spectra for sample {sample_code}")

            samples.append(
                {
                    "id": measured_sample_id(logical_sample["number"], support_code),
                    "sampleCode": sample_code,
                    "logicalSampleId": logical_sample["id"],
                    "logicalSampleNumber": logical_sample["number"],
                    "logicalSampleName": logical_sample["sampleName"],
                    "logicalAcronym": logical_sample["acronym"],
                    "sourceType": "measured_spectral_mix",
                    "reviewStatus": "draft",
                    "category": (
                        "binary_mixture" if logical_sample["category"] == "mixture" and logical_sample["mixtureArity"] == 2
                        else "ternary_mixture" if logical_sample["category"] == "mixture" and logical_sample["mixtureArity"] == 3
                        else "binary_superposition" if logical_sample["category"] == "superposition"
                        else logical_sample["category"]
                    ),
                    "interactionType": logical_sample["interactionType"],
                    "mixtureArity": logical_sample["mixtureArity"],
                    "ratioBasis": logical_sample["ratioBasis"],
                    "nominalParts": logical_sample["nominalParts"],
                    "binder": logical_sample["binder"],
                    "binderCode": logical_sample["binderCode"],
                    "supportCode": support_code,
                    "supportLabel": support_meta["label"],
                    "supportDescription": support_meta["description"],
                    "components": logical_sample["components"],
                    "hasResolvedPureColorantEndpoints": logical_sample["hasResolvedPureColorantEndpoints"],
                    "compositionText": logical_sample["compositionText"],
                    "supportsText": logical_sample["supportsText"],
                    "measuredVnirReflectance": spectra["vnir"]["reflectance"],
                    "measuredSwirReflectance": spectra["swir"]["reflectance"],
                    "source": {
                        "kind": "supplement_import",
                        "paper": "Reichert et al. (Analytical and Bioanalytical Chemistry 2025)",
                        "articleUrl": "https://link.springer.com/article/10.1007/s00216-025-05948-3",
                        "doi": "10.1007/s00216-025-05948-3",
                        "sampleCode": sample_code,
                        "logicalSampleNumber": logical_sample["number"],
                        "supportCode": support_code,
                        "vnirFile": spectra["vnir"]["fileName"],
                        "swirFile": spectra["swir"]["fileName"],
                    },
                    "notes": f"{logical_sample['sampleName']} ({sample_code}) on {support_meta['label']}",
                }
            )
    return samples


def write_output(output_dir, manifest, vnir_wavelengths_nm, swir_wavelengths_nm, samples):
    output_dir.mkdir(parents=True, exist_ok=True)

    pure_colorant_samples = [sample for sample in samples if sample["category"] == "pure_colorant"]
    control_samples = [sample for sample in samples if sample["category"] == "control"]
    binary_mixture_samples = [sample for sample in samples if sample["category"] == "binary_mixture"]
    ternary_mixture_samples = [sample for sample in samples if sample["category"] == "ternary_mixture"]
    superposition_samples = [sample for sample in samples if sample["category"] == "binary_superposition"]

    (output_dir / "manifest.json").write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_vnir_nm.json").write_text(f"{json.dumps(vnir_wavelengths_nm, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_swir_nm.json").write_text(f"{json.dumps(swir_wavelengths_nm, indent=2)}\n", encoding="utf8")
    jsonl_dump(output_dir / "samples.jsonl", samples)
    jsonl_dump(output_dir / "pure-colorant-samples.jsonl", pure_colorant_samples)
    jsonl_dump(output_dir / "control-samples.jsonl", control_samples)
    jsonl_dump(output_dir / "binary-mixture-samples.jsonl", binary_mixture_samples)
    jsonl_dump(output_dir / "ternary-mixture-samples.jsonl", ternary_mixture_samples)
    jsonl_dump(output_dir / "binary-superposition-samples.jsonl", superposition_samples)


def main():
    args = parse_args()
    info_rows = read_ods_rows(args.info_ods)
    logical_samples = build_logical_samples(info_rows)
    endpoint_lookup = build_endpoint_lookup(logical_samples)
    unresolved_components = attach_component_metadata(logical_samples, endpoint_lookup)
    spectra_by_sample, vnir_wavelengths_nm, swir_wavelengths_nm = load_hsi_spectra(args.hsi_csv_dir)
    samples = build_measured_samples(logical_samples, spectra_by_sample)

    eligible_binary_samples = [
        sample
        for sample in samples
        if sample["category"] == "binary_mixture" and sample["hasResolvedPureColorantEndpoints"]
    ]
    ineligible_binary_samples = [
        sample
        for sample in samples
        if sample["category"] == "binary_mixture" and not sample["hasResolvedPureColorantEndpoints"]
    ]

    manifest = {
        "datasetVersion": 1,
        "datasetId": "hyperdoc-2025-manuscript-mockups-v1",
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Measured manuscript mock-up dataset imported from the HYPERDOC 2025 supplementary ODS workbook and HSI mean spectra CSV files.",
        "sourcePaper": {
            "title": "Database of diffuse reflectance infrared Fourier transform spectroscopy (DRIFTS) and hyperspectral imaging (HSI) spectra of pigments and dyes for historical document analysis",
            "authors": [
                "Anna Sofia Reichert",
                "Ana Belen Lopez-Baldomero",
                "Francisco Moronta-Montero",
                "Ana Lopez-Montes",
                "Eva Maria Valero",
                "Carolina Cardell",
            ],
            "journal": "Analytical and Bioanalytical Chemistry",
            "year": 2025,
            "doi": "10.1007/s00216-025-05948-3",
            "articleUrl": "https://link.springer.com/article/10.1007/s00216-025-05948-3",
            "datasetUrl": "https://doi.org/10.6084/m9.figshare.28639103.v3",
        },
        "sourceFiles": {
            "mockupWorkbook": str(args.info_ods),
            "chromaticCoordinateWorkbook": str(args.color_ods) if args.color_ods is not None else None,
            "hsiCsvDirectory": str(args.hsi_csv_dir),
        },
        "supportVariants": [
            {"code": code, **payload}
            for code, payload in SUPPORTS.items()
        ],
        "spectralEncodings": {
            "vnir": "reflectance_factor",
            "swir": "reflectance_factor",
        },
        "wavelengths": {
            "vnirCount": len(vnir_wavelengths_nm),
            "vnirRangeNm": [vnir_wavelengths_nm[0], vnir_wavelengths_nm[-1]],
            "swirCount": len(swir_wavelengths_nm),
            "swirRangeNm": [swir_wavelengths_nm[0], swir_wavelengths_nm[-1]],
        },
        "logicalSampleCount": len(logical_samples),
        "sampleCount": len(samples),
        "logicalSampleSummary": dict(Counter(sample["category"] for sample in logical_samples)),
        "sampleSummary": summarize(samples),
        "binaryMixtureEligibility": {
            "eligibleMeasuredSamples": len(eligible_binary_samples),
            "ineligibleMeasuredSamples": len(ineligible_binary_samples),
            "ineligibleSampleIds": [sample["id"] for sample in ineligible_binary_samples],
        },
        "componentResolutionIssues": unresolved_components,
        "curationNotes": [
            "VNIR and SWIR spectra are stored separately rather than stitched because their 900-1000 nm overlap is not numerically identical.",
            "True pigment mixtures and superpositions are kept as distinct categories.",
            "Paper and parchment are preserved as separate measured samples for the same logical recipe.",
            "Component linkage is resolved from standardized acronyms plus binder rather than from free-text n.o references, which are not consistently reliable in the workbook.",
        ],
        "files": {
            "wavelengthsVnirNm": "wavelengths_vnir_nm.json",
            "wavelengthsSwirNm": "wavelengths_swir_nm.json",
            "samples": "samples.jsonl",
            "pureColorantSamples": "pure-colorant-samples.jsonl",
            "controlSamples": "control-samples.jsonl",
            "binaryMixtureSamples": "binary-mixture-samples.jsonl",
            "ternaryMixtureSamples": "ternary-mixture-samples.jsonl",
            "binarySuperpositionSamples": "binary-superposition-samples.jsonl",
        },
    }

    output_dir = args.output_dir.resolve()
    write_output(output_dir, manifest, vnir_wavelengths_nm, swir_wavelengths_nm, samples)

    print(f"Imported {len(samples)} measured samples into {output_dir}")
    print(f"Logical samples: {len(logical_samples)}")
    print(f"Sample summary: {manifest['sampleSummary']}")
    print(f"Eligible binary measured samples: {len(eligible_binary_samples)}")
    print(f"Ineligible binary measured samples: {len(ineligible_binary_samples)}")


if __name__ == "__main__":
    main()
