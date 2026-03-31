#!/usr/bin/env python3

import argparse
import json
import math
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


XLSX_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
XLSX_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

PIGMENT_METADATA = [
    {"code": "V", "name": "Vermilion", "manufacturerCode": "42000"},
    {"code": "O", "name": "Gold Ochre DD", "manufacturerCode": "40214"},
    {"code": "B", "name": "Ultramarine Blue", "manufacturerCode": "45030"},
    {"code": "W", "name": "Kremer White", "manufacturerCode": "46360"},
    {"code": "C", "name": "Carmine", "manufacturerCode": "23403"},
    {"code": "Y", "name": "Naples Yellow", "manufacturerCode": "43125"},
    {"code": "G", "name": "Viridian Green", "manufacturerCode": "44250"},
]

PIGMENT_BY_CODE = {entry["code"]: entry for entry in PIGMENT_METADATA}
PIGMENT_ORDER = [entry["code"] for entry in PIGMENT_METADATA]
FRACTION_EPSILON = 1e-9


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import the Sensors 2021 measured oil-mockup spreadsheets into a JSONL dataset."
    )
    parser.add_argument("--concentration-xlsx", required=True, type=Path)
    parser.add_argument("--reflectance-xlsx", required=True, type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/measured/sensors-2021-v1"),
    )
    return parser.parse_args()


def col_ref_to_index(ref):
    value = 0
    for char in ref:
        value = (value * 26) + (ord(char.upper()) - 64)
    return value


def read_workbook_rows(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in shared_root.findall(f"{XLSX_MAIN_NS}si"):
                text = "".join(node.text or "" for node in si.findall(f".//{XLSX_MAIN_NS}t"))
                shared_strings.append(text)

        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_target_by_id = {
            node.attrib["Id"]: node.attrib["Target"]
            for node in rels_root.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship")
        }

        first_sheet = workbook_root.find(f".//{XLSX_MAIN_NS}sheet")
        if first_sheet is None:
            raise ValueError(f"No worksheet found in {xlsx_path}")
        relationship_id = first_sheet.attrib[f"{XLSX_REL_NS}id"]
        worksheet_path = "xl/" + rel_target_by_id[relationship_id]

        worksheet_root = ET.fromstring(archive.read(worksheet_path))
        rows = []
        max_col = 0
        for row_node in worksheet_root.findall(f".//{XLSX_MAIN_NS}sheetData/{XLSX_MAIN_NS}row"):
            values_by_index = {}
            for cell in row_node.findall(f"{XLSX_MAIN_NS}c"):
                ref = cell.attrib.get("r", "")
                match = re.match(r"([A-Z]+)(\d+)", ref)
                col_index = col_ref_to_index(match.group(1)) if match else (len(values_by_index) + 1)
                max_col = max(max_col, col_index)

                cell_type = cell.attrib.get("t")
                value = ""
                inline = cell.find(f"{XLSX_MAIN_NS}is")
                if inline is not None:
                    value = "".join(node.text or "" for node in inline.findall(f".//{XLSX_MAIN_NS}t"))
                else:
                    value_node = cell.find(f"{XLSX_MAIN_NS}v")
                    if value_node is not None:
                        raw = value_node.text or ""
                        value = shared_strings[int(raw)] if cell_type == "s" else raw
                values_by_index[col_index] = value

            row = [values_by_index.get(index, "") for index in range(1, max_col + 1)]
            rows.append(row)
        return rows


def infer_pigment_order(concentration_rows):
    sample_codes = concentration_rows[0]
    pure_codes = [code for code in sample_codes if len(code) == 1]
    inferred = []
    for row in concentration_rows[1:]:
        matched = None
        for pure_code in pure_codes:
            sample_index = sample_codes.index(pure_code)
            if float(row[sample_index]) == 1.0:
                matched = pure_code
                break
        if matched is None:
            raise ValueError("Could not infer pigment identity from pure columns.")
        inferred.append(matched)
    return inferred


def infer_nominal_parts(fractions):
    if not fractions:
        return []
    min_fraction = min(fractions)
    raw_parts = [value / min_fraction for value in fractions]
    rounded_parts = [int(round(value)) for value in raw_parts]
    max_error = max(abs(value - rounded) for value, rounded in zip(raw_parts, rounded_parts))
    if max_error > 0.15:
        raise ValueError(f"Could not infer nominal parts from fractions {fractions}")
    return rounded_parts


def summarize(samples):
    summary = {}
    for sample in samples:
        summary[sample["category"]] = summary.get(sample["category"], 0) + 1
    return summary


def jsonl_dump(path, records):
    path.write_text("".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records), encoding="utf8")


