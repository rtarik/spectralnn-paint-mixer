#!/usr/bin/env python3

import argparse
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path


PURE_PIGMENTS = {
    "VRM": "Vermilion",
    "RL": "Red lead",
    "LTY": "Lead-tin yellow",
    "LW": "Lead white",
}

ARTICLE_METADATA = {
    "title": "Estimation of semiconductor-like pigment concentrations in paint mixtures and their differentiation from paint layers using first-derivative reflectance spectra",
    "authors": [
        "Anuradha R. Pallipurath",
        "Jonathan M. Skelton",
        "Paola Ricciardi",
        "Stephen R. Elliott",
    ],
    "journal": "Talanta",
    "year": 2016,
    "articleUrl": "https://research.manchester.ac.uk/en/publications/estimation-of-semiconductor-like-pigment-concentrations-in-paint-",
    "datasetUrl": "https://researchportal.bath.ac.uk/en/datasets/data-for-estimation-of-semiconductor-like-pigment-concentrations-/",
    "datasetDoi": "10.15125/BATH-00183",
}

SPECTRUM_FILE_RE = re.compile(r"^(?P<folder>.+)_Spectrum(?P<index>\d+)\.asd\.sco\.txt$")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import the Bath 2016 reflectance spectra archive into a measured JSONL dataset."
    )
    parser.add_argument(
        "--reflectance-dir",
        required=True,
        type=Path,
        help="Path to the Reflectance-Spectra directory.",
    )
    parser.add_argument(
        "--paper-pdf",
        type=Path,
        default=None,
        help="Optional path to the source article PDF.",
    )
    parser.add_argument(
        "--modelling-dir",
        type=Path,
        default=None,
        help="Optional path to the Computational-Modelling directory.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/measured/bath-2016-v1"),
    )
    return parser.parse_args()


def read_spectrum(path):
    lines = path.read_text(encoding="utf8").splitlines()
    if not lines:
        raise ValueError(f"Empty spectrum file: {path}")
    header = lines[0].strip()
    if header != "Wavelength\tReflectance":
        raise ValueError(f"Unexpected header in {path}: {header!r}")

    wavelengths = []
    reflectance = []
    for raw_line in lines[1:]:
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            raise ValueError(f"Unexpected spectrum row in {path}: {raw_line!r}")
        wavelengths.append(float(parts[0]))
        reflectance.append(float(parts[1]))
    return wavelengths, reflectance


def simplify_parts(fractions):
    approximations = [Fraction(value).limit_denominator(10) for value in fractions]
    common_denominator = math.lcm(*(fraction.denominator for fraction in approximations))
    parts = [int(fraction * common_denominator) for fraction in approximations]
    divisor = math.gcd(*parts)
    return [value // divisor for value in parts]


def parse_folder_metadata(folder_name):
    if folder_name.endswith("_Pure"):
        component_code = folder_name[:-5]
        return {
            "category": "pure_colorant",
            "interactionType": "single_paint",
            "mixtureArity": 1,
            "ratioBasis": "single_paint_recipe",
            "proportionKnown": True,
            "nominalParts": [1],
            "sourceMassFractions": [1.0],
            "sourcePercentages": [100.0],
            "componentCodes": [component_code],
        }

    if folder_name.endswith("_Glaze"):
        component_codes = folder_name[:-6].split("-")
        if len(component_codes) != 2:
            raise ValueError(f"Unexpected glaze folder structure: {folder_name}")
        return {
            "category": "binary_glaze",
            "interactionType": "glaze_layer",
            "mixtureArity": 2,
            "ratioBasis": "ordered_layer_stack",
            "proportionKnown": False,
            "nominalParts": [1, 1],
            "sourceMassFractions": None,
            "sourcePercentages": None,
            "componentCodes": component_codes,
        }

    component_block, percentage_block = folder_name.split("_", 1)
    component_codes = component_block.split("-")
    percentages = [float(value) for value in percentage_block.split("-")]
    fractions = [value / 100.0 for value in percentages]
    nominal_parts = simplify_parts(fractions)
    exact_mass_fractions = [part / sum(nominal_parts) for part in nominal_parts]

    if len(component_codes) != 2 or len(percentages) != 2:
        raise ValueError(f"Unexpected binary-mixture folder structure: {folder_name}")

    return {
        "category": "binary_mixture",
        "interactionType": "physical_mixture",
        "mixtureArity": 2,
        "ratioBasis": "mass_fraction",
        "proportionKnown": True,
        "nominalParts": nominal_parts,
        "sourceMassFractions": exact_mass_fractions,
        "sourcePercentages": percentages,
        "componentCodes": component_codes,
    }


def build_component_records(component_codes, pure_lookup):
    records = []
    for component_code in component_codes:
        pure_samples = pure_lookup.get(component_code, [])
        records.append(
            {
                "componentCode": component_code,
                "componentName": PURE_PIGMENTS.get(component_code, component_code),
                "componentKind": "prepared_colorant",
                "sourceSampleIds": [sample["id"] for sample in pure_samples],
                "sourceSampleCodes": [sample["sampleCode"] for sample in pure_samples],
                "resolutionStatus": "resolved" if pure_samples else "missing_pure_endpoint_in_archive",
            }
        )
    return records


def jsonl_dump(path, records):
    path.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf8",
    )


