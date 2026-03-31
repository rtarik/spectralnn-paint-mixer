#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
import torch

MAX_COLORS = 3
BASE_INPUT_DIM = 20
PHYSICAL_INPUT_DIM = 3
INPUT_DIM = BASE_INPUT_DIM + PHYSICAL_INPUT_DIM
HIDDEN1_DIM = 32
HIDDEN2_DIM = 32
OUTPUT_DIM = 3
DEFAULT_DATA_DIR = "tools/training/out/data"
DEFAULT_KOTLIN_OUT = "tools/training/out/legacy/LearnedMixerModelWeights.kt"
DEFAULT_CHECKPOINT_OUT = "tools/training/out/latest_checkpoint.npz"
DEFAULT_REPORT_OUT = "tools/training/out/latest_report.txt"
DEFAULT_HISTORY_OUT = "tools/training/out/latest_history.csv"
DEFAULT_DEVICE = "auto"
MANUAL_OPPONENT_CONFIG_PATH = Path(__file__).resolve().with_name("manual_opponent_pairs.json")
MANUAL_OPPONENT_CONFIG = json.loads(MANUAL_OPPONENT_CONFIG_PATH.read_text(encoding="utf-8"))
TORCH_DTYPE = torch.float32


def manual_opponent_pair_key_from_spec(spec: dict) -> str:
    entries = spec["entries"]
    palette_names = [entry["palette"] for entry in entries]
    palette_key = palette_names[0] if len(set(palette_names)) == 1 else "×".join(palette_names)
    label = "+".join(entry["name"] for entry in entries)
    return f"{palette_key}/{label}"


MANUAL_OPPONENT_KIND_BY_KEY = {
    manual_opponent_pair_key_from_spec(spec): spec["kind"]
    for spec in MANUAL_OPPONENT_CONFIG["pairs"]
}
MANUAL_OPPONENT_GUARDRAIL_CATEGORIES = {
    "guardrail_purple_opponent",
    "guardrail_earth_opponent",
    "guardrail_manual_path",
}


@dataclass
class Sample:
    inputs: list[str]
    parts: list[int]
    target: str
    source: str
    teacher: str
    category: str
    palette: str
    label: str
    physical: str | None = None


@dataclass
class WarmStartSnapshot:
    source_path: Path
    source_kind: str
    feature_mean: np.ndarray
    feature_std: np.ndarray
    target_mean: np.ndarray
    target_std: np.ndarray
    parameters: list[np.ndarray]


class WarmStartError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_training_device(requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available.")
        return "cuda"
    if requested == "mps":
        if not hasattr(torch.backends, "mps") or not torch.backends.mps.is_available():
            raise RuntimeError("MPS was requested but is not available.")
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a small exportable mixer MLP.")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--epochs-warmup", type=int, default=10)
    parser.add_argument("--epochs-mixed", type=int, default=80)
    parser.add_argument("--epochs-tail", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr-warmup", type=float, default=0.003)
    parser.add_argument("--lr-mixed", type=float, default=0.001)
    parser.add_argument("--lr-tail", type=float, default=0.00035)
    parser.add_argument("--curated-holdout-ratio", type=float, default=0.12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--kotlin-out", default=DEFAULT_KOTLIN_OUT)
    parser.add_argument("--checkpoint-out", default=DEFAULT_CHECKPOINT_OUT)
    parser.add_argument("--warm-start-from")
    parser.add_argument("--cold-start", action="store_true")
    parser.add_argument("--report-out", default=DEFAULT_REPORT_OUT)
    parser.add_argument("--history-out", default=DEFAULT_HISTORY_OUT)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=("auto", "cpu", "cuda", "mps"))
    return parser.parse_args()


def read_jsonl(path: Path) -> list[Sample]:
    samples: list[Sample] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            samples.append(
                Sample(
                    inputs=payload["inputs"],
                    parts=payload["parts"],
                    target=payload["target"],
                    source=payload["source"],
                    teacher=payload["teacher"],
                    category=payload["category"],
                    palette=payload["palette"],
                    label=payload["label"],
                    physical=payload.get("physical"),
                )
            )
    return samples


def pair_key_from_palette_and_label(palette: str, label: str) -> str:
    base_label = label.split("@", 1)[0]
    return f"{palette}/{base_label}"


def parameter_names() -> tuple[str, ...]:
    return ("w1", "b1", "w2", "b2", "w3", "b3")


def extract_parenthesized(text: str, marker: str) -> str:
    start = text.find(marker)
    if start < 0:
        raise WarmStartError(f"Missing Kotlin marker: {marker}")
    index = start + len(marker)
    depth = 1
    while index < len(text) and depth > 0:
        char = text[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        index += 1
    if depth != 0:
        raise WarmStartError(f"Unbalanced Kotlin array literal for marker: {marker}")
    return text[start + len(marker): index - 1]


def parse_number_array(payload: str) -> np.ndarray:
    parts = [part.strip() for part in payload.replace("\n", " ").split(",")]
    values = [float(part) for part in parts if part]
    return np.asarray(values, dtype=np.float64)


def parse_kotlin_double_array(text: str, name: str) -> np.ndarray:
    return parse_number_array(extract_parenthesized(text, f"val {name}: DoubleArray = doubleArrayOf("))


def parse_kotlin_matrix(text: str, name: str) -> np.ndarray:
    block = extract_parenthesized(text, f"val {name}: Array<DoubleArray> = arrayOf(")
    rows: list[np.ndarray] = []
    search_index = 0
    marker = "doubleArrayOf("
    while True:
        found = block.find(marker, search_index)
        if found < 0:
            break
        row_payload = extract_parenthesized(block[found:], marker)
        rows.append(parse_number_array(row_payload))
        search_index = found + len(marker) + len(row_payload) + 1
    if not rows:
        raise WarmStartError(f"Matrix {name} did not contain any rows.")
    return np.vstack(rows)


def parse_kotlin_int(text: str, name: str) -> int:
    match = re.search(rf"const val {name}: Int = (\d+)", text)
    if not match:
        raise WarmStartError(f"Missing Kotlin int constant: {name}")
    return int(match.group(1))


def parse_kotlin_bool(text: str, name: str) -> bool:
    match = re.search(rf"const val {name}: Boolean = (true|false)", text)
    if not match:
        raise WarmStartError(f"Missing Kotlin boolean constant: {name}")
    return match.group(1) == "true"


def srgb_to_linear_channel(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def linear_to_srgb_channel(value: float) -> float:
    return value * 12.92 if value <= 0.0031308 else 1.055 * (value ** (1.0 / 2.4)) - 0.055


def hex_to_srgb(hex_value: str) -> np.ndarray:
    raw = hex_value.lstrip("#")
    return np.array(
        [
            int(raw[0:2], 16) / 255.0,
            int(raw[2:4], 16) / 255.0,
            int(raw[4:6], 16) / 255.0,
        ],
        dtype=np.float64,
    )


def hex_to_linear_rgb(hex_value: str) -> np.ndarray:
    srgb = hex_to_srgb(hex_value)
    return np.array([srgb_to_linear_channel(channel) for channel in srgb], dtype=np.float64)


def linear_rgb_to_hex(rgb: np.ndarray) -> str:
    srgb = np.array([linear_to_srgb_channel(float(np.clip(channel, 0.0, 1.0))) for channel in rgb], dtype=np.float64)
    channels = [max(0, min(255, int(round(channel * 255.0)))) for channel in srgb]
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def linear_rgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]
    m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]
    s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]

    l_root = np.cbrt(max(l, 1e-12))
    m_root = np.cbrt(max(m, 1e-12))
    s_root = np.cbrt(max(s, 1e-12))

    return np.array(
        [
            0.2104542553 * l_root + 0.7936177850 * m_root - 0.0040720468 * s_root,
            1.9779984951 * l_root - 2.4285922050 * m_root + 0.4505937099 * s_root,
            0.0259040371 * l_root + 0.7827717662 * m_root - 0.8086757660 * s_root,
        ],
        dtype=np.float64,
    )


def oklab_to_linear_rgb(lab: np.ndarray) -> np.ndarray:
    l_prime = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]
    m_prime = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]
    s_prime = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2]

    l = l_prime ** 3
    m = m_prime ** 3
    s = s_prime ** 3

    return np.array(
        [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        ],
        dtype=np.float64,
    )


def linear_rgb_to_xyz(rgb: np.ndarray) -> np.ndarray:
    return np.array(
        [
            0.4123907992659593 * rgb[0] + 0.3575843393838777 * rgb[1] + 0.1804807884018343 * rgb[2],
            0.21263900587151033 * rgb[0] + 0.7151686787677553 * rgb[1] + 0.07219231536073373 * rgb[2],
            0.019330818715591832 * rgb[0] + 0.11919477979462595 * rgb[1] + 0.9505321522496605 * rgb[2],
        ],
        dtype=np.float64,
    )