def main():
    args = parse_args()
    concentration_rows = read_workbook_rows(args.concentration_xlsx)
    reflectance_rows = read_workbook_rows(args.reflectance_xlsx)

    concentration_headers = concentration_rows[0]
    reflectance_headers = reflectance_rows[0][1:]
    if concentration_headers != reflectance_headers:
        raise ValueError("Concentration and reflectance headers do not match.")

    inferred_order = infer_pigment_order(concentration_rows)
    if inferred_order != PIGMENT_ORDER:
        raise ValueError(f"Unexpected pigment order: {inferred_order}")

    wavelengths_nm = [float(row[0]) for row in reflectance_rows[1:]]
    reflectance_by_sample = {
        sample_code: [float(row[sample_index + 1]) for row in reflectance_rows[1:]]
        for sample_index, sample_code in enumerate(reflectance_headers)
    }

    samples = []
    for sample_index, sample_code in enumerate(concentration_headers):
        composition_entries = []
        for row_offset, pigment_code in enumerate(PIGMENT_ORDER):
            mass_fraction = float(concentration_rows[row_offset + 1][sample_index])
            pigment_meta = PIGMENT_BY_CODE[pigment_code]
            composition_entries.append(
                {
                    "pigmentCode": pigment_code,
                    "pigmentName": pigment_meta["name"],
                    "manufacturerCode": pigment_meta["manufacturerCode"],
                    "massFraction": mass_fraction,
                }
            )

        components = [entry.copy() for entry in composition_entries if entry["massFraction"] > FRACTION_EPSILON]
        nominal_parts = infer_nominal_parts([entry["massFraction"] for entry in components])
        for index, entry in enumerate(components):
            entry["nominalPart"] = nominal_parts[index]

        mixture_arity = len(components)
        category = {1: "pure", 2: "binary", 3: "ternary"}[mixture_arity]
        label = " + ".join(entry["pigmentName"] for entry in components)

        samples.append(
            {
                "id": f"sensors-2021-{sample_code}",
                "sampleCode": sample_code,
                "sourceType": "measured_spectral_mix",
                "reviewStatus": "draft",
                "category": category,
                "mixtureArity": mixture_arity,
                "ratioBasis": "mass_fraction",
                "nominalParts": nominal_parts,
                "components": components,
                "measuredReflectance": reflectance_by_sample[sample_code],
                "source": {
                    "kind": "supplement_import",
                    "paper": "Grillini, Thomas, George (Sensors 2021)",
                    "articleUrl": "https://www.mdpi.com/1424-8220/21/7/2471",
                    "doi": "10.3390/s21072471",
                    "sampleCode": sample_code,
                },
                "notes": f"{label} ({sample_code})",
            }
        )

    pure_samples = [sample for sample in samples if sample["mixtureArity"] == 1]
    binary_samples = [sample for sample in samples if sample["mixtureArity"] == 2]
    ternary_samples = [sample for sample in samples if sample["mixtureArity"] == 3]

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "datasetVersion": 1,
        "datasetId": "sensors-2021-oil-mockups-v1",
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Measured oil-paint mockup dataset imported from the Sensors 2021 supplementary spreadsheets.",
        "sourcePaper": {
            "title": "Comparison of Imaging Models for Spectral Unmixing in Oil Painting",
            "authors": ["Federico Grillini", "Jean-Baptiste Thomas", "Sony George"],
            "journal": "Sensors",
            "year": 2021,
            "doi": "10.3390/s21072471",
            "articleUrl": "https://www.mdpi.com/1424-8220/21/7/2471",
        },
        "sourceFiles": {
            "concentrationWorkbook": args.concentration_xlsx.name,
            "reflectanceWorkbook": args.reflectance_xlsx.name,
        },
        "pigmentOrder": PIGMENT_METADATA,
        "ratioBasis": "mass_fraction",
        "support": "pre-primed linen canvas with added acrylic gesso",
        "binder": "linseed oil",
        "spectralEncoding": "reflectance_factor",
        "wavelengthCount": len(wavelengths_nm),
        "wavelengthRangeNm": [wavelengths_nm[0], wavelengths_nm[-1]],
        "sampleCount": len(samples),
        "sampleSummary": summarize(samples),
        "files": {
            "wavelengthsNm": "wavelengths_nm.json",
            "samples": "samples.jsonl",
            "pureSamples": "pure-samples.jsonl",
            "binarySamples": "binary-samples.jsonl",
            "ternarySamples": "ternary-samples.jsonl",
        },
    }

    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    (output_dir / "wavelengths_nm.json").write_text(json.dumps(wavelengths_nm, indent=2) + "\n", encoding="utf8")
    jsonl_dump(output_dir / "samples.jsonl", samples)
    jsonl_dump(output_dir / "pure-samples.jsonl", pure_samples)
    jsonl_dump(output_dir / "binary-samples.jsonl", binary_samples)
    jsonl_dump(output_dir / "ternary-samples.jsonl", ternary_samples)

    print(f"Imported {len(samples)} measured samples into {output_dir}")
    print(f"Pure: {len(pure_samples)}, binary: {len(binary_samples)}, ternary: {len(ternary_samples)}")
    print(f"Wavelengths: {len(wavelengths_nm)} ({wavelengths_nm[0]}-{wavelengths_nm[-1]} nm)")


if __name__ == "__main__":
    main()
