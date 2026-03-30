#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


DEFAULT_DATA_DIR = "tools/training/out/data"
DEFAULT_KOTLIN_OUT = "tools/training/out/legacy/LearnedMixerModelWeights.kt"
DEFAULT_CHECKPOINT_OUT = "tools/training/out/latest_checkpoint.npz"
DEFAULT_REPORT_OUT = "tools/training/out/latest_report.txt"
DEFAULT_HISTORY_OUT = "tools/training/out/latest_history.csv"
DEFAULT_COMPARE_XML_OUT = "tools/eval/out/latest_compare.xml"
DEFAULT_COMPARE_REPORT_OUT = "tools/eval/out/latest_compare.txt"
DEFAULT_EPOCHS_WARMUP = 10
DEFAULT_EPOCHS_MIXED = 80
DEFAULT_EPOCHS_TAIL = 80
WARM_START_EPOCHS_WARMUP = 0
WARM_START_EPOCHS_MIXED = 64
WARM_START_EPOCHS_TAIL = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the full learned-mixer training pipeline end to end."
    )
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--synthetic-count", type=int, default=50000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs-warmup", type=int, default=DEFAULT_EPOCHS_WARMUP)
    parser.add_argument("--epochs-mixed", type=int, default=DEFAULT_EPOCHS_MIXED)
    parser.add_argument("--epochs-tail", type=int, default=DEFAULT_EPOCHS_TAIL)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr-warmup", type=float, default=0.003)
    parser.add_argument("--lr-mixed", type=float, default=0.001)
    parser.add_argument("--lr-tail", type=float, default=0.00035)
    parser.add_argument("--curated-holdout-ratio", type=float, default=0.12)
    parser.add_argument("--kotlin-out", default=DEFAULT_KOTLIN_OUT)
    parser.add_argument("--checkpoint-out", default=DEFAULT_CHECKPOINT_OUT)
    parser.add_argument("--warm-start-from")
    parser.add_argument("--cold-start", action="store_true")
    parser.add_argument("--report-out", default=DEFAULT_REPORT_OUT)
    parser.add_argument("--history-out", default=DEFAULT_HISTORY_OUT)
    parser.add_argument("--compare-xml-out", default=DEFAULT_COMPARE_XML_OUT)
    parser.add_argument("--compare-report-out", default=DEFAULT_COMPARE_REPORT_OUT)
    parser.add_argument("--skip-compare", action="store_true")
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]

def argument_was_provided(argv: list[str], flag: str) -> bool:
    return any(arg == flag or arg.startswith(f"{flag}=") for arg in argv)


def has_enabled_kotlin_weights(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    return "const val enabled: Boolean = true" in text


def run_step(
    name: str,
    cmd: list[str],
    cwd: Path,
    env: dict[str, str] | None = None,
) -> None:
    print()
    print(f"== {name} ==")
    print(" ".join(cmd))
    try:
        subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"{name} failed with exit code {exc.returncode}") from exc


