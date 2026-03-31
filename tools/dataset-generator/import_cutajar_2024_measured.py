#!/usr/bin/env python3

import argparse
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


XLSX_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
XLSX_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?(?:E[+-]?\d+)?$", re.IGNORECASE)


LIBRARY_1_METADATA = [
    {"sampleNumber": 1, "sampleCode": "ULT", "sampleName": "Ultramarine", "category": "pure_colorant"},
    {"sampleNumber": 2, "sampleCode": "COB", "sampleName": "Cobalt blue", "category": "pure_colorant"},
    {"sampleNumber": 3, "sampleCode": "PRU", "sampleName": "Prussian blue", "category": "pure_colorant"},
    {"sampleNumber": 4, "sampleCode": "IND", "sampleName": "Indigo", "category": "pure_colorant"},
    {"sampleNumber": 5, "sampleCode": "CRO", "sampleName": "Chromium oxide green", "category": "pure_colorant"},
    {"sampleNumber": 6, "sampleCode": "VIR", "sampleName": "Viridian", "category": "pure_colorant"},
    {"sampleNumber": 7, "sampleCode": "SMG", "sampleName": "Smaagard green", "category": "pure_colorant"},
    {"sampleNumber": 8, "sampleCode": "EMG", "sampleName": "Emerald green", "category": "pure_colorant"},
    {"sampleNumber": 9, "sampleCode": "CDY", "sampleName": "Cadmium yellow", "category": "pure_colorant"},
    {"sampleNumber": 10, "sampleCode": "PBY", "sampleName": "Lead yellow", "category": "pure_colorant"},
    {"sampleNumber": 11, "sampleCode": "INY", "sampleName": "Indian yellow", "category": "pure_colorant"},
    {"sampleNumber": 12, "sampleCode": "CDO", "sampleName": "Cadmium orange", "category": "pure_colorant"},
    {"sampleNumber": 13, "sampleCode": "CNO", "sampleName": "Vermillion orange", "category": "pure_colorant"},
    {"sampleNumber": 14, "sampleCode": "CNR", "sampleName": "Vermillion pink", "category": "pure_colorant"},
    {"sampleNumber": 15, "sampleCode": "ALI1", "sampleName": "Alizarin lac (variant 1)", "category": "pure_colorant"},
    {"sampleNumber": 16, "sampleCode": "ALI2", "sampleName": "Alizarin lac (variant 2)", "category": "pure_colorant"},
    {"sampleNumber": 17, "sampleCode": "MAD", "sampleName": "Madder lac", "category": "pure_colorant"},
    {"sampleNumber": 18, "sampleCode": "ROC", "sampleName": "Red ochre", "category": "pure_colorant"},
    {"sampleNumber": 19, "sampleCode": "VER", "sampleName": "Venetian red", "category": "pure_colorant"},
    {"sampleNumber": 20, "sampleCode": "RUM", "sampleName": "Raw umber", "category": "pure_colorant"},
    {"sampleNumber": 21, "sampleCode": "PBW", "sampleName": "Lead white", "category": "pure_colorant"},
    {"sampleNumber": 22, "sampleCode": "ZNW", "sampleName": "Zinc white", "category": "pure_colorant"},
    {"sampleNumber": 23, "sampleCode": "VBL", "sampleName": "Vine black", "category": "pure_colorant"},
]