def xyz_to_lab(xyz: np.ndarray) -> np.ndarray:
    def f(value: float) -> float:
        return value ** (1.0 / 3.0) if value > 0.008856 else 7.787 * value + 16.0 / 116.0

    fx = f(xyz[0] / 0.95047)
    fy = f(xyz[1] / 1.0)
    fz = f(xyz[2] / 1.08883)
    return np.array([116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], dtype=np.float64)


def delta_e_from_hex(predicted_hex: str, target_hex: str) -> float:
    predicted_lab = xyz_to_lab(linear_rgb_to_xyz(hex_to_linear_rgb(predicted_hex)))
    target_lab = xyz_to_lab(linear_rgb_to_xyz(hex_to_linear_rgb(target_hex)))
    return float(np.linalg.norm(predicted_lab - target_lab))


def luminance(rgb: np.ndarray) -> float:
    return float(0.21263900587151033 * rgb[0] + 0.7151686787677553 * rgb[1] + 0.07219231536073373 * rgb[2])


def chroma(rgb: np.ndarray) -> float:
    max_channel = float(np.max(rgb))
    if max_channel <= 1e-8:
        return 0.0
    min_channel = float(np.min(rgb))
    return max(0.0, min(1.0, (max_channel - min_channel) / max_channel))


def color_role_scores(rgb: np.ndarray) -> tuple[float, float, float]:
    max_channel = float(np.max(rgb))
    if max_channel <= 1e-8:
        return 0.0, 0.0, 0.0
    normalised = rgb / max_channel
    red_score = float(np.clip(normalised[0] - 0.5 * (normalised[1] + normalised[2]), 0.0, 1.0))
    blue_score = float(np.clip(normalised[2] - 0.5 * (normalised[0] + normalised[1]), 0.0, 1.0))
    yellow_score = float(np.clip(min(normalised[0], normalised[1]) * (1.0 - normalised[2]), 0.0, 1.0))
    return red_score, blue_score, yellow_score


def dark_chromatic_weight(rgb: np.ndarray) -> float:
    luma = luminance(rgb)
    colorfulness = chroma(rgb)
    chroma_weight = np.clip((colorfulness - 0.45) / 0.55, 0.0, 1.0)
    luminance_weight = np.clip((0.35 - luma) / 0.35, 0.0, 1.0)
    return float(chroma_weight * luminance_weight)


def sort_entries(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda entry: (-entry["weight"], -entry["rgb"][0], -entry["rgb"][1], -entry["rgb"][2]))


def pair_stresses(entries: list[dict]) -> tuple[float, float, float]:
    violet = 0.0
    yellow_blue = 0.0
    dark = 0.0
    if len(entries) < 2:
        return violet, yellow_blue, dark

    for left_index in range(len(entries) - 1):
        left = entries[left_index]
        for right_index in range(left_index + 1, len(entries)):
            right = entries[right_index]
            pair_balance = math.sqrt(np.clip(left["weight"] * right["weight"] / 0.25, 0.0, 1.0))
            chroma_stress = math.sqrt(left["chroma"] * right["chroma"])
            violet_pair = max(
                left["red_score"] * right["blue_score"],
                left["blue_score"] * right["red_score"],
            )
            yellow_blue_pair = max(
                left["blue_score"] * right["yellow_score"],
                left["yellow_score"] * right["blue_score"],
            )
            violet = max(violet, pair_balance * chroma_stress * violet_pair)
            yellow_blue = max(yellow_blue, pair_balance * chroma_stress * yellow_blue_pair)
            dark = max(dark, pair_balance * math.sqrt(left["dark_weight"] * right["dark_weight"]))
    return violet, yellow_blue, dark


def build_features(sample: Sample) -> np.ndarray:
    total_parts = max(1, sum(sample.parts))
    entries: list[dict] = []
    for hex_value, part in zip(sample.inputs, sample.parts):
        rgb = hex_to_linear_rgb(hex_value)
        red_score, blue_score, yellow_score = color_role_scores(rgb)
        entries.append(
            {
                "hex": hex_value,
                "rgb": rgb,
                "weight": part / total_parts,
                "luminance": luminance(rgb),
                "chroma": chroma(rgb),
                "red_score": red_score,
                "blue_score": blue_score,
                "yellow_score": yellow_score,
                "dark_weight": dark_chromatic_weight(rgb),
            }
        )

    entries = sort_entries(entries)
    features = np.zeros(INPUT_DIM, dtype=np.float64)
    feature_index = 0
    for slot in range(MAX_COLORS):
        if slot < len(entries):
            entry = entries[slot]
            features[feature_index:feature_index + 3] = entry["rgb"]
            features[feature_index + 3] = entry["weight"]
        feature_index += 4

    active_count = len(entries)
    weighted_mean_rgb = sum(entry["rgb"] * entry["weight"] for entry in entries)
    weighted_mean_luminance = sum(entry["luminance"] * entry["weight"] for entry in entries)
    violet_stress, yellow_blue_stress, dark_stress = pair_stresses(entries)

    features[feature_index] = active_count / MAX_COLORS
    feature_index += 1
    features[feature_index:feature_index + 3] = weighted_mean_rgb
    feature_index += 3
    features[feature_index] = weighted_mean_luminance
    feature_index += 1
    features[feature_index] = violet_stress
    feature_index += 1
    features[feature_index] = yellow_blue_stress
    feature_index += 1
    features[feature_index] = dark_stress
    feature_index += 1

    physical_lab = physical_oklab(sample)
    features[feature_index:feature_index + OUTPUT_DIM] = physical_lab
    return features


def build_target(sample: Sample) -> np.ndarray:
    return linear_rgb_to_oklab(hex_to_linear_rgb(sample.target)) - physical_oklab(sample)


def physical_oklab(sample: Sample) -> np.ndarray:
    if not sample.physical:
        raise RuntimeError(
            "Sample is missing physical baseline output. "
            "Run node tools/eval/export-physical-baselines.mjs "
            "after exporting JSONL data."
        )
    return linear_rgb_to_oklab(hex_to_linear_rgb(sample.physical))


def build_sample_weight(sample: Sample) -> float:
    weight = 1.0 if sample.source == "synthetic" else 8.0
    if sample.category == "identity":
        weight *= 0.35
    elif sample.category in {"chromatic", "cross_palette", "three_color"}:
        weight *= 1.25
    elif sample.category == "white_tint":
        weight *= 1.05
    elif sample.category in {"black_shade", "neutral"}:
        weight *= 1.0
    elif sample.category == "guardrail_yellow_blue":
        weight *= 2.2
    elif sample.category == "guardrail_yellow_magenta":
        weight *= 2.0
    elif sample.category == "guardrail_red_yellow":
        weight *= 2.0
    elif sample.category == "guardrail_purple_opponent":
        weight *= 2.2
    elif sample.category == "guardrail_earth_opponent":
        weight *= 2.1
    elif sample.category == "guardrail_manual_path":
        # Exact-path guardrails help the newer cross-palette outliers without
        # overpowering the original purple/earth opponent families.
        weight *= 1.55
    elif sample.category == "guardrail_white_tint":
        weight *= 2.15
    elif sample.category == "guardrail_white_tint_chain":
        weight *= 2.25
    elif sample.category == "guardrail_black_shade":
        weight *= 2.2
    elif sample.category == "guardrail_black_shade_chain":
        weight *= 2.25
    elif sample.category == "guardrail_neutral":
        weight *= 1.8
    elif sample.category == "guardrail_dark_neutral":
        weight *= 2.1

    label_lower = sample.label.lower()
    manual_opponent_kind = get_manual_opponent_kind(sample)
    if len(sample.parts) == 2:
        left_part, right_part = sample.parts
        total_parts = max(1, left_part + right_part)
        balance = 1.0 - abs(left_part - right_part) / total_parts
    else:
        left_part = right_part = 0
        balance = 0.0
    if "blue" in label_lower and "red" in label_lower:
        weight *= 2.5
    if "crimson" in label_lower and ("blue" in label_lower or "prussian" in label_lower):
        weight *= 2.5
    if sample.palette.startswith("oils"):
        weight *= 1.3
    if "yellow" in label_lower and "blue" in label_lower:
        weight *= 1.6
    if "yellow" in label_lower and ("magenta" in label_lower or "purple" in label_lower):
        weight *= 1.5
    if "yellow" in label_lower and "red" in label_lower:
        weight *= 1.45
    if manual_opponent_kind == "purple":
        weight *= 1.55
    if manual_opponent_kind == "earth":
        weight *= 1.50
    if manual_opponent_kind in {"purple", "earth"} and balance >= 0.80:
        weight *= 1.30
    if manual_opponent_kind in {"purple", "earth"} and left_part == right_part and left_part > 0:
        weight *= 1.20
    if "chain" in label_lower:
        weight *= 1.10
    if "white" in label_lower:
        weight *= 1.30
    if "black" in label_lower:
        weight *= 1.35
    if any(name in label_lower for name in ("anthracite", "stonegrey", "gunmetal", "greya", "midgray")):
        weight *= 1.30
    return weight


