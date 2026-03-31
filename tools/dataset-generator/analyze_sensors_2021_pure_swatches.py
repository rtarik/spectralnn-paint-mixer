#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt


VISIBLE_MIN_NM = 405
VISIBLE_MAX_NM = 700


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate a diagnostic report for the Sensors 2021 pure swatches."
    )
    parser.add_argument(
        "--measured-dir",
        type=Path,
        default=Path("artifacts/measured/sensors-2021-v1"),
    )
    parser.add_argument(
        "--ground-truth-dir",
        type=Path,
        default=Path("artifacts/ground-truth/sensors-2021-binary-v1"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/measured/sensors-2021-v1/diagnostics"),
    )
    return parser.parse_args()


def read_json(path):
    return json.loads(path.read_text(encoding="utf8"))


def read_jsonl(path):
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def visible_stats(wavelengths_nm, reflectance):
    visible_pairs = [
        (wavelength, value)
        for wavelength, value in zip(wavelengths_nm, reflectance)
        if VISIBLE_MIN_NM <= wavelength <= VISIBLE_MAX_NM
    ]
    visible_values = [value for _, value in visible_pairs]
    return {
        "avgVisible": sum(visible_values) / len(visible_values),
        "minVisible": min(visible_values),
        "maxVisible": max(visible_values),
    }


def nearest_value(wavelengths_nm, reflectance, target_nm):
    best_index = min(range(len(wavelengths_nm)), key=lambda index: abs(wavelengths_nm[index] - target_nm))
    return wavelengths_nm[best_index], reflectance[best_index]


def main():
    args = parse_args()
    measured_dir = args.measured_dir.resolve()
    ground_truth_dir = args.ground_truth_dir.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    wavelengths_nm = read_json(measured_dir / "wavelengths_nm.json")
    pure_samples = read_jsonl(measured_dir / "pure-samples.jsonl")
    derived_paints = {
        paint["pigmentCode"]: paint
        for paint in read_json(ground_truth_dir / "paints.json")
    }

    lines = []
    lines.append("Sensors 2021 Pure Swatch Diagnostics")
    lines.append("")
    lines.append(f"Measured wavelengths: {len(wavelengths_nm)} ({wavelengths_nm[0]}-{wavelengths_nm[-1]} nm)")
    lines.append(f"Visible window used for summary: {VISIBLE_MIN_NM}-{VISIBLE_MAX_NM} nm")
    lines.append("")
    lines.append("Pigment summary:")

    plt.figure(figsize=(11, 6.5))
    for sample in pure_samples:
        component = sample["components"][0]
        pigment_code = component["pigmentCode"]
        pigment_name = component["pigmentName"]
        reflectance = sample["measuredReflectance"]
        stats = visible_stats(wavelengths_nm, reflectance)
        value_450_nm = nearest_value(wavelengths_nm, reflectance, 450)
        value_550_nm = nearest_value(wavelengths_nm, reflectance, 550)
        value_650_nm = nearest_value(wavelengths_nm, reflectance, 650)
        derived_hex = derived_paints[pigment_code]["colorHex"]

        lines.append(
            f"- {pigment_code} {pigment_name}: hex={derived_hex} "
            f"visible_avg={stats['avgVisible']:.3f} "
            f"visible_min={stats['minVisible']:.3f} "
            f"visible_max={stats['maxVisible']:.3f} "
            f"R450={value_450_nm[1]:.3f} "
            f"R550={value_550_nm[1]:.3f} "
            f"R650={value_650_nm[1]:.3f}"
        )

        plt.plot(wavelengths_nm, reflectance, label=f"{pigment_code} {pigment_name} {derived_hex}")

    lines.append("")
    lines.append("Interpretation:")
    lines.append("- The visible-band reflectance is very low for nearly all pure swatches, including the white paint.")
    lines.append("- The main rise in many spectra happens above 700 nm, which affects NIR analysis but not visible color appearance.")
    lines.append("- This strongly suggests the mismatch is inherited from the source measurements or source preprocessing rather than a simple label-mapping bug in the importer.")

    report_path = output_dir / "pure-swatch-diagnostics.txt"
    report_path.write_text("\n".join(lines) + "\n", encoding="utf8")

    plt.title("Sensors 2021 Pure Swatch Reflectance")
    plt.xlabel("Wavelength (nm)")
    plt.ylabel("Reflectance")
    plt.xlim(wavelengths_nm[0], wavelengths_nm[-1])
    plt.ylim(0, 0.7)
    plt.grid(alpha=0.25)
    plt.legend(fontsize=8, loc="upper left", ncol=2)
    plt.tight_layout()
    plot_path = output_dir / "pure-swatch-reflectance.png"
    plt.savefig(plot_path, dpi=160)
    plt.close()

    print(f"Wrote report: {report_path}")
    print(f"Wrote plot: {plot_path}")


if __name__ == "__main__":
    main()