def summarize(samples):
    return dict(Counter(sample["category"] for sample in samples))


def main():
    args = parse_args()
    reflectance_dir = args.reflectance_dir.resolve()
    output_dir = args.output_dir.resolve()

    if not reflectance_dir.is_dir():
        raise ValueError(f"Reflectance directory not found: {reflectance_dir}")

    samples = []
    wavelengths_nm = None

    folder_paths = sorted(path for path in reflectance_dir.iterdir() if path.is_dir())
    if not folder_paths:
        raise ValueError(f"No sample folders found in {reflectance_dir}")

    for folder_path in folder_paths:
        metadata = parse_folder_metadata(folder_path.name)
        spectrum_paths = sorted(folder_path.glob("*.asd.sco.txt"))
        derivative_lookup = {
            path.name.replace(".asd.sco.dv1.txt", ""): path.name
            for path in folder_path.glob("*.asd.sco.dv1.txt")
        }

        if not spectrum_paths:
            raise ValueError(f"No raw spectra found in {folder_path}")

        for spectrum_path in spectrum_paths:
            match = SPECTRUM_FILE_RE.match(spectrum_path.name)
            if match is None:
                raise ValueError(f"Unexpected spectrum filename: {spectrum_path.name}")

            replicate_index = int(match.group("index"))
            file_wavelengths_nm, reflectance = read_spectrum(spectrum_path)
            if wavelengths_nm is None:
                wavelengths_nm = file_wavelengths_nm
            elif wavelengths_nm != file_wavelengths_nm:
                raise ValueError(f"Inconsistent wavelength grid in {spectrum_path}")

            derivative_file_name = derivative_lookup.get(spectrum_path.name.replace(".asd.sco.txt", ""))
            sample_id = f"bath-2016-{folder_path.name.lower().replace('.', 'p')}-r{replicate_index}"

            samples.append(
                {
                    "id": sample_id,
                    "sampleCode": folder_path.name,
                    "replicateIndex": replicate_index,
                    "sourceType": "measured_spectral_mix",
                    "reviewStatus": "draft",
                    "category": metadata["category"],
                    "interactionType": metadata["interactionType"],
                    "mixtureArity": metadata["mixtureArity"],
                    "ratioBasis": metadata["ratioBasis"],
                    "proportionKnown": metadata["proportionKnown"],
                    "nominalParts": metadata["nominalParts"],
                    "sourceMassFractions": metadata["sourceMassFractions"],
                    "sourcePercentages": metadata["sourcePercentages"],
                    "componentCodes": metadata["componentCodes"],
                    "components": [],
                    "hasResolvedPureColorantEndpoints": None,
                    "measuredReflectance": reflectance,
                    "source": {
                        "kind": "dataset_archive_import",
                        "paper": ARTICLE_METADATA["title"],
                        "articleUrl": ARTICLE_METADATA["articleUrl"],
                        "datasetUrl": ARTICLE_METADATA["datasetUrl"],
                        "datasetDoi": ARTICLE_METADATA["datasetDoi"],
                        "folder": folder_path.name,
                        "reflectanceFile": spectrum_path.name,
                        "derivativeFile": derivative_file_name,
                    },
                    "notes": f"{folder_path.name} replicate {replicate_index}",
                }
            )

    pure_lookup = {}
    for sample in samples:
        if sample["category"] != "pure_colorant":
            continue
        component_code = sample["componentCodes"][0]
        pure_lookup.setdefault(component_code, []).append(sample)

    component_resolution_issues = []
    for sample in samples:
        sample["components"] = build_component_records(sample["componentCodes"], pure_lookup)
        sample["hasResolvedPureColorantEndpoints"] = all(
            component["resolutionStatus"] == "resolved"
            for component in sample["components"]
        )
        if sample["category"] == "binary_mixture" and not sample["hasResolvedPureColorantEndpoints"]:
            component_resolution_issues.append(
                {
                    "sampleId": sample["id"],
                    "sampleCode": sample["sampleCode"],
                    "missingComponentCodes": [
                        component["componentCode"]
                        for component in sample["components"]
                        if component["resolutionStatus"] != "resolved"
                    ],
                }
            )

    pure_samples = [sample for sample in samples if sample["category"] == "pure_colorant"]
    binary_mixture_samples = [sample for sample in samples if sample["category"] == "binary_mixture"]
    resolved_binary_mixture_samples = [
        sample for sample in binary_mixture_samples if sample["hasResolvedPureColorantEndpoints"]
    ]
    unresolved_binary_mixture_samples = [
        sample for sample in binary_mixture_samples if not sample["hasResolvedPureColorantEndpoints"]
    ]
    binary_glaze_samples = [sample for sample in samples if sample["category"] == "binary_glaze"]

    manifest = {
        "datasetVersion": 1,
        "datasetId": "bath-2016-paint-mixtures-v1",
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Measured paint-mixture dataset imported from the University of Bath 2016 reflectance archive accompanying the Talanta pigment-mixture study.",
        "sourcePaper": ARTICLE_METADATA,
        "sourceFiles": {
            "paperPdf": str(args.paper_pdf.resolve()) if args.paper_pdf is not None else None,
            "reflectanceDirectory": str(reflectance_dir),
            "computationalModellingDirectory": (
                str(args.modelling_dir.resolve()) if args.modelling_dir is not None else None
            ),
        },
        "medium": "prepared_paint_samples_for_reflectance_spectroscopy",
        "support": "prepared_paint_samples_on_cards_or_panels_as_distributed_in_archive",
        "spectralEncoding": "reflectance_factor",
        "wavelengths": {
            "count": len(wavelengths_nm),
            "rangeNm": [wavelengths_nm[0], wavelengths_nm[-1]],
            "visibleSubsetRangeNm": [380, 750],
        },
        "sampleCount": len(samples),
        "sampleSummary": summarize(samples),
        "binaryMixtureEligibility": {
            "eligibleMeasuredSamples": len(resolved_binary_mixture_samples),
            "ineligibleMeasuredSamples": len(unresolved_binary_mixture_samples),
            "missingPureEndpointCodes": sorted(
                {
                    code
                    for issue in component_resolution_issues
                    for code in issue["missingComponentCodes"]
                }
            ),
        },
        "componentResolutionIssues": component_resolution_issues,
        "curationNotes": [
            "The archive includes both true binary mixtures and glaze/layer examples; those are kept as separate categories.",
            "Folder names encode replicate group, pigment codes, and ratio percentages for the mixture samples.",
            "Lead-white mixture folders are present, but no matching pure LW endpoint is distributed in the reflectance archive.",
            "Derivative companion files are preserved in source metadata but are not needed for the measured ground-truth import.",
        ],
        "files": {
            "wavelengthsNm": "wavelengths_nm.json",
            "samples": "samples.jsonl",
            "pureSamples": "pure-samples.jsonl",
            "binaryMixtureSamples": "binary-mixture-samples.jsonl",
            "resolvedBinaryMixtureSamples": "resolved-binary-mixture-samples.jsonl",
            "unresolvedBinaryMixtureSamples": "unresolved-binary-mixture-samples.jsonl",
            "binaryGlazeSamples": "binary-glaze-samples.jsonl",
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "manifest.json").write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_nm.json").write_text(f"{json.dumps(wavelengths_nm, indent=2)}\n", encoding="utf8")
    jsonl_dump(output_dir / "samples.jsonl", samples)
    jsonl_dump(output_dir / "pure-samples.jsonl", pure_samples)
    jsonl_dump(output_dir / "binary-mixture-samples.jsonl", binary_mixture_samples)
    jsonl_dump(output_dir / "resolved-binary-mixture-samples.jsonl", resolved_binary_mixture_samples)
    jsonl_dump(output_dir / "unresolved-binary-mixture-samples.jsonl", unresolved_binary_mixture_samples)
    jsonl_dump(output_dir / "binary-glaze-samples.jsonl", binary_glaze_samples)

    print(f"Imported {len(samples)} measured samples into {output_dir}")
    print(f"Sample summary: {manifest['sampleSummary']}")
    print(f"Eligible binary measured samples: {len(resolved_binary_mixture_samples)}")
    print(f"Ineligible binary measured samples: {len(unresolved_binary_mixture_samples)}")


if __name__ == "__main__":
    main()
