#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


FEATURE_LAYOUT = [
    "slot0_r",
    "slot0_g",
    "slot0_b",
    "slot0_weight",
    "slot1_r",
    "slot1_g",
    "slot1_b",
    "slot1_weight",
    "slot2_r",
    "slot2_g",
    "slot2_b",
    "slot2_weight",
    "active_count_ratio",
    "mean_r",
    "mean_g",
    "mean_b",
    "mean_luminance",
    "violet_stress",
    "yellow_blue_stress",
    "dark_stress",
    "physical_oklab_l",
    "physical_oklab_a",
    "physical_oklab_b",
]

def path_for_artifact(path: Path, repo_root: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(repo_root).as_posix()
    except ValueError:
        return f"external/{resolved.name}"


def sanitize_warm_start(raw: str) -> str:
    value = raw.strip()
    if not value:
        return "unknown"
    if "loaded from checkpoint at " in value:
        return "loaded from checkpoint"
    return value


def parse_mixing_parameters(path: Path) -> dict[str, float]:
    pattern = re.compile(r"val\s+(\w+):\s+Double\s*=\s*([^,\n]+)")
    values: dict[str, float] = {}
    for name, raw_value in pattern.findall(path.read_text(encoding="utf-8")):
        values[name] = float(raw_value.strip())
    if not values:
        raise RuntimeError(f"Failed to parse mixing parameters from {path}")
    return values


def parse_report(path: Path) -> dict[str, object]:
    values: dict[str, object] = {}
    lines = path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        value = raw_value.strip()
        values[key.strip()] = value

    def number(name: str) -> float:
        raw = values.get(name)
        if raw is None:
            raise KeyError(name)
        return float(str(raw))

    def whole(name: str) -> int:
        return int(round(number(name)))

    return {
        "syntheticTrain": whole("Synthetic train"),
        "syntheticVal": whole("Synthetic val"),
        "curatedTrain": whole("Curated train"),
        "curatedHoldout": whole("Curated holdout"),
        "curatedTotal": whole("Curated total"),
        "warmStart": sanitize_warm_start(str(values.get("Warm start", "unknown"))),
        "curatedFullMeanDeltaE": number("Curated full mean ΔE"),
        "curatedFullP95DeltaE": number("Curated full p95  ΔE"),
        "curatedFullMaxDeltaE": number("Curated full max  ΔE"),
        "curatedHoldoutMeanDeltaE": number("Curated holdout mean ΔE"),
        "curatedHoldoutP95DeltaE": number("Curated holdout p95  ΔE"),
        "curatedHoldoutMaxDeltaE": number("Curated holdout max  ΔE"),
    }


def build_artifact(
    checkpoint_path: Path,
    report_path: Path,
    mixing_parameters_path: Path,
    model_id: str,
    repo_root: Path,
) -> dict[str, object]:
    with np.load(checkpoint_path, allow_pickle=False) as payload:
        input_dim = int(payload["input_dim"][0])
        hidden1_dim = int(payload["hidden1_dim"][0])
        hidden2_dim = int(payload["hidden2_dim"][0])
        output_dim = int(payload["output_dim"][0])

        artifact = {
            "artifactVersion": int(payload["format_version"][0]),
            "modelId": model_id,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "runtimeContract": {
                "colorSpace": "srgb",
                "internalColorSpace": "linear_srgb",
                "modelOutputSpace": "oklab_residual",
                "baseEngineId": "spectral_ks_v1",
                "maxColors": 3,
                "featureSchemaVersion": 1,
                "featureLayout": FEATURE_LAYOUT,
                "supportsResidualPhysicalInput": True,
            },
            "trainingSummary": parse_report(report_path),
            "mixingParameters": parse_mixing_parameters(mixing_parameters_path),
            "normalization": {
                "featureMean": payload["feature_mean"].astype(np.float64).tolist(),
                "featureStd": payload["feature_std"].astype(np.float64).tolist(),
                "targetMean": payload["target_mean"].astype(np.float64).tolist(),
                "targetStd": payload["target_std"].astype(np.float64).tolist(),
            },
            "network": {
                "architecture": "mlp",
                "activation": "tanh",
                "inputDim": input_dim,
                "hiddenDims": [hidden1_dim, hidden2_dim],
                "outputDim": output_dim,
                "weights": {
                    "w1": payload["w1"].astype(np.float64).tolist(),
                    "b1": payload["b1"].astype(np.float64).tolist(),
                    "w2": payload["w2"].astype(np.float64).tolist(),
                    "b2": payload["b2"].astype(np.float64).tolist(),
                    "w3": payload["w3"].astype(np.float64).tolist(),
                    "b3": payload["b3"].astype(np.float64).tolist(),
                },
            },
            "provenance": {
                "sourceCheckpoint": path_for_artifact(checkpoint_path, repo_root),
                "sourceReport": path_for_artifact(report_path, repo_root),
                "sourceMixingParameters": path_for_artifact(mixing_parameters_path, repo_root),
                "generator": "spectralnn-paint-mixer/tools/training/export_artifact.py",
            },
        }

    return artifact


def write_bundled_kotlin(path: Path, compact_json: str) -> None:
    kotlin = f"""package io.github.rtarik.paintmixer

/**
 * Generated by spectralnn-paint-mixer/tools/training/export_artifact.py.
 * Source of truth: artifacts/model/baseline-v1/model.json
 */
internal object DefaultModelArtifactJson {{
    const val value: String = \"\"\"{compact_json}\"\"\"
}}
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(kotlin, encoding="utf-8")


def write_bundled_js(json_path: Path, module_path: Path, pretty_json: str, compact_json: str) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    module_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(pretty_json, encoding="utf-8")
    module_path.write_text(f"export default {compact_json};\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    default_checkpoint = repo_root / "tools/training/out/latest_checkpoint.npz"
    default_report = repo_root / "tools/training/out/latest_report.txt"
    default_mixing_parameters = (
        repo_root / "packages/kotlin/src/commonMain/kotlin/io/github/rtarik/paintmixer/MixingParameters.kt"
    )

    parser = argparse.ArgumentParser(description="Export the canonical baseline model artifact.")
    parser.add_argument("--model-id", default="baseline-v1")
    parser.add_argument("--checkpoint", default=str(default_checkpoint))
    parser.add_argument("--report", default=str(default_report))
    parser.add_argument("--mixing-parameters", default=str(default_mixing_parameters))
    parser.add_argument(
        "--out-json",
        default=str(repo_root / "artifacts/model/baseline-v1/model.json"),
    )
    parser.add_argument(
        "--out-kotlin",
        default=str(
            repo_root /
            "packages/kotlin/src/commonMain/kotlin/io/github/rtarik/paintmixer/DefaultModelArtifactJson.kt"
        ),
    )
    parser.add_argument(
        "--out-js-json",
        default=str(
            repo_root /
            "packages/js/src/generated/default-model-artifact.json"
        ),
    )
    parser.add_argument(
        "--out-js-module",
        default=str(
            repo_root /
            "packages/js/src/generated/default-model-artifact-data.js"
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parents[2]
    checkpoint_path = Path(args.checkpoint)
    report_path = Path(args.report)
    mixing_parameters_path = Path(args.mixing_parameters)
    out_json = Path(args.out_json)
    out_kotlin = Path(args.out_kotlin)
    out_js_json = Path(args.out_js_json)
    out_js_module = Path(args.out_js_module)

    artifact = build_artifact(
        checkpoint_path=checkpoint_path,
        report_path=report_path,
        mixing_parameters_path=mixing_parameters_path,
        model_id=args.model_id,
        repo_root=root,
    )
    pretty_json = json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"
    compact_json = json.dumps(artifact, separators=(",", ":"), ensure_ascii=False)

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(pretty_json, encoding="utf-8")
    write_bundled_kotlin(out_kotlin, compact_json)
    write_bundled_js(out_js_json, out_js_module, pretty_json, compact_json)

    print(f"Wrote canonical artifact to {out_json}")
    print(f"Wrote bundled Kotlin JSON wrapper to {out_kotlin}")
    print(f"Wrote bundled JS JSON copy to {out_js_json}")
    print(f"Wrote bundled JS module to {out_js_module}")


if __name__ == "__main__":
    main()