def main() -> None:
    args = parse_args()
    raw_argv = sys.argv[1:]
    root = repo_root()
    data_dir = (root / args.data_dir).resolve()
    kotlin_out = (root / args.kotlin_out).resolve()
    checkpoint_out = (root / args.checkpoint_out).resolve()
    report_out = (root / args.report_out).resolve()
    history_out = (root / args.history_out).resolve()
    compare_xml_out = (root / args.compare_xml_out).resolve()
    compare_report_out = (root / args.compare_report_out).resolve()

    explicit_warm_start = (root / args.warm_start_from).resolve() if args.warm_start_from else None
    warm_start_available = False
    if not args.cold_start:
        warm_start_available = (
            explicit_warm_start is not None
            or checkpoint_out.exists()
            or has_enabled_kotlin_weights(kotlin_out)
        )

    epochs_warmup = args.epochs_warmup
    epochs_mixed = args.epochs_mixed
    epochs_tail = args.epochs_tail
    using_condensed_warm_start_schedule = False
    if warm_start_available:
        if not argument_was_provided(raw_argv, "--epochs-warmup"):
            epochs_warmup = WARM_START_EPOCHS_WARMUP
            using_condensed_warm_start_schedule = True
        if not argument_was_provided(raw_argv, "--epochs-mixed"):
            epochs_mixed = WARM_START_EPOCHS_MIXED
            using_condensed_warm_start_schedule = True
        if not argument_was_provided(raw_argv, "--epochs-tail"):
            epochs_tail = WARM_START_EPOCHS_TAIL
            using_condensed_warm_start_schedule = True

    if using_condensed_warm_start_schedule:
        print()
        print(
            "Using condensed warm-start schedule "
            f"(warmup={epochs_warmup}, mixed={epochs_mixed}, tail={epochs_tail})"
        )

    run_step(
        name="Export spectral.js training data",
        cmd=[
            "node",
            "tools/dataset-generator/export-training-data.js",
            "--synthetic-count",
            str(args.synthetic_count),
            "--seed",
            str(args.seed),
            "--output-dir",
            str(data_dir),
        ],
        cwd=root,
    )

    run_step(
        name="Merge approved ground-truth targets into curated training data",
        cmd=[
            "node",
            "tools/training/merge-ground-truth-into-data.mjs",
            "--data-dir",
            str(data_dir),
        ],
        cwd=root,
    )

    run_step(
        name="Export physical mixer baselines",
        cmd=[
            "node",
            "tools/eval/export-physical-baselines.mjs",
            "--data-dir",
            str(data_dir),
        ],
        cwd=root,
    )

    train_cmd = [
        sys.executable,
        "tools/training/train_mixer_model.py",
        "--data-dir",
        str(data_dir),
        "--epochs-warmup",
        str(epochs_warmup),
        "--epochs-mixed",
        str(epochs_mixed),
        "--epochs-tail",
        str(epochs_tail),
        "--batch-size",
        str(args.batch_size),
        "--lr-warmup",
        str(args.lr_warmup),
        "--lr-mixed",
        str(args.lr_mixed),
        "--lr-tail",
        str(args.lr_tail),
        "--curated-holdout-ratio",
        str(args.curated_holdout_ratio),
        "--seed",
        str(args.seed),
        "--kotlin-out",
        str(kotlin_out),
        "--checkpoint-out",
        str(checkpoint_out),
        "--report-out",
        str(report_out),
        "--history-out",
        str(history_out),
    ]
    if args.warm_start_from:
        train_cmd.extend(["--warm-start-from", str((root / args.warm_start_from).resolve())])
    if args.cold_start:
        train_cmd.append("--cold-start")

    run_step(
        name="Train residual model",
        cmd=train_cmd,
        cwd=root,
    )

    run_step(
        name="Refresh canonical runtime artifact",
        cmd=[
            sys.executable,
            "tools/training/export_artifact.py",
            "--checkpoint",
            str(checkpoint_out),
            "--report",
            str(report_out),
        ],
        cwd=root,
    )

    if not args.skip_compare:
        run_step(
            name="Compare physical vs learned mixer",
            cmd=[
                "node",
                "tools/eval/compare-mixer.mjs",
                "--data-dir",
                str(data_dir),
                "--xml-out",
                str(compare_xml_out),
                "--report-out",
                str(compare_report_out),
            ],
            cwd=root,
        )

    print()
    print("Pipeline completed.")
    print(f"Data dir:   {data_dir}")
    print(f"Legacy warm-start weights: {kotlin_out}")
    print(f"Checkpoint: {checkpoint_out}")
    print(f"Report:     {report_out}")
    print(f"History:    {history_out}")
    print(f"Artifact:   {root / 'artifacts/model/baseline-v1/model.json'}")
    if not args.skip_compare:
        print(f"Compare report: {compare_report_out}")
        print(f"Compare XML:    {compare_xml_out}")


if __name__ == "__main__":
    main()