LIBRARY_2_METADATA = [
    {
        "sampleNumber": 0,
        "sampleCode": "GR2",
        "sampleName": "Half-chalk ground",
        "category": "ground_reference",
        "components": [{"componentCode": "GR2", "componentName": "Half-chalk ground", "componentKind": "ground_preparation"}],
        "mixtureArity": 1,
        "ratioBasis": "ground_preparation_recipe",
        "proportionKnown": False,
    },
    {
        "sampleNumber": 1,
        "sampleCode": "COB",
        "sampleName": "Cobalt blue",
        "category": "pure_colorant",
        "components": [{"componentCode": "COB", "componentName": "Cobalt blue", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 2,
        "sampleCode": "ULT",
        "sampleName": "Ultramarine",
        "category": "pure_colorant",
        "components": [{"componentCode": "ULT", "componentName": "Ultramarine", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 3,
        "sampleCode": "PRU",
        "sampleName": "Prussian blue",
        "category": "pure_colorant",
        "components": [{"componentCode": "PRU", "componentName": "Prussian blue", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 4,
        "sampleCode": "CER",
        "sampleName": "Cerulean blue",
        "category": "pure_colorant",
        "components": [{"componentCode": "CER", "componentName": "Cerulean blue", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 5,
        "sampleCode": "CRO",
        "sampleName": "Chromium green",
        "category": "pure_colorant",
        "components": [{"componentCode": "CRO", "componentName": "Chromium green", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 6,
        "sampleCode": "VIR",
        "sampleName": "Viridian",
        "category": "pure_colorant",
        "components": [{"componentCode": "VIR", "componentName": "Viridian", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 7,
        "sampleCode": "EGR",
        "sampleName": "Earth green",
        "category": "pure_colorant",
        "components": [{"componentCode": "EGR", "componentName": "Earth green", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 8,
        "sampleCode": "CDY",
        "sampleName": "Cadmium yellow",
        "category": "pure_colorant",
        "components": [{"componentCode": "CDY", "componentName": "Cadmium yellow", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 9,
        "sampleCode": "CDR",
        "sampleName": "Cadmium red",
        "category": "pure_colorant",
        "components": [{"componentCode": "CDR", "componentName": "Cadmium red", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 10,
        "sampleCode": "ROC",
        "sampleName": "Red ochre",
        "category": "pure_colorant",
        "components": [{"componentCode": "ROC", "componentName": "Red ochre", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 11,
        "sampleCode": "COV",
        "sampleName": "Cobalt violet",
        "category": "pure_colorant",
        "components": [{"componentCode": "COV", "componentName": "Cobalt violet", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 12,
        "sampleCode": "ZNW",
        "sampleName": "Zinc white",
        "category": "pure_colorant",
        "components": [{"componentCode": "ZNW", "componentName": "Zinc white", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 13,
        "sampleCode": "TIW",
        "sampleName": "Titanium white",
        "category": "pure_colorant",
        "components": [{"componentCode": "TIW", "componentName": "Titanium white", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 14,
        "sampleCode": "PBW",
        "sampleName": "Cremnitz white",
        "category": "pure_colorant",
        "components": [{"componentCode": "PBW", "componentName": "Cremnitz white", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 15,
        "sampleCode": "FLW",
        "sampleName": "Flake white",
        "category": "pure_colorant",
        "components": [{"componentCode": "FLW", "componentName": "Flake white", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 16,
        "sampleCode": "IVB",
        "sampleName": "Ivory black",
        "category": "pure_colorant",
        "components": [{"componentCode": "IVB", "componentName": "Ivory black", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 17,
        "sampleCode": "MAB",
        "sampleName": "Mars black",
        "category": "pure_colorant",
        "components": [{"componentCode": "MAB", "componentName": "Mars black", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 18,
        "sampleCode": "VIB",
        "sampleName": "Vine black",
        "category": "pure_colorant",
        "components": [{"componentCode": "VIB", "componentName": "Vine black", "componentKind": "prepared_colorant"}],
        "mixtureArity": 1,
        "ratioBasis": "single_paint_recipe",
        "proportionKnown": True,
    },
    {
        "sampleNumber": 19,
        "sampleCode": "GR1",
        "sampleName": "Mixture: Chromium green + Earth green",
        "category": "binary_mixture",
        "components": [
            {"componentCode": "CRO", "componentName": "Chromium green", "componentKind": "prepared_colorant"},
            {"componentCode": "EGR", "componentName": "Earth green", "componentKind": "prepared_colorant"},
        ],
        "mixtureArity": 2,
        "ratioBasis": "unstated_in_source",
        "proportionKnown": False,
    },
    {
        "sampleNumber": 20,
        "sampleCode": "GRY",
        "sampleName": "Mixture: Chromium green + Cadmium yellow",
        "category": "binary_mixture",
        "components": [
            {"componentCode": "CRO", "componentName": "Chromium green", "componentKind": "prepared_colorant"},
            {"componentCode": "CDY", "componentName": "Cadmium yellow", "componentKind": "prepared_colorant"},
        ],
        "mixtureArity": 2,
        "ratioBasis": "unstated_in_source",
        "proportionKnown": False,
    },
    {
        "sampleNumber": 21,
        "sampleCode": "BL2",
        "sampleName": "Mixture: Cobalt blue + Ultramarine + Prussian blue",
        "category": "ternary_mixture",
        "components": [
            {"componentCode": "COB", "componentName": "Cobalt blue", "componentKind": "prepared_colorant"},
            {"componentCode": "ULT", "componentName": "Ultramarine", "componentKind": "prepared_colorant"},
            {"componentCode": "PRU", "componentName": "Prussian blue", "componentKind": "prepared_colorant"},
        ],
        "mixtureArity": 3,
        "ratioBasis": "unstated_in_source",
        "proportionKnown": False,
    },
    {
        "sampleNumber": 22,
        "sampleCode": "RD2",
        "sampleName": "Mixture: Cadmium red + Red ochre",
        "category": "binary_mixture",
        "components": [
            {"componentCode": "CDR", "componentName": "Cadmium red", "componentKind": "prepared_colorant"},
            {"componentCode": "ROC", "componentName": "Red ochre", "componentKind": "prepared_colorant"},
        ],
        "mixtureArity": 2,
        "ratioBasis": "unstated_in_source",
        "proportionKnown": False,
    },
    {
        "sampleNumber": 23,
        "sampleCode": "RD1",
        "sampleName": "Mixture: Cadmium red + Cadmium yellow",
        "category": "binary_mixture",
        "components": [
            {"componentCode": "CDR", "componentName": "Cadmium red", "componentKind": "prepared_colorant"},
            {"componentCode": "CDY", "componentName": "Cadmium yellow", "componentKind": "prepared_colorant"},
        ],
        "mixtureArity": 2,
        "ratioBasis": "unstated_in_source",
        "proportionKnown": False,
    },
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import the accessible workbook subset of the Cutajar 2024 oil-paint libraries into a JSONL dataset."
    )
    parser.add_argument("--library1-xlsx", required=True, type=Path)
    parser.add_argument("--library2-xlsx", required=True, type=Path)
    parser.add_argument("--metadata-pdf", required=True, type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/measured/cutajar-2024-v1"),
    )
    return parser.parse_args()


def col_ref_to_index(ref):
    value = 0
    for char in ref:
        value = (value * 26) + (ord(char.upper()) - 64)
    return value


def read_workbook_rows(xlsx_path, sheet_name):
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
            for node in rels_root.findall(f"{PKG_REL_NS}Relationship")
        }

        selected_sheet = None
        for sheet in workbook_root.findall(f".//{XLSX_MAIN_NS}sheet"):
            if sheet.attrib.get("name") == sheet_name:
                selected_sheet = sheet
                break
        if selected_sheet is None:
            raise ValueError(f"Could not find sheet {sheet_name!r} in {xlsx_path}")

        relationship_id = selected_sheet.attrib[f"{XLSX_REL_NS}id"]
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


def is_number(value):
    return isinstance(value, (int, float)) or bool(NUMBER_RE.match(str(value).strip()))


def parse_dense_spectral_block(rows, expected_series_count, numbers_row_index, codes_row_index):
    index_row = rows[numbers_row_index]
    code_row = rows[codes_row_index]
    series_numbers = [int(index_row[index + 1]) for index in range(expected_series_count)]
    series_codes = [code_row[index + 1] for index in range(expected_series_count)]

    spectral_rows = []
    started = False
    for row in rows[codes_row_index + 1:]:
        if not row or not is_number(row[0]):
            continue
        filled = sum(1 for value in row[1:1 + expected_series_count] if str(value).strip() != "")
        if filled == expected_series_count:
            spectral_rows.append(row)
            started = True
        elif started:
            break

    if not spectral_rows:
        raise ValueError("Could not locate a dense spectral data block.")

    wavelengths_nm = [float(row[0]) for row in spectral_rows]
    spectra_by_code = {
        series_codes[index]: [float(row[index + 1]) for row in spectral_rows]
        for index in range(expected_series_count)
    }
    return series_numbers, series_codes, wavelengths_nm, spectra_by_code


def verify_order(metadata, series_numbers, series_codes, context):
    expected_numbers = [entry["sampleNumber"] for entry in metadata]
    expected_codes = [entry["sampleCode"] for entry in metadata]
    if series_numbers != expected_numbers:
        raise ValueError(f"Unexpected sample-number order in {context}: {series_numbers}")
    if series_codes != expected_codes:
        raise ValueError(f"Unexpected sample-code order in {context}: {series_codes}")


def make_component_records(components, pure_lookup, library_id):
    records = []
    for component in components:
        pure_sample = pure_lookup.get((library_id, component["componentCode"]))
        records.append(
            {
                **component,
                "sourceSampleId": pure_sample["id"] if pure_sample is not None else None,
                "sourceSampleCode": pure_sample["sampleCode"] if pure_sample is not None else None,
                "resolutionStatus": "resolved" if pure_sample is not None else "missing",
            }
        )
    return records


def build_samples(library_1_vnir, library_2_vnir, library_2_swir):
    samples = []

    library_1_pure_lookup = {}
    for entry in LIBRARY_1_METADATA:
        sample = {
            "id": f"cutajar-2024-lib1-{entry['sampleCode']}",
            "sampleCode": entry["sampleCode"],
            "sourceType": "measured_spectral_mix",
            "reviewStatus": "draft",
            "category": entry["category"],
            "libraryId": "library-1",
            "libraryLabel": "Library (1)",
            "libraryYear": 2009,
            "medium": "oil_paint_on_canvas",
            "binder": "linseed oil",
            "support": "manually sized canvas with absorbent glue-based size",
            "dilutionMedium": "further linseed oil additions during hand grinding",
            "dilutionPercentWv": None,
            "varnishStatus": "unvarnished",
            "mixtureArity": 1,
            "ratioBasis": "single_paint_recipe",
            "proportionKnown": True,
            "nominalParts": [1],
            "components": [
                {
                    "componentCode": entry["sampleCode"],
                    "componentName": entry["sampleName"],
                    "componentKind": "prepared_colorant",
                    "sourceSampleId": f"cutajar-2024-lib1-{entry['sampleCode']}",
                    "sourceSampleCode": entry["sampleCode"],
                    "resolutionStatus": "self",
                }
            ],
            "measuredVnirReflectance": library_1_vnir[entry["sampleCode"]],
            "source": {
                "kind": "workbook_import",
                "datasetTitle": "VNIR- and SWIR-HSI database of unvarnished oil paints on canvas",
                "datasetUrl": "https://zenodo.org/records/13359559",
                "doi": "10.5281/zenodo.13359559",
                "workbook": "Library (1).xlsx",
                "sheet": "Aula Pigment Library (1) VNIR",
                "sampleNumber": entry["sampleNumber"],
            },
            "notes": f"{entry['sampleName']} from Library (1) workbook-accessible VNIR subset.",
        }
        samples.append(sample)
        library_1_pure_lookup[("library-1", entry["sampleCode"])] = sample

    library_2_pure_lookup = {}
    for entry in LIBRARY_2_METADATA:
        component_records = make_component_records(entry["components"], library_2_pure_lookup, "library-2")
        if entry["category"] in {"pure_colorant", "ground_reference"}:
            component_records = [
                {
                    **component_records[0],
                    "sourceSampleId": f"cutajar-2024-lib2-{entry['sampleCode']}",
                    "sourceSampleCode": entry["sampleCode"],
                    "resolutionStatus": "self",
                }
            ]

        sample = {
            "id": f"cutajar-2024-lib2-{entry['sampleCode']}",
            "sampleCode": entry["sampleCode"],
            "sourceType": "measured_spectral_mix",
            "reviewStatus": "draft",
            "category": entry["category"],
            "libraryId": "library-2",
            "libraryLabel": "Library (2)",
            "libraryYear": 2021,
            "medium": "oil_paint_on_canvas",
            "binder": "linseed oil",
            "support": "sized, primed canvas with half-chalk ground",
            "dilutionMedium": "white spirits",
            "dilutionPercentWv": 0,
            "varnishStatus": "unvarnished",
            "mixtureArity": entry["mixtureArity"],
            "ratioBasis": entry["ratioBasis"],
            "proportionKnown": entry["proportionKnown"],
            "nominalParts": [1] * entry["mixtureArity"],
            "components": component_records,
            "measuredVnirReflectance": library_2_vnir[entry["sampleCode"]],
            "measuredSwirReflectance": library_2_swir[entry["sampleCode"]],
            "hasResolvedPureColorantEndpoints": all(
                component["resolutionStatus"] in {"resolved", "self"}
                for component in component_records
                if component["componentKind"] == "prepared_colorant"
            ),
            "source": {
                "kind": "workbook_import",
                "datasetTitle": "VNIR- and SWIR-HSI database of unvarnished oil paints on canvas",
                "datasetUrl": "https://zenodo.org/records/13359559",
                "doi": "10.5281/zenodo.13359559",
                "workbook": "Library (2) .xlsx",
                "vnirSheet": "Aula Pigment Library (2) VNIR",
                "swirSheet": "Aula Pigment Library (2) SWIR",
                "sampleNumber": entry["sampleNumber"],
            },
            "notes": f"{entry['sampleName']} from Library (2) workbook-accessible 0% turpentine subset.",
        }
        samples.append(sample)
        if entry["category"] == "pure_colorant":
            library_2_pure_lookup[("library-2", entry["sampleCode"])] = sample

    return samples


def summarize(samples):
    counter = Counter()
    for sample in samples:
        counter[sample["category"]] += 1
    return dict(counter)


def jsonl_dump(path, records):
    path.write_text("".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records), encoding="utf8")


def main():
    args = parse_args()

    library_1_rows = read_workbook_rows(args.library1_xlsx, "Aula Pigment Library (1) VNIR")
    library_2_vnir_rows = read_workbook_rows(args.library2_xlsx, "Aula Pigment Library (2) VNIR")
    library_2_swir_rows = read_workbook_rows(args.library2_xlsx, "Aula Pigment Library (2) SWIR")

    l1_numbers, l1_codes, wavelengths_l1_vnir, spectra_l1_vnir = parse_dense_spectral_block(
        library_1_rows,
        expected_series_count=len(LIBRARY_1_METADATA),
        numbers_row_index=2,
        codes_row_index=3,
    )
    l2_numbers_vnir, l2_codes_vnir, wavelengths_l2_vnir, spectra_l2_vnir = parse_dense_spectral_block(
        library_2_vnir_rows,
        expected_series_count=len(LIBRARY_2_METADATA),
        numbers_row_index=3,
        codes_row_index=4,
    )
    l2_numbers_swir, l2_codes_swir, wavelengths_l2_swir, spectra_l2_swir = parse_dense_spectral_block(
        library_2_swir_rows,
        expected_series_count=len(LIBRARY_2_METADATA),
        numbers_row_index=3,
        codes_row_index=4,
    )

    verify_order(LIBRARY_1_METADATA, l1_numbers, l1_codes, "Library (1) workbook")
    verify_order(LIBRARY_2_METADATA, l2_numbers_vnir, l2_codes_vnir, "Library (2) VNIR workbook")
    verify_order(LIBRARY_2_METADATA, l2_numbers_swir, l2_codes_swir, "Library (2) SWIR workbook")

    if wavelengths_l1_vnir != wavelengths_l2_vnir:
        raise ValueError("Library (1) and Library (2) VNIR wavelength grids differ unexpectedly.")

    samples = build_samples(spectra_l1_vnir, spectra_l2_vnir, spectra_l2_swir)

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "datasetVersion": 1,
        "datasetId": "cutajar-2024-oil-paint-libraries-v1",
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Measured oil-paint library subset imported from the workbook-accessible spectra released with the Cutajar 2024 Zenodo oil-paint libraries.",
        "sourceDataset": {
            "title": "VNIR- and SWIR-HSI database of unvarnished oil paints on canvas",
            "authors": ["Jan Dariusz Cutajar", "Mirjam Liu", "Karen Mengshoel", "Hilda Deborah", "Tine Froysaker"],
            "year": 2024,
            "doi": "10.5281/zenodo.13359559",
            "datasetUrl": "https://zenodo.org/records/13359559",
        },
        "sourceFiles": {
            "library1Workbook": args.library1_xlsx.name,
            "library2Workbook": args.library2_xlsx.name,
            "metadataPdf": args.metadata_pdf.name,
        },
        "subsetPolicy": {
            "workbookAccessibleOnly": True,
            "note": "This import uses only the spectra explicitly tabulated in the two workbook files, not the large VNIR/SWIR datacubes distributed in the Zenodo zip archives.",
        },
        "curationNotes": [
            "Library (1) contributes only pure VNIR spectra.",
            "Library (2) contributes workbook-accessible 0% turpentine, unvarnished spectra for pure paints, one ground reference, four binary mixtures, and one ternary mixture.",
            "The source identifies mixture components in Library (2) but does not explicitly state the component proportions in the accessible workbook/PDF subset.",
            "Mixture samples are therefore retained as real measured targets, but their proportions are marked as unstated in source metadata.",
        ],
        "wavelengths": {
            "library1VnirCount": len(wavelengths_l1_vnir),
            "library1VnirRangeNm": [wavelengths_l1_vnir[0], wavelengths_l1_vnir[-1]],
            "library2VnirCount": len(wavelengths_l2_vnir),
            "library2VnirRangeNm": [wavelengths_l2_vnir[0], wavelengths_l2_vnir[-1]],
            "library2SwirCount": len(wavelengths_l2_swir),
            "library2SwirRangeNm": [wavelengths_l2_swir[0], wavelengths_l2_swir[-1]],
        },
        "sampleCount": len(samples),
        "sampleSummary": summarize(samples),
        "files": {
            "library1VnirWavelengthsNm": "wavelengths_library1_vnir_nm.json",
            "library2VnirWavelengthsNm": "wavelengths_library2_vnir_nm.json",
            "library2SwirWavelengthsNm": "wavelengths_library2_swir_nm.json",
            "samples": "samples.jsonl",
            "library1PureSamples": "library1-pure-samples.jsonl",
            "library2GroundSamples": "library2-ground-samples.jsonl",
            "library2PureSamples": "library2-pure-samples.jsonl",
            "library2BinarySamples": "library2-binary-samples.jsonl",
            "library2TernarySamples": "library2-ternary-samples.jsonl",
        },
    }

    (output_dir / "manifest.json").write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_library1_vnir_nm.json").write_text(f"{json.dumps(wavelengths_l1_vnir, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_library2_vnir_nm.json").write_text(f"{json.dumps(wavelengths_l2_vnir, indent=2)}\n", encoding="utf8")
    (output_dir / "wavelengths_library2_swir_nm.json").write_text(f"{json.dumps(wavelengths_l2_swir, indent=2)}\n", encoding="utf8")
    jsonl_dump(output_dir / "samples.jsonl", samples)
    jsonl_dump(output_dir / "library1-pure-samples.jsonl", [sample for sample in samples if sample["libraryId"] == "library-1"])
    jsonl_dump(output_dir / "library2-ground-samples.jsonl", [sample for sample in samples if sample["category"] == "ground_reference"])
    jsonl_dump(output_dir / "library2-pure-samples.jsonl", [sample for sample in samples if sample["libraryId"] == "library-2" and sample["category"] == "pure_colorant"])
    jsonl_dump(output_dir / "library2-binary-samples.jsonl", [sample for sample in samples if sample["category"] == "binary_mixture"])
    jsonl_dump(output_dir / "library2-ternary-samples.jsonl", [sample for sample in samples if sample["category"] == "ternary_mixture"])

    print(f"Imported {len(samples)} measured samples into {output_dir}")
    print(f"Sample summary: {manifest['sampleSummary']}")


if __name__ == "__main__":
    main()
