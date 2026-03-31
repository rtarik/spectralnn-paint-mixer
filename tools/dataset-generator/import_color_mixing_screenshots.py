#!/usr/bin/env python3

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


RATIO_LADDER_INPUT_BOXES = [
    (0.12, 0.10, 0.47, 0.31),
    (0.53, 0.10, 0.88, 0.31),
]

RATIO_LADDER_ROW_BOXES = [
    (0.22, 0.29, 0.78, 0.45),
    (0.22, 0.43, 0.78, 0.58),
    (0.22, 0.55, 0.78, 0.71),
    (0.22, 0.68, 0.78, 0.84),
    (0.22, 0.81, 0.78, 0.97),
]

SINGLE_RESULT_INPUT_BOXES = [
    (0.10, 0.12, 0.43, 0.36),
    (0.53, 0.12, 0.87, 0.36),
]

SINGLE_RESULT_ROW_BOXES = [
    (0.24, 0.38, 0.71, 0.71),
]

ID_RE = re.compile(r"[^a-z0-9]+")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract an observational A+B=C dataset from labeled paint-mixing screenshots."
    )
    parser.add_argument(
        "--metadata-json",
        type=Path,
        default=Path("tools/dataset-generator/color-mixing-screenshots-v1.metadata.json"),
        help="Path to the reviewed metadata JSON describing the screenshots.",
    )
    parser.add_argument(
        "--screenshots-dir",
        type=Path,
        default=Path("color-mixing"),
        help="Directory containing the screenshot PNG files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/ground-truth/color-mixing-screenshots-v1"),
        help="Output dataset directory.",
    )
    return parser.parse_args()


def normalize_id(value):
    lowered = value.lower()
    normalized = ID_RE.sub("-", lowered).strip("-")
    return normalized


def rgb_to_hex(rgb):
    return "#" + "".join(f"{int(round(channel)):02X}" for channel in rgb)


def hex_to_rgb(hex_value):
    return np.array([
        int(hex_value[1:3], 16),
        int(hex_value[3:5], 16),
        int(hex_value[5:7], 16),
    ], dtype=np.float64)


def box_to_pixels(box, width, height):
    left = max(0, min(width - 1, int(round(box[0] * width))))
    top = max(0, min(height - 1, int(round(box[1] * height))))
    right = max(left + 1, min(width, int(round(box[2] * width))))
    bottom = max(top + 1, min(height, int(round(box[3] * height))))
    return left, top, right, bottom


def border_pixels(region):
    top = region[:6, :, :]
    bottom = region[-6:, :, :]
    left = region[:, :6, :]
    right = region[:, -6:, :]
    return np.concatenate(
        [top.reshape(-1, 3), bottom.reshape(-1, 3), left.reshape(-1, 3), right.reshape(-1, 3)],
        axis=0,
    )


def largest_component_mask(mask):
    labels, count = ndimage.label(mask)
    if count == 0:
        return None

    height, width = mask.shape
    best_component = None
    best_area = -1

    for component_id in range(1, count + 1):
        component = labels == component_id
        area = int(component.sum())
        if area == 0:
            continue
        touches_border = (
            component[0, :].any()
            or component[-1, :].any()
            or component[:, 0].any()
            or component[:, -1].any()
        )
        score = area if not touches_border else area // 4
        if score > best_area:
            best_area = score
            best_component = component

    return best_component


def sample_hex_from_box(image_array, box):
    height, width, _ = image_array.shape
    left, top, right, bottom = box_to_pixels(box, width, height)
    region = image_array[top:bottom, left:right, :].astype(np.float64)
    background = np.median(border_pixels(region), axis=0)
    distance = np.sqrt(((region - background) ** 2).sum(axis=2))

    component = None
    for threshold in (35, 28, 22, 18, 14):
        mask = distance > threshold
        if mask.sum() < 80:
            continue
        component = largest_component_mask(mask)
        if component is not None and component.sum() >= 80:
            break

    if component is None or component.sum() < 80:
        component = distance > 10

    sampled_rgb = np.median(region[component], axis=0)
    return rgb_to_hex(sampled_rgb)


