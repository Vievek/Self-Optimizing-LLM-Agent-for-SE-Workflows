# HEAE Controlled Evaluation Dataset v1

Dataset type: Controlled synthetic evaluation
Dataset version: 1.0
Status: Preparation / not yet reviewed

## Purpose

Evaluate HEAE failure-category classification using controlled
synthetic execution scenarios created separately from existing
development fixtures.

## Dataset contents

- traces/: JSONL execution traces following schema v1.0
- manifest.json: Dataset metadata and expected category labels
- annotations.json: Ground-truth annotations and supporting evidence

## Research safeguards

- This dataset is not collected from real Execution Core runs.
- Ground-truth labels must be established before running HEAE.
- Annotations remain draft until genuinely reviewed.
- HEAE predictions must not determine the expected labels.
- The dataset must be frozen before benchmark scoring.
- Results must not be described as real-world accuracy.