def dataset_key(sample: Sample) -> str:
    payload = {
        "inputs": sample.inputs,
        "parts": sample.parts,
        "target": sample.target,
        "category": sample.category,
        "palette": sample.palette,
        "label": sample.label,
    }
    return json.dumps(payload, sort_keys=True)


def parse_ratio_from_label(label: str) -> tuple[int, int] | None:
    if "@" not in label:
        return None
    ratio_text = label.split("@", 1)[1]
    if ":" not in ratio_text:
        return None
    left_text, right_text = ratio_text.split(":", 1)
    try:
        return int(left_text), int(right_text)
    except ValueError:
        return None


def manual_guardrail_holdout_priority(sample: Sample) -> tuple[int, float, str]:
    ratio = parse_ratio_from_label(sample.label)
    if ratio is None:
        return 1, 0.0, dataset_key(sample)
    left, right = ratio
    balance = abs(math.log(max(left, 1) / max(right, 1)))
    return (0 if left == right else 1), balance, dataset_key(sample)


def is_validation_sample(sample: Sample) -> bool:
    digest = hashlib.sha1(dataset_key(sample).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 10 == 0


def split_curated_samples(samples: list[Sample], holdout_ratio: float) -> tuple[list[Sample], list[Sample]]:
    if not samples:
        return [], []

    threshold = max(0, min(10_000, int(round(holdout_ratio * 10_000.0))))
    holdout: list[Sample] = []
    train: list[Sample] = []
    forced_manual_groups: dict[str, list[Sample]] = {}
    regular_samples: list[Sample] = []
    for sample in samples:
        if sample.category in MANUAL_OPPONENT_GUARDRAIL_CATEGORIES:
            pair_key = pair_key_from_palette_and_label(sample.palette, sample.label)
            forced_manual_groups.setdefault(pair_key, []).append(sample)
            continue
        regular_samples.append(sample)

    for pair_key in sorted(forced_manual_groups):
        group = sorted(forced_manual_groups[pair_key], key=manual_guardrail_holdout_priority)
        if len(group) == 1:
            holdout.append(group[0])
            continue
        holdout.append(group[0])
        train.extend(group[1:])

    for sample in regular_samples:
        digest = hashlib.sha1(f"curated-holdout|{dataset_key(sample)}".encode("utf-8")).hexdigest()
        bucket = int(digest[:8], 16) % 10_000
        if bucket < threshold:
            holdout.append(sample)
        else:
            train.append(sample)

    if not holdout:
        holdout.append(train.pop())
    elif not train:
        train.append(holdout.pop())
    return train, holdout


def create_arrays(samples: Iterable[Sample]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    samples_list = list(samples)
    features = np.stack([build_features(sample) for sample in samples_list], axis=0)
    targets = np.stack([build_target(sample) for sample in samples_list], axis=0)
    weights = np.array([build_sample_weight(sample) for sample in samples_list], dtype=np.float64)
    return features, targets, weights


def sample_arrays(
    features: np.ndarray,
    targets: np.ndarray,
    weights: np.ndarray,
    count: int,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    size = len(features)
    if size == 0:
        raise RuntimeError("Cannot sample from an empty training array.")
    if count <= 0:
        raise RuntimeError("Sample count must be positive.")
    if count >= size:
        if count == size:
            indices = rng.permutation(size)
        else:
            indices = rng.integers(0, size, size=count)
    else:
        indices = rng.choice(size, size=count, replace=False)
    return features[indices], targets[indices], weights[indices]


def make_synthetic_warmup_sampler(
    features: np.ndarray,
    targets: np.ndarray,
    weights: np.ndarray,
) -> Callable[[np.random.Generator, int], tuple[np.ndarray, np.ndarray, np.ndarray]]:
    def sample_epoch(rng: np.random.Generator, batch_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        epoch_size = min(len(features), max(16_384, batch_size * 64))
        return sample_arrays(features, targets, weights, epoch_size, rng)

    return sample_epoch


def make_balanced_mixed_sampler(
    synthetic_features: np.ndarray,
    synthetic_targets: np.ndarray,
    synthetic_weights: np.ndarray,
    curated_features: np.ndarray,
    curated_targets: np.ndarray,
    curated_weights: np.ndarray,
) -> Callable[[np.random.Generator, int], tuple[np.ndarray, np.ndarray, np.ndarray]]:
    def sample_epoch(rng: np.random.Generator, batch_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        per_source_count = min(
            len(synthetic_features),
            max(len(curated_features) * 8, batch_size * 16),
        )
        synthetic_epoch = sample_arrays(
            synthetic_features,
            synthetic_targets,
            synthetic_weights,
            per_source_count,
            rng,
        )
        curated_epoch = sample_arrays(
            curated_features,
            curated_targets,
            curated_weights,
            per_source_count,
            rng,
        )
        features = np.concatenate([synthetic_epoch[0], curated_epoch[0]], axis=0)
        targets = np.concatenate([synthetic_epoch[1], curated_epoch[1]], axis=0)
        weights = np.concatenate([synthetic_epoch[2], curated_epoch[2]], axis=0)
        return features, targets, weights

    return sample_epoch


def make_curated_tail_sampler(
    curated_features: np.ndarray,
    curated_targets: np.ndarray,
    curated_weights: np.ndarray,
) -> Callable[[np.random.Generator, int], tuple[np.ndarray, np.ndarray, np.ndarray]]:
    def sample_epoch(rng: np.random.Generator, batch_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        epoch_size = max(len(curated_features) * 10, batch_size * 16)
        return sample_arrays(curated_features, curated_targets, curated_weights, epoch_size, rng)

    return sample_epoch


class ExportableMLP:
    def __init__(self, rng: np.random.Generator, device: str):
        self.device = torch.device(device)
        self.linear1 = torch.nn.Linear(INPUT_DIM, HIDDEN1_DIM, bias=True, device=self.device, dtype=TORCH_DTYPE)
        self.linear2 = torch.nn.Linear(HIDDEN1_DIM, HIDDEN2_DIM, bias=True, device=self.device, dtype=TORCH_DTYPE)
        self.linear3 = torch.nn.Linear(HIDDEN2_DIM, OUTPUT_DIM, bias=True, device=self.device, dtype=TORCH_DTYPE)
        self.optimizer = torch.optim.Adam(self._parameter_tensors(), lr=1e-3)
        self._initialise_parameters(rng)

    def _initialise_parameters(self, rng: np.random.Generator) -> None:
        with torch.no_grad():
            self.linear1.weight.copy_(torch.as_tensor(
                rng.normal(0.0, math.sqrt(2.0 / INPUT_DIM), size=(HIDDEN1_DIM, INPUT_DIM)),
                dtype=TORCH_DTYPE,
                device=self.device,
            ))
            self.linear1.bias.zero_()
            self.linear2.weight.copy_(torch.as_tensor(
                rng.normal(0.0, math.sqrt(2.0 / HIDDEN1_DIM), size=(HIDDEN2_DIM, HIDDEN1_DIM)),
                dtype=TORCH_DTYPE,
                device=self.device,
            ))
            self.linear2.bias.zero_()
            self.linear3.weight.copy_(torch.as_tensor(
                rng.normal(0.0, math.sqrt(2.0 / HIDDEN2_DIM), size=(OUTPUT_DIM, HIDDEN2_DIM)),
                dtype=TORCH_DTYPE,
                device=self.device,
            ))
            self.linear3.bias.zero_()

    def _parameter_tensors(self) -> list[torch.Tensor]:
        return [
            self.linear1.weight,
            self.linear1.bias,
            self.linear2.weight,
            self.linear2.bias,
            self.linear3.weight,
            self.linear3.bias,
        ]

    def parameters(self) -> list[np.ndarray]:
        return [parameter.detach().cpu().numpy().astype(np.float64, copy=True) for parameter in self._parameter_tensors()]

    @property
    def w1(self) -> np.ndarray:
        return self.parameters()[0]

    @property
    def b1(self) -> np.ndarray:
        return self.parameters()[1]

    @property
    def w2(self) -> np.ndarray:
        return self.parameters()[2]

    @property
    def b2(self) -> np.ndarray:
        return self.parameters()[3]

    @property
    def w3(self) -> np.ndarray:
        return self.parameters()[4]

    @property
    def b3(self) -> np.ndarray:
        return self.parameters()[5]

    def copy_state(self) -> list[np.ndarray]:
        return self.parameters()

    def load_state(self, state: list[np.ndarray]) -> None:
        with torch.no_grad():
            for target, source in zip(self._parameter_tensors(), state):
                target.copy_(torch.as_tensor(source, dtype=TORCH_DTYPE, device=self.device))
        learning_rate = self.optimizer.param_groups[0]["lr"]
        self.optimizer = torch.optim.Adam(self._parameter_tensors(), lr=learning_rate)

    def _forward_tensor(self, x: torch.Tensor) -> torch.Tensor:
        h1 = torch.tanh(self.linear1(x))
        h2 = torch.tanh(self.linear2(h1))
        return self.linear3(h2)

    def set_learning_rate(self, learning_rate: float) -> None:
        for group in self.optimizer.param_groups:
            group["lr"] = learning_rate

    def train_epoch(
        self,
        x: np.ndarray,
        y_true: np.ndarray,
        weights: np.ndarray,
        batch_size: int,
        rng: np.random.Generator,
    ) -> float:
        x_tensor = torch.as_tensor(x, dtype=TORCH_DTYPE, device=self.device)
        y_tensor = torch.as_tensor(y_true, dtype=TORCH_DTYPE, device=self.device)
        weight_tensor = torch.as_tensor(weights, dtype=TORCH_DTYPE, device=self.device)

        indices = rng.permutation(len(x))
        running_loss = 0.0
        batch_count = 0

        self.linear1.train()
        self.linear2.train()
        self.linear3.train()
        for start in range(0, len(indices), batch_size):
            end = start + batch_size
            batch_indices = torch.as_tensor(indices[start:end], dtype=torch.long, device=self.device)
            batch_x = x_tensor.index_select(0, batch_indices)
            batch_y = y_tensor.index_select(0, batch_indices)
            batch_weights = weight_tensor.index_select(0, batch_indices)

            self.optimizer.zero_grad(set_to_none=True)
            prediction = self._forward_tensor(batch_x)
            loss = torch.sum(batch_weights.unsqueeze(1) * (prediction - batch_y) ** 2) / max(1, batch_x.shape[0])
            loss.backward()
            self.optimizer.step()

            running_loss += float(loss.item())
            batch_count += 1

        return running_loss / max(1, batch_count)

    def predict(self, x: np.ndarray) -> np.ndarray:
        self.linear1.eval()
        self.linear2.eval()
        self.linear3.eval()
        with torch.no_grad():
            x_tensor = torch.as_tensor(x, dtype=TORCH_DTYPE, device=self.device)
            return self._forward_tensor(x_tensor).detach().cpu().numpy().astype(np.float64, copy=False)


def checkpoint_payload(
    model: ExportableMLP,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> dict[str, np.ndarray]:
    payload: dict[str, np.ndarray] = {
        "format_version": np.asarray([1], dtype=np.int64),
        "input_dim": np.asarray([INPUT_DIM], dtype=np.int64),
        "hidden1_dim": np.asarray([HIDDEN1_DIM], dtype=np.int64),
        "hidden2_dim": np.asarray([HIDDEN2_DIM], dtype=np.int64),
        "output_dim": np.asarray([OUTPUT_DIM], dtype=np.int64),
        "feature_mean": feature_mean.astype(np.float64),
        "feature_std": feature_std.astype(np.float64),
        "target_mean": target_mean.astype(np.float64),
        "target_std": target_std.astype(np.float64),
    }
    for name, value in zip(parameter_names(), model.parameters()):
        payload[name] = value.astype(np.float64)
    return payload


def validate_snapshot_shapes(snapshot: WarmStartSnapshot) -> None:
    expected_shapes = {
        "w1": (HIDDEN1_DIM, INPUT_DIM),
        "b1": (HIDDEN1_DIM,),
        "w2": (HIDDEN2_DIM, HIDDEN1_DIM),
        "b2": (HIDDEN2_DIM,),
        "w3": (OUTPUT_DIM, HIDDEN2_DIM),
        "b3": (OUTPUT_DIM,),
    }
    for name, value in zip(parameter_names(), snapshot.parameters):
        if value.shape != expected_shapes[name]:
            raise WarmStartError(
                f"{snapshot.source_path} has {name} shape {value.shape}, expected {expected_shapes[name]}."
            )
    if snapshot.feature_mean.shape != (INPUT_DIM,) or snapshot.feature_std.shape != (INPUT_DIM,):
        raise WarmStartError(
            f"{snapshot.source_path} has incompatible feature normalization shapes."
        )
    if snapshot.target_mean.shape != (OUTPUT_DIM,) or snapshot.target_std.shape != (OUTPUT_DIM,):
        raise WarmStartError(
            f"{snapshot.source_path} has incompatible target normalization shapes."
        )


def load_npz_snapshot(path: Path) -> WarmStartSnapshot:
    with np.load(path, allow_pickle=False) as payload:
        dims = {
            "input_dim": int(payload["input_dim"][0]),
            "hidden1_dim": int(payload["hidden1_dim"][0]),
            "hidden2_dim": int(payload["hidden2_dim"][0]),
            "output_dim": int(payload["output_dim"][0]),
        }
        expected_dims = {
            "input_dim": INPUT_DIM,
            "hidden1_dim": HIDDEN1_DIM,
            "hidden2_dim": HIDDEN2_DIM,
            "output_dim": OUTPUT_DIM,
        }
        if dims != expected_dims:
            raise WarmStartError(f"{path} was saved for dims {dims}, expected {expected_dims}.")
        snapshot = WarmStartSnapshot(
            source_path=path,
            source_kind="checkpoint",
            feature_mean=np.asarray(payload["feature_mean"], dtype=np.float64),
            feature_std=np.asarray(payload["feature_std"], dtype=np.float64),
            target_mean=np.asarray(payload["target_mean"], dtype=np.float64),
            target_std=np.asarray(payload["target_std"], dtype=np.float64),
            parameters=[np.asarray(payload[name], dtype=np.float64) for name in parameter_names()],
        )
    validate_snapshot_shapes(snapshot)
    return snapshot


def load_kotlin_snapshot(path: Path) -> WarmStartSnapshot:
    text = path.read_text(encoding="utf-8")
    if not parse_kotlin_bool(text, "enabled"):
        raise WarmStartError(f"{path} is a disabled Kotlin weights stub.")
    dims = {
        "input_dim": parse_kotlin_int(text, "inputDim"),
        "hidden1_dim": parse_kotlin_int(text, "hidden1Dim"),
        "hidden2_dim": parse_kotlin_int(text, "hidden2Dim"),
        "output_dim": OUTPUT_DIM,
    }
    expected_dims = {
        "input_dim": INPUT_DIM,
        "hidden1_dim": HIDDEN1_DIM,
        "hidden2_dim": HIDDEN2_DIM,
        "output_dim": OUTPUT_DIM,
    }
    if dims != expected_dims:
        raise WarmStartError(f"{path} was generated for dims {dims}, expected {expected_dims}.")
    snapshot = WarmStartSnapshot(
        source_path=path,
        source_kind="kotlin_weights",
        feature_mean=parse_kotlin_double_array(text, "featureMean"),
        feature_std=parse_kotlin_double_array(text, "featureStd"),
        target_mean=parse_kotlin_double_array(text, "targetMean"),
        target_std=parse_kotlin_double_array(text, "targetStd"),
        parameters=[
            parse_kotlin_matrix(text, "layer1Weights"),
            parse_kotlin_double_array(text, "layer1Bias"),
            parse_kotlin_matrix(text, "layer2Weights"),
            parse_kotlin_double_array(text, "layer2Bias"),
            parse_kotlin_matrix(text, "outputWeights"),
            parse_kotlin_double_array(text, "outputBias"),
        ],
    )
    validate_snapshot_shapes(snapshot)
    return snapshot


def load_warm_start_snapshot(path: Path) -> WarmStartSnapshot:
    suffix = path.suffix.lower()
    if suffix == ".npz":
        return load_npz_snapshot(path)
    return load_kotlin_snapshot(path)


def adapt_snapshot_to_current_standardisation(
    snapshot: WarmStartSnapshot,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> list[np.ndarray]:
    old_w1, old_b1, old_w2, old_b2, old_w3, old_b3 = [value.copy() for value in snapshot.parameters]

    input_scale = feature_std / snapshot.feature_std
    input_shift = (feature_mean - snapshot.feature_mean) / snapshot.feature_std
    new_w1 = old_w1 * input_scale[None, :]
    new_b1 = old_b1 + old_w1 @ input_shift

    output_scale = snapshot.target_std / target_std
    output_shift = (snapshot.target_mean - target_mean) / target_std
    new_w3 = old_w3 * output_scale[:, None]
    new_b3 = old_b3 * output_scale + output_shift

    return [new_w1, new_b1, old_w2, old_b2, new_w3, new_b3]


def maybe_warm_start_model(
    model: ExportableMLP,
    candidates: list[Path],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
    strict: bool,
) -> WarmStartSnapshot | None:
    attempted = False
    for candidate in candidates:
        attempted = True
        if not candidate.exists():
            if strict:
                raise WarmStartError(f"Warm-start source does not exist: {candidate}")
            continue
        try:
            snapshot = load_warm_start_snapshot(candidate)
            model.load_state(
                adapt_snapshot_to_current_standardisation(
                    snapshot,
                    feature_mean,
                    feature_std,
                    target_mean,
                    target_std,
                )
            )
            print(
                f"Warm-started model from {snapshot.source_kind}: {snapshot.source_path}"
            )
            return snapshot
        except WarmStartError as exc:
            if strict:
                raise
            print(f"Skipping warm-start candidate {candidate}: {exc}")
    if strict and attempted:
        raise WarmStartError("Unable to load the requested warm-start source.")
    return None


def save_checkpoint(
    path: Path,
    model: ExportableMLP,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        **checkpoint_payload(model, feature_mean, feature_std, target_mean, target_std),
    )


def standardise_fit(features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = np.mean(features, axis=0)
    std = np.std(features, axis=0)
    std[std < 1e-6] = 1.0
    return mean, std


def standardise_apply(values: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return (values - mean) / std


def evaluate_samples(
    model: ExportableMLP,
    samples: list[Sample],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> dict:
    features, targets, _ = create_arrays(samples)
    predictions = model.predict(standardise_apply(features, feature_mean, feature_std))
    predictions = predictions * target_std + target_mean

    deltas = []
    predictions_hex = []
    for predicted_lab, sample in zip(predictions, samples):
        predicted_hex = residual_prediction_to_hex(predicted_lab, sample)
        predictions_hex.append(predicted_hex)
        deltas.append(delta_e_from_hex(predicted_hex, sample.target))

    return {
        "mean_delta_e": float(np.mean(deltas)) if deltas else 0.0,
        "max_delta_e": float(np.max(deltas)) if deltas else 0.0,
        "p95_delta_e": float(np.percentile(deltas, 95.0)) if deltas else 0.0,
        "predictions_hex": predictions_hex,
        "deltas": deltas,
    }


def residual_prediction_to_hex(predicted_residual_lab: np.ndarray, sample: Sample) -> str:
    corrected_lab = physical_oklab(sample) + predicted_residual_lab
    return linear_rgb_to_hex(oklab_to_linear_rgb(corrected_lab))


def baseline_metrics(samples: list[Sample]) -> dict:
    deltas = [delta_e_from_hex(sample.physical, sample.target) for sample in samples if sample.physical]
    return {
        "mean_delta_e": float(np.mean(deltas)) if deltas else 0.0,
        "max_delta_e": float(np.max(deltas)) if deltas else 0.0,
        "p95_delta_e": float(np.percentile(deltas, 95.0)) if deltas else 0.0,
    }


def is_yellow_blue_guardrail(sample: Sample) -> bool:
    label = sample.label.lower()
    return sample.category == "guardrail_yellow_blue" or ("yellow" in label and "blue" in label)


def sample_pair_key(sample: Sample) -> str:
    return pair_key_from_palette_and_label(sample.palette, sample.label)


def get_manual_opponent_kind(sample: Sample) -> str | None:
    return MANUAL_OPPONENT_KIND_BY_KEY.get(sample_pair_key(sample))


def is_white_tint_guardrail(sample: Sample) -> bool:
    return sample.category in {"white_tint", "guardrail_white_tint", "guardrail_white_tint_chain"}


def is_white_tint_chain_guardrail(sample: Sample) -> bool:
    return sample.category == "guardrail_white_tint_chain"


def is_black_guardrail(sample: Sample) -> bool:
    return sample.category in {"black_shade", "guardrail_black_shade", "guardrail_black_shade_chain", "neutral", "guardrail_neutral"}


def is_black_shade_chain_guardrail(sample: Sample) -> bool:
    return sample.category == "guardrail_black_shade_chain"


def is_yellow_magenta_guardrail(sample: Sample) -> bool:
    label = sample.label.lower()
    return sample.category == "guardrail_yellow_magenta" or (
        "yellow" in label and ("magenta" in label or "purple" in label)
    )


def is_red_yellow_guardrail(sample: Sample) -> bool:
    label = sample.label.lower()
    return sample.category == "guardrail_red_yellow" or ("red" in label and "yellow" in label)


def is_dark_neutral_guardrail(sample: Sample) -> bool:
    label = sample.label.lower()
    return sample.category == "guardrail_dark_neutral" or any(
        name in label for name in ("anthracite", "stonegrey", "gunmetal", "greya", "midgray")
    )


def is_purple_opponent_guardrail(sample: Sample) -> bool:
    return sample.category == "guardrail_purple_opponent"


def is_earth_opponent_guardrail(sample: Sample) -> bool:
    return sample.category == "guardrail_earth_opponent"


def evaluate_subset(
    model: ExportableMLP,
    samples: list[Sample],
    predicate: Callable[[Sample], bool],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> dict:
    subset = [sample for sample in samples if predicate(sample)]
    return evaluate_samples(model, subset, feature_mean, feature_std, target_mean, target_std)


def baseline_subset_metrics(samples: list[Sample], predicate: Callable[[Sample], bool]) -> dict:
    subset = [sample for sample in samples if predicate(sample)]
    return baseline_metrics(subset)


def objective(
    curated_metrics: dict,
    synthetic_val_metrics: dict,
    yellow_blue_metrics: dict,
    yellow_magenta_metrics: dict,
    red_yellow_metrics: dict,
    purple_opponent_metrics: dict,
    earth_opponent_metrics: dict,
    white_tint_metrics: dict,
    white_tint_chain_metrics: dict,
    black_guardrail_metrics: dict,
    black_shade_chain_metrics: dict,
    dark_neutral_metrics: dict,
) -> float:
    return (
        curated_metrics["mean_delta_e"]
        + 0.3 * curated_metrics["p95_delta_e"]
        + 0.1 * curated_metrics["max_delta_e"]
        + 0.05 * synthetic_val_metrics["mean_delta_e"]
        + 0.18 * yellow_blue_metrics["mean_delta_e"]
        + 0.14 * yellow_magenta_metrics["mean_delta_e"]
        + 0.16 * red_yellow_metrics["mean_delta_e"]
        + 0.16 * purple_opponent_metrics["mean_delta_e"]
        + 0.16 * earth_opponent_metrics["mean_delta_e"]
        + 0.16 * white_tint_metrics["mean_delta_e"]
        + 0.08 * white_tint_chain_metrics["mean_delta_e"]
        + 0.18 * black_guardrail_metrics["mean_delta_e"]
        + 0.08 * black_shade_chain_metrics["mean_delta_e"]
        + 0.12 * dark_neutral_metrics["mean_delta_e"]
    )


def train_stage(
    model: ExportableMLP,
    stage_name: str,
    epoch_arrays: Callable[[np.random.Generator, int], tuple[np.ndarray, np.ndarray, np.ndarray]],
    curated_holdout_samples: list[Sample],
    curated_full_samples: list[Sample],
    synthetic_val_samples: list[Sample],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    rng: np.random.Generator,
    history_writer: csv.DictWriter | None,
) -> list[np.ndarray]:
    best_state = model.copy_state()
    best_score = float("inf")
    model.set_learning_rate(learning_rate)
    for epoch in range(1, epochs + 1):
        features, targets, sample_weights = epoch_arrays(rng, batch_size)
        x = standardise_apply(features, feature_mean, feature_std)
        y = standardise_apply(targets, target_mean, target_std)
        average_train_loss = model.train_epoch(x, y, sample_weights, batch_size, rng)

        curated_holdout_metrics = evaluate_samples(
            model,
            curated_holdout_samples,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        curated_full_metrics = evaluate_samples(
            model,
            curated_full_samples,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        synthetic_val_metrics = evaluate_samples(model, synthetic_val_samples, feature_mean, feature_std, target_mean, target_std)
        yellow_blue_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_yellow_blue_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        yellow_magenta_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_yellow_magenta_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        red_yellow_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_red_yellow_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        purple_opponent_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_purple_opponent_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        earth_opponent_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_earth_opponent_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        white_tint_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_white_tint_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        white_tint_chain_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_white_tint_chain_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        black_guardrail_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_black_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        black_shade_chain_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_black_shade_chain_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        dark_neutral_metrics = evaluate_subset(
            model,
            curated_holdout_samples,
            is_dark_neutral_guardrail,
            feature_mean,
            feature_std,
            target_mean,
            target_std,
        )
        score = objective(
            curated_holdout_metrics,
            synthetic_val_metrics,
            yellow_blue_metrics,
            yellow_magenta_metrics,
            red_yellow_metrics,
            purple_opponent_metrics,
            earth_opponent_metrics,
            white_tint_metrics,
            white_tint_chain_metrics,
            black_guardrail_metrics,
            black_shade_chain_metrics,
            dark_neutral_metrics,
        )
        if score < best_score:
            best_score = score
            best_state = model.copy_state()

        if history_writer is not None:
            history_writer.writerow(
                {
                    "stage": stage_name,
                    "epoch": epoch,
                    "train_loss": average_train_loss,
                    "curated_holdout_mean_delta_e": curated_holdout_metrics["mean_delta_e"],
                    "curated_holdout_p95_delta_e": curated_holdout_metrics["p95_delta_e"],
                    "curated_holdout_max_delta_e": curated_holdout_metrics["max_delta_e"],
                    "curated_full_mean_delta_e": curated_full_metrics["mean_delta_e"],
                    "curated_full_p95_delta_e": curated_full_metrics["p95_delta_e"],
                    "curated_full_max_delta_e": curated_full_metrics["max_delta_e"],
                    "synthetic_val_mean_delta_e": synthetic_val_metrics["mean_delta_e"],
                    "yellow_blue_holdout_mean_delta_e": yellow_blue_metrics["mean_delta_e"],
                    "yellow_magenta_holdout_mean_delta_e": yellow_magenta_metrics["mean_delta_e"],
                    "red_yellow_holdout_mean_delta_e": red_yellow_metrics["mean_delta_e"],
                    "purple_opponent_holdout_mean_delta_e": purple_opponent_metrics["mean_delta_e"],
                    "earth_opponent_holdout_mean_delta_e": earth_opponent_metrics["mean_delta_e"],
                    "white_tint_holdout_mean_delta_e": white_tint_metrics["mean_delta_e"],
                    "white_tint_chain_holdout_mean_delta_e": white_tint_chain_metrics["mean_delta_e"],
                    "black_guardrail_holdout_mean_delta_e": black_guardrail_metrics["mean_delta_e"],
                    "black_shade_chain_holdout_mean_delta_e": black_shade_chain_metrics["mean_delta_e"],
                    "dark_neutral_holdout_mean_delta_e": dark_neutral_metrics["mean_delta_e"],
                    "score": score,
                    "best_score": best_score,
                }
            )

        if epoch == 1 or epoch == epochs or epoch % 10 == 0:
            print(
                f"[{stage_name}] epoch {epoch:03d}/{epochs} "
                f"train_loss={average_train_loss:.5f} "
                f"holdout_meanΔE={curated_holdout_metrics['mean_delta_e']:.4f} "
                f"holdout_p95ΔE={curated_holdout_metrics['p95_delta_e']:.4f} "
                f"ybΔE={yellow_blue_metrics['mean_delta_e']:.4f} "
                f"ymΔE={yellow_magenta_metrics['mean_delta_e']:.4f} "
                f"ryΔE={red_yellow_metrics['mean_delta_e']:.4f} "
                f"purpΔE={purple_opponent_metrics['mean_delta_e']:.4f} "
                f"earthΔE={earth_opponent_metrics['mean_delta_e']:.4f} "
                f"tintΔE={white_tint_metrics['mean_delta_e']:.4f} "
                f"tintChainΔE={white_tint_chain_metrics['mean_delta_e']:.4f} "
                f"shadeChainΔE={black_shade_chain_metrics['mean_delta_e']:.4f} "
                f"darkNΔE={dark_neutral_metrics['mean_delta_e']:.4f} "
                f"full_meanΔE={curated_full_metrics['mean_delta_e']:.4f} "
                f"synthetic_val_meanΔE={synthetic_val_metrics['mean_delta_e']:.4f}"
            )

    model.load_state(best_state)
    return best_state


def emit_kotlin_weights(
    path: Path,
    model: ExportableMLP,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
    summary: str,
) -> None:
    def fmt(value: float) -> str:
        if abs(value) >= 1e-4:
            return f"{value:.10f}"
        return f"{value:.10e}"

    def write_array(values: np.ndarray) -> str:
        return "doubleArrayOf(" + ", ".join(fmt(float(value)) for value in values) + ")"

    def write_matrix(values: np.ndarray) -> str:
        rows = ["        " + write_array(row) for row in values]
        return "arrayOf(\n" + ",\n".join(rows) + "\n    )"

    kotlin = f"""package io.github.rtarik.paintmixer.legacy

/**
 * Generated by tools/training/train_mixer_model.py.
 * Summary: {summary}
 */
internal object LearnedMixerModelWeights {{
    const val enabled: Boolean = true
    const val inputDim: Int = {INPUT_DIM}
    const val hidden1Dim: Int = {HIDDEN1_DIM}
    const val hidden2Dim: Int = {HIDDEN2_DIM}

    val featureMean: DoubleArray = {write_array(feature_mean)}
    val featureStd: DoubleArray = {write_array(feature_std)}
    val targetMean: DoubleArray = {write_array(target_mean)}
    val targetStd: DoubleArray = {write_array(target_std)}

    val layer1Weights: Array<DoubleArray> = {write_matrix(model.w1)}
    val layer1Bias: DoubleArray = {write_array(model.b1)}
    val layer2Weights: Array<DoubleArray> = {write_matrix(model.w2)}
    val layer2Bias: DoubleArray = {write_array(model.b2)}
    val outputWeights: Array<DoubleArray> = {write_matrix(model.w3)}
    val outputBias: DoubleArray = {write_array(model.b3)}
}}
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(kotlin, encoding="utf-8")


def target_magenta(sample: Sample) -> bool:
    rgb = hex_to_srgb(sample.target)
    return bool(rgb[0] > rgb[1] and rgb[2] > rgb[1])


def format_key_mix_report(
    model: ExportableMLP,
    samples: list[Sample],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> list[str]:
    interesting = [
        "primary/red+blue",
        "extra/pureRed+pureBlue",
        "primary/yellow+blue",
        "primary/red+yellow",
        "modern/cyan+magenta",
        "oils/crimson+phthaloBlue",
        "oils/crimson+prussianBlue",
        "oils/yellow+phthaloBlue",
        "primary/red+blue+white",
    ]
    sample_by_key = {f"{sample.palette}/{sample.label}": sample for sample in samples}
    lines = ["Key curated mixes:"]
    for key in interesting:
        sample = sample_by_key.get(key)
        if sample is None:
            continue
        predicted = predict_sample_hex(model, sample, feature_mean, feature_std, target_mean, target_std)
        delta = delta_e_from_hex(predicted, sample.target)
        lines.append(
            f"  {key:<28} physical={sample.physical} predicted={predicted} "
            f"target={sample.target} ΔE={delta:.4f}"
        )
    return lines


def format_guardrail_report(
    model: ExportableMLP,
    samples: list[Sample],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> list[str]:
    interesting = [
        "primary/yellow+blue",
        "primary/yellow+blue@2:1",
        "primary/yellow+blue@1:2",
        "watercolors/cadYellow+cerulean",
        "watercolors/cadYellow+cerulean@2:1",
        "watercolors/cadYellow+cerulean@1:2",
        "watercolors/cadYellow+ultramarine",
        "watercolors/cadYellow+ultramarine@2:1",
        "watercolors/cadYellow+ultramarine@1:2",
        "primary/red+yellow",
        "primary/red+yellow@2:1",
        "primary/red+yellow@1:2",
        "acrylics/red+yellow@2:1",
        "acrylics/red+yellow@1:2",
        "modern×acrylics/cyan+red",
        "modern×acrylics/cyan+red@2:1",
        "modern×acrylics/cyan+red@1:2",
        "primary×miniatures/red+blue",
        "primary×miniatures/red+blue@2:1",
        "primary×miniatures/red+blue@1:2",
        "acrylics/red+cerulean",
        "acrylics/red+cerulean@2:1",
        "acrylics/red+cerulean@1:2",
        "modern×industrial/cyan+orange",
        "modern×industrial/cyan+orange@2:1",
        "modern×industrial/cyan+orange@1:2",
        "industrial/orange+pigeonBlue",
        "industrial/orange+pigeonBlue@2:1",
        "industrial/orange+pigeonBlue@1:2",
        "oils/crimson+phthaloBlue",
        "oils/crimson+phthaloBlue@2:1",
        "oils/crimson+phthaloBlue@1:2",
        "oils/crimson+prussianBlue",
        "oils/crimson+prussianBlue@2:1",
        "oils/crimson+prussianBlue@1:2",
        "oils/phthaloBlue+vanDykeBrown",
        "oils/phthaloBlue+vanDykeBrown@2:1",
        "oils/phthaloBlue+vanDykeBrown@1:2",
        "extra/pureRed+pureGreen",
        "extra/pureRed+pureGreen@2:1",
        "extra/pureRed+pureGreen@1:2",
        "extra/pureYellow+pureMagenta",
        "extra/pureYellow+pureMagenta@2:1",
        "extra/pureYellow+pureMagenta@1:2",
        "extra/pureYellow+pureMagenta@1:3",
        "oils/yellow+phthaloBlue",
        "oils/yellow+phthaloBlue@2:1",
        "oils/yellow+phthaloBlue@1:2",
        "primary/blue+white",
        "primary/blue+white@1:2",
        "primary/blue+white@1:3",
        "primary/blue+white@1:8",
        "primary/blue+white@1:32",
        "primary/blue+white@1:100",
        "primary/blue+white_chain2",
        "primary/blue+white_chain3",
        "primary/white+black_then_white_chain2",
        "oils/phthaloBlue+white",
        "oils/phthaloBlue+white@1:2",
        "oils/phthaloBlue+white@1:8",
        "oils/phthaloBlue+white_chain2",
        "primary/blue+black",
        "primary/blue+black@1:2",
        "primary/blue+black@1:4",
        "primary/blue+black_chain2",
        "primary/blue+black_chain3",
        "primary/white+black@8:1",
        "primary/white+black@32:1",
        "primary/white+black@100:1",
        "primary/white+black@1:2",
        "primary/white+black_then_black_chain2",
        "industrial/anthracite+white@1:8",
        "industrial/anthracite+white@1:32",
        "industrial/anthracite+white_chain2",
        "industrial/yellow+anthracite",
        "industrial/yellow+anthracite@1:2",
        "industrial/yellow+anthracite@1:4",
        "industrial/yellow+anthracite@1:8",
    ]
    sample_by_key = {f"{sample.palette}/{sample.label}": sample for sample in samples}
    lines = ["Guardrail mixes:"]
    for key in interesting:
        sample = sample_by_key.get(key)
        if sample is None:
            continue
        predicted = predict_sample_hex(model, sample, feature_mean, feature_std, target_mean, target_std)
        delta = delta_e_from_hex(predicted, sample.target)
        lines.append(
            f"  {key:<28} physical={sample.physical} predicted={predicted} "
            f"target={sample.target} ΔE={delta:.4f}"
        )
    return lines


def predict_sample_hex(
    model: ExportableMLP,
    sample: Sample,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> str:
    feature = build_features(sample)[None, :]
    predicted_residual = model.predict(standardise_apply(feature, feature_mean, feature_std))[0]
    predicted_residual = predicted_residual * target_std + target_mean
    return residual_prediction_to_hex(predicted_residual, sample)


def top_curated_failures(
    model: ExportableMLP,
    samples: list[Sample],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> list[str]:
    rows = []
    for sample in samples:
        predicted = predict_sample_hex(model, sample, feature_mean, feature_std, target_mean, target_std)
        rows.append((delta_e_from_hex(predicted, sample.target), predicted, sample))
    rows.sort(key=lambda row: row[0], reverse=True)
    lines = ["Top 20 curated failures:"]
    for delta, predicted, sample in rows[:20]:
        lines.append(f"  ΔE={delta:7.4f}  {predicted} vs {sample.target}  {sample.palette}/{sample.label}")
    return lines


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    training_device = resolve_training_device(args.device)

    data_dir = Path(args.data_dir)
    kotlin_out = Path(args.kotlin_out)
    checkpoint_out = Path(args.checkpoint_out)
    report_out = Path(args.report_out)
    history_out = Path(args.history_out)
    curated_path = data_dir / "curated_with_physical.jsonl"
    synthetic_path = data_dir / "synthetic_with_physical.jsonl"
    if not curated_path.exists() or not synthetic_path.exists():
        raise RuntimeError(
            "Missing physical-baseline JSONL files. "
            "Run `python3 tools/training/run_training_pipeline.py` "
            "or at least run the physical-baseline export stage before training."
        )

    curated_samples = read_jsonl(curated_path)
    synthetic_samples = read_jsonl(synthetic_path)
    synthetic_train = [sample for sample in synthetic_samples if not is_validation_sample(sample)]
    synthetic_val = [sample for sample in synthetic_samples if is_validation_sample(sample)]
    curated_train, curated_holdout = split_curated_samples(curated_samples, args.curated_holdout_ratio)

    if not synthetic_train:
        raise RuntimeError("Synthetic training split is empty.")
    if not synthetic_val:
        raise RuntimeError("Synthetic validation split is empty.")
    if not curated_train or not curated_holdout:
        raise RuntimeError("Curated train/holdout split is invalid.")

    synthetic_train_features, synthetic_train_targets, synthetic_train_weights = create_arrays(synthetic_train)
    curated_train_features, curated_train_targets, curated_train_weights = create_arrays(curated_train)

    combined_train = synthetic_train + curated_train
    combined_features, combined_targets, _ = create_arrays(combined_train)
    feature_mean, feature_std = standardise_fit(combined_features)
    target_mean, target_std = standardise_fit(combined_targets)

    model = ExportableMLP(rng, device=training_device)
    warm_start_candidates: list[Path] = []
    if not args.cold_start:
        if args.warm_start_from:
            warm_start_candidates.append(Path(args.warm_start_from))
        else:
            if checkpoint_out.exists():
                warm_start_candidates.append(checkpoint_out)
            if kotlin_out.exists() and kotlin_out != checkpoint_out:
                warm_start_candidates.append(kotlin_out)
    warm_start_snapshot = maybe_warm_start_model(
        model,
        warm_start_candidates,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
        strict=args.warm_start_from is not None,
    )
    history_out.parent.mkdir(parents=True, exist_ok=True)

    print(
        f"Loaded {len(synthetic_train)} synthetic train, {len(synthetic_val)} synthetic val, "
        f"{len(curated_train)} curated train, {len(curated_holdout)} curated holdout."
    )
    print(f"Training backend: pytorch ({training_device})")
    with history_out.open("w", encoding="utf-8", newline="") as history_handle:
        history_writer = csv.DictWriter(
            history_handle,
            fieldnames=[
                "stage",
                "epoch",
                "train_loss",
                "curated_holdout_mean_delta_e",
                "curated_holdout_p95_delta_e",
                "curated_holdout_max_delta_e",
                "curated_full_mean_delta_e",
                "curated_full_p95_delta_e",
                "curated_full_max_delta_e",
                "synthetic_val_mean_delta_e",
                "yellow_blue_holdout_mean_delta_e",
                "yellow_magenta_holdout_mean_delta_e",
                "red_yellow_holdout_mean_delta_e",
                "purple_opponent_holdout_mean_delta_e",
                "earth_opponent_holdout_mean_delta_e",
                "white_tint_holdout_mean_delta_e",
                "white_tint_chain_holdout_mean_delta_e",
                "black_guardrail_holdout_mean_delta_e",
                "black_shade_chain_holdout_mean_delta_e",
                "dark_neutral_holdout_mean_delta_e",
                "score",
                "best_score",
            ],
        )
        history_writer.writeheader()

        train_stage(
            model=model,
            stage_name="warmup",
            epoch_arrays=make_synthetic_warmup_sampler(
                synthetic_train_features,
                synthetic_train_targets,
                synthetic_train_weights,
            ),
            curated_holdout_samples=curated_holdout,
            curated_full_samples=curated_samples,
            synthetic_val_samples=synthetic_val,
            feature_mean=feature_mean,
            feature_std=feature_std,
            target_mean=target_mean,
            target_std=target_std,
            epochs=args.epochs_warmup,
            batch_size=args.batch_size,
            learning_rate=args.lr_warmup,
            rng=rng,
            history_writer=history_writer,
        )
        train_stage(
            model=model,
            stage_name="mixed",
            epoch_arrays=make_balanced_mixed_sampler(
                synthetic_train_features,
                synthetic_train_targets,
                synthetic_train_weights,
                curated_train_features,
                curated_train_targets,
                curated_train_weights,
            ),
            curated_holdout_samples=curated_holdout,
            curated_full_samples=curated_samples,
            synthetic_val_samples=synthetic_val,
            feature_mean=feature_mean,
            feature_std=feature_std,
            target_mean=target_mean,
            target_std=target_std,
            epochs=args.epochs_mixed,
            batch_size=args.batch_size,
            learning_rate=args.lr_mixed,
            rng=rng,
            history_writer=history_writer,
        )
        train_stage(
            model=model,
            stage_name="tail",
            epoch_arrays=make_curated_tail_sampler(
                curated_train_features,
                curated_train_targets,
                curated_train_weights,
            ),
            curated_holdout_samples=curated_holdout,
            curated_full_samples=curated_samples,
            synthetic_val_samples=synthetic_val,
            feature_mean=feature_mean,
            feature_std=feature_std,
            target_mean=target_mean,
            target_std=target_std,
            epochs=args.epochs_tail,
            batch_size=args.batch_size,
            learning_rate=args.lr_tail,
            rng=rng,
            history_writer=history_writer,
        )

    curated_metrics = evaluate_samples(model, curated_samples, feature_mean, feature_std, target_mean, target_std)
    curated_holdout_metrics = evaluate_samples(model, curated_holdout, feature_mean, feature_std, target_mean, target_std)
    synthetic_val_metrics = evaluate_samples(model, synthetic_val, feature_mean, feature_std, target_mean, target_std)
    curated_baseline = baseline_metrics(curated_samples)
    curated_holdout_baseline = baseline_metrics(curated_holdout)
    synthetic_val_baseline = baseline_metrics(synthetic_val)
    yellow_blue_metrics = evaluate_subset(
        model,
        curated_samples,
        is_yellow_blue_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    yellow_magenta_metrics = evaluate_subset(
        model,
        curated_samples,
        is_yellow_magenta_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    red_yellow_metrics = evaluate_subset(
        model,
        curated_samples,
        is_red_yellow_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    purple_opponent_metrics = evaluate_subset(
        model,
        curated_samples,
        is_purple_opponent_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    earth_opponent_metrics = evaluate_subset(
        model,
        curated_samples,
        is_earth_opponent_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    white_tint_metrics = evaluate_subset(
        model,
        curated_samples,
        is_white_tint_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    white_tint_chain_metrics = evaluate_subset(
        model,
        curated_samples,
        is_white_tint_chain_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    black_guardrail_metrics = evaluate_subset(
        model,
        curated_samples,
        is_black_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    black_shade_chain_metrics = evaluate_subset(
        model,
        curated_samples,
        is_black_shade_chain_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    dark_neutral_metrics = evaluate_subset(
        model,
        curated_samples,
        is_dark_neutral_guardrail,
        feature_mean,
        feature_std,
        target_mean,
        target_std,
    )
    yellow_blue_baseline = baseline_subset_metrics(curated_samples, is_yellow_blue_guardrail)
    yellow_magenta_baseline = baseline_subset_metrics(curated_samples, is_yellow_magenta_guardrail)
    red_yellow_baseline = baseline_subset_metrics(curated_samples, is_red_yellow_guardrail)
    purple_opponent_baseline = baseline_subset_metrics(curated_samples, is_purple_opponent_guardrail)
    earth_opponent_baseline = baseline_subset_metrics(curated_samples, is_earth_opponent_guardrail)
    white_tint_baseline = baseline_subset_metrics(curated_samples, is_white_tint_guardrail)
    white_tint_chain_baseline = baseline_subset_metrics(curated_samples, is_white_tint_chain_guardrail)
    black_guardrail_baseline = baseline_subset_metrics(curated_samples, is_black_guardrail)
    black_shade_chain_baseline = baseline_subset_metrics(curated_samples, is_black_shade_chain_guardrail)
    dark_neutral_baseline = baseline_subset_metrics(curated_samples, is_dark_neutral_guardrail)
    summary = (
        f"synthetic_train={len(synthetic_train)} synthetic_val={len(synthetic_val)} "
        f"curated_train={len(curated_train)} curated_holdout={len(curated_holdout)} "
        f"curated_mean_delta_e={curated_metrics['mean_delta_e']:.4f} "
        f"curated_holdout_mean_delta_e={curated_holdout_metrics['mean_delta_e']:.4f} "
        f"warm_start={'none' if warm_start_snapshot is None else warm_start_snapshot.source_kind}"
    )

    emit_kotlin_weights(kotlin_out, model, feature_mean, feature_std, target_mean, target_std, summary)
    save_checkpoint(checkpoint_out, model, feature_mean, feature_std, target_mean, target_std)

    warm_start_line = "Warm start: cold start"
    if warm_start_snapshot is not None:
        warm_start_line = (
            f"Warm start: loaded from {warm_start_snapshot.source_kind} "
            f"at {warm_start_snapshot.source_path}"
        )

    report_lines = [
        "Learned mixer training report",
        f"Data dir: {data_dir}",
        "Training backend: pytorch",
        f"Training device: {training_device}",
        warm_start_line,
        f"Checkpoint out: {checkpoint_out}",
        f"Synthetic train: {len(synthetic_train)}",
        f"Synthetic val:   {len(synthetic_val)}",
        f"Curated train:   {len(curated_train)}",
        f"Curated holdout: {len(curated_holdout)}",
        f"Curated total:   {len(curated_samples)}",
        "",
        f"Synthetic val physical mean ΔE: {synthetic_val_baseline['mean_delta_e']:.4f}",
        f"Synthetic val mean ΔE: {synthetic_val_metrics['mean_delta_e']:.4f}",
        f"Synthetic val p95  ΔE: {synthetic_val_metrics['p95_delta_e']:.4f}",
        f"Curated holdout physical mean ΔE: {curated_holdout_baseline['mean_delta_e']:.4f}",
        f"Curated holdout mean ΔE:          {curated_holdout_metrics['mean_delta_e']:.4f}",
        f"Curated holdout p95  ΔE:          {curated_holdout_metrics['p95_delta_e']:.4f}",
        f"Curated holdout max  ΔE:          {curated_holdout_metrics['max_delta_e']:.4f}",
        f"Curated full physical mean ΔE:    {curated_baseline['mean_delta_e']:.4f}",
        f"Curated full mean ΔE:             {curated_metrics['mean_delta_e']:.4f}",
        f"Curated full p95  ΔE:             {curated_metrics['p95_delta_e']:.4f}",
        f"Curated full max  ΔE:             {curated_metrics['max_delta_e']:.4f}",
        "",
        "Guardrail subsets:",
        f"Yellow+Blue physical mean ΔE:     {yellow_blue_baseline['mean_delta_e']:.4f}",
        f"Yellow+Blue mean ΔE:              {yellow_blue_metrics['mean_delta_e']:.4f}",
        f"Yellow+Blue p95  ΔE:              {yellow_blue_metrics['p95_delta_e']:.4f}",
        f"Yellow+Magenta physical mean ΔE:  {yellow_magenta_baseline['mean_delta_e']:.4f}",
        f"Yellow+Magenta mean ΔE:           {yellow_magenta_metrics['mean_delta_e']:.4f}",
        f"Yellow+Magenta p95  ΔE:           {yellow_magenta_metrics['p95_delta_e']:.4f}",
        f"Red+Yellow physical mean ΔE:      {red_yellow_baseline['mean_delta_e']:.4f}",
        f"Red+Yellow mean ΔE:               {red_yellow_metrics['mean_delta_e']:.4f}",
        f"Red+Yellow p95  ΔE:               {red_yellow_metrics['p95_delta_e']:.4f}",
        f"Manual purple exceptions physical mean ΔE: {purple_opponent_baseline['mean_delta_e']:.4f}",
        f"Manual purple exceptions mean ΔE:          {purple_opponent_metrics['mean_delta_e']:.4f}",
        f"Manual purple exceptions p95  ΔE:          {purple_opponent_metrics['p95_delta_e']:.4f}",
        f"Manual earth exceptions physical mean ΔE:  {earth_opponent_baseline['mean_delta_e']:.4f}",
        f"Manual earth exceptions mean ΔE:           {earth_opponent_metrics['mean_delta_e']:.4f}",
        f"Manual earth exceptions p95  ΔE:           {earth_opponent_metrics['p95_delta_e']:.4f}",
        f"White tint physical mean ΔE:      {white_tint_baseline['mean_delta_e']:.4f}",
        f"White tint mean ΔE:               {white_tint_metrics['mean_delta_e']:.4f}",
        f"White tint p95  ΔE:               {white_tint_metrics['p95_delta_e']:.4f}",
        f"White tint chain physical mean ΔE:{white_tint_chain_baseline['mean_delta_e']:.4f}",
        f"White tint chain mean ΔE:         {white_tint_chain_metrics['mean_delta_e']:.4f}",
        f"White tint chain p95  ΔE:         {white_tint_chain_metrics['p95_delta_e']:.4f}",
        f"Black/neutral physical mean ΔE:   {black_guardrail_baseline['mean_delta_e']:.4f}",
        f"Black/neutral mean ΔE:            {black_guardrail_metrics['mean_delta_e']:.4f}",
        f"Black/neutral p95  ΔE:            {black_guardrail_metrics['p95_delta_e']:.4f}",
        f"Black chain physical mean ΔE:     {black_shade_chain_baseline['mean_delta_e']:.4f}",
        f"Black chain mean ΔE:              {black_shade_chain_metrics['mean_delta_e']:.4f}",
        f"Black chain p95  ΔE:              {black_shade_chain_metrics['p95_delta_e']:.4f}",
        f"Dark neutral physical mean ΔE:    {dark_neutral_baseline['mean_delta_e']:.4f}",
        f"Dark neutral mean ΔE:             {dark_neutral_metrics['mean_delta_e']:.4f}",
        f"Dark neutral p95  ΔE:             {dark_neutral_metrics['p95_delta_e']:.4f}",
        f"History CSV: {history_out}",
        "",
    ]
    report_lines += format_key_mix_report(model, curated_samples, feature_mean, feature_std, target_mean, target_std)
    report_lines += [""] + format_guardrail_report(model, curated_samples, feature_mean, feature_std, target_mean, target_std)
    report_lines += [""] + top_curated_failures(model, curated_samples, feature_mean, feature_std, target_mean, target_std)
    report_lines += [
        "",
        f"Wrote legacy warm-start weights to: {kotlin_out}",
        f"Wrote checkpoint to: {checkpoint_out}",
        "Suggested app test: start with learnedMixerBlend = 1.0, then reduce only if the correction helps the hard cases but becomes too visible elsewhere.",
    ]

    report_out.parent.mkdir(parents=True, exist_ok=True)
    report_out.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    print("\n".join(report_lines))


if __name__ == "__main__":
    main()