def mean_hex(hex_values):
    rgb_values = np.array([hex_to_rgb(hex_value) for hex_value in hex_values], dtype=np.float64)
    return rgb_to_hex(rgb_values.mean(axis=0))


def layout_boxes(layout):
    if layout == "ratio_ladder":
        return RATIO_LADDER_INPUT_BOXES, RATIO_LADDER_ROW_BOXES
    if layout == "single_result":
        return SINGLE_RESULT_INPUT_BOXES, SINGLE_RESULT_ROW_BOXES
    raise ValueError(f"Unsupported screenshot layout: {layout}")


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf8")


def write_jsonl(path, rows):
    path.write_text(
        "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf8",
    )


def main():
    args = parse_args()
    metadata = json.loads(args.metadata_json.read_text(encoding="utf8"))
    screenshots_dir = args.screenshots_dir.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    samples = []
    screenshot_rows = []
    paint_occurrences = defaultdict(list)

    for screenshot_index, screenshot in enumerate(metadata["screenshots"], start=1):
        image_path = screenshots_dir / screenshot["fileName"]
        if not image_path.is_file():
            raise ValueError(f"Screenshot file not found: {image_path}")

        image_array = np.array(Image.open(image_path).convert("RGB"))
        input_boxes, row_boxes = layout_boxes(screenshot["layout"])
        input_hexes = [
            sample_hex_from_box(image_array, input_boxes[index])
            for index in range(len(screenshot["inputs"]))
        ]

        for input_entry, color_hex in zip(screenshot["inputs"], input_hexes):
            paint_occurrences[input_entry["label"]].append(color_hex)

        extracted_rows = []
        for row_index, row in enumerate(screenshot["rows"], start=1):
            target_hex = sample_hex_from_box(image_array, row_boxes[min(row_index - 1, len(row_boxes) - 1)])
            left_label = screenshot["inputs"][0]["label"]
            right_label = screenshot["inputs"][1]["label"]
            screenshot_slug = normalize_id(Path(screenshot["fileName"]).stem)
            source_sample_id = f"color-mixing-{screenshot_slug}-row-{row_index}"
            source_sample_code = f"{screenshot['fileName']}#row-{row_index}"
            source_ratio_known = row.get("sourceRatioKnown", True)

            if source_ratio_known:
                left_percent = int(row["leftPercent"])
                right_percent = int(row["rightPercent"])
                parts = [left_percent, right_percent]
                ratio_label = f"{left_percent}:{right_percent}"
                ratio_note = f"Displayed ratio {left_percent}%/{right_percent}%."
            else:
                parts = [1, 1]
                ratio_label = "unspecified"
                ratio_note = "No explicit ratio percentages are displayed in the screenshot."

            target_label = row.get("targetLabel")
            if target_label:
                label_suffix = target_label
            elif row.get("displayTargetText"):
                label_suffix = "(unnamed)"
            else:
                label_suffix = "(unknown)"

            note_parts = [
                f"Observed from screenshot {screenshot['fileName']}.",
                ratio_note,
                "Input and target hex values were sampled from the screenshot paint blobs rather than measured with laboratory reflectance equipment.",
            ]
            if row.get("displayTargetText"):
                note_parts.append(f'The screenshot overlay text for the target reads "{row["displayTargetText"]}".')
            if row.get("notes"):
                note_parts.append(row["notes"])

            sample = {
                "id": source_sample_id,
                "sourceType": "video_observed_mix",
                "reviewStatus": "draft",
                "category": "observed_binary",
                "palette": "color-mixing-screenshots",
                "label": f"{left_label}+{right_label}@{ratio_label} -> {label_suffix}",
                "inputs": [
                    {
                        "paintId": f"color-mixing/{normalize_id(left_label)}",
                        "paintLabel": left_label,
                        "colorHex": input_hexes[0],
                        "parts": parts[0],
                    },
                    {
                        "paintId": f"color-mixing/{normalize_id(right_label)}",
                        "paintLabel": right_label,
                        "colorHex": input_hexes[1],
                        "parts": parts[1],
                    },
                ],
                "targetHex": target_hex,
                "source": {
                    "kind": "video_short_screenshot",
                    "reference": f"color-mixing/{screenshot['fileName']}#row-{row_index}",
                },
                "sourceSampleId": source_sample_id,
                "sourceSampleCode": source_sample_code,
                "sourceRatioKnown": source_ratio_known,
                "sourceImagePath": str(image_path),
                "sourceImageRelativePath": str(image_path.relative_to(Path.cwd())),
                "targetLabel": target_label,
                "displayTargetText": row.get("displayTargetText"),
                "notes": " ".join(note_parts),
            }
            samples.append(sample)

            extracted_rows.append(
                {
                    "rowIndex": row_index,
                    "sourceSampleId": source_sample_id,
                    "ratioKnown": source_ratio_known,
                    "parts": parts,
                    "targetLabel": target_label,
                    "displayTargetText": row.get("displayTargetText"),
                    "targetHex": target_hex,
                    "notes": row.get("notes"),
                }
            )

        screenshot_rows.append(
            {
                "fileName": screenshot["fileName"],
                "layout": screenshot["layout"],
                "sourceImagePath": str(image_path),
                "inputs": [
                    {
                        "paintLabel": screenshot["inputs"][index]["label"],
                        "colorHex": input_hexes[index],
                    }
                    for index in range(len(screenshot["inputs"]))
                ],
                "rows": extracted_rows,
            }
        )

    paints = []
    for paint_label in sorted(paint_occurrences):
        sampled_hexes = paint_occurrences[paint_label]
        paints.append(
            {
                "paintId": f"color-mixing/{normalize_id(paint_label)}",
                "paintLabel": paint_label,
                "colorHex": mean_hex(sampled_hexes),
                "occurrenceCount": len(sampled_hexes),
                "sampledHexes": sampled_hexes,
            }
        )

    manifest = {
        "datasetVersion": 1,
        "datasetId": metadata["datasetId"],
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "description": metadata["description"],
        "colorSpace": "srgb",
        "targetEncoding": "hex_rgb_opaque",
        "portionUnit": "parts",
        "supportedSourceTypes": [
            "video_observed_mix",
        ],
        "supportedReviewStatuses": [
            "draft",
            "reviewed",
            "approved",
        ],
        "derivation": {
            "sourceCollectionLabel": metadata["sourceCollectionLabel"],
            "sourceKind": metadata["sourceKind"],
            "ratioTreatment": {
                "note": "This dataset mixes explicit screenshot percentages with single-result screenshots that do not expose ratios. Ratio-unknown rows are retained with placeholder 1:1 parts and sourceRatioKnown=false.",
            },
            "colorSampling": {
                "method": "median_rgb_of_largest_foreground_component_within_reviewed_crop_boxes",
                "note": "Foreground paint regions are isolated by subtracting the local crop-border background color and taking the largest connected component.",
            },
        },
        "curationNotes": metadata["curationNotes"],
        "sampleCount": len(samples),
        "paintCount": len(paints),
        "screenshotCount": len(screenshot_rows),
        "files": {
            "paints": "paints.json",
            "samples": "samples.jsonl",
            "screenshots": "screenshots.json",
        },
    }

    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "paints.json", paints)
    write_jsonl(output_dir / "samples.jsonl", samples)
    write_json(output_dir / "screenshots.json", screenshot_rows)

    print(f"Wrote observational dataset: {output_dir}")
    print(f"Screenshots processed: {len(screenshot_rows)}")
    print(f"Samples extracted: {len(samples)}")
    print(f"Paints aggregated: {len(paints)}")


if __name__ == "__main__":
    main()
