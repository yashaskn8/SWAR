# SWAR Phase M Spectral Baseline Protocol

Status: IMPLEMENTED HARNESS - scientific execution `VALIDATION REQUIRED`

Protocol version: `phase-m-spectral-logistic-v1`

Requirements: MLR-GOV-001, MLR-GOV-002, MLR-SPOOF-001, MLR-OOD-001, NFR-PRIV-002

## Purpose and claim boundary

The Phase M baseline is a transparent software and experiment-provenance reference. It is not
RawNet2, AASIST, ECAPA-TDNN, a production detector, a calibrated probability, or a promoted model.
Its purpose is to prove that a governed manifest can flow through the frozen Phase K leakage gate,
the exact Phase L preprocessing contract, deterministic spectral features, a small logistic learner,
and a Phase O-compatible result record.

The repository contains no acquired dataset and no promoted data version. The only currently
approved candidate in the Phase K register has not been imported into an approved external governed
data root. Therefore the scientific run is blocked with:

- `GOVERNED_MANIFEST_NOT_PROVIDED`; and
- `GOVERNED_DATA_ROOT_NOT_PROVIDED`.

This is `VALIDATION REQUIRED`, not a failed detector result. No accuracy, precision, recall, F1,
EER, robustness, language, or latency value is reported by Phase M.

## Governed input gate

[`run_baseline.py`](../../ml/baselines/run_baseline.py) accepts only an explicit manifest, external
data root, Phase K source register, and Phase L audio configuration. Before reading samples it:

1. validates source authority, license/adoption status, manifest semantics, file/header facts, size,
   SHA-256, and deterministic split assignment;
2. rejects exact/near duplicates, speaker-group leakage, lineage-root leakage, and final-OOD
   generator leakage using the Phase K implementation;
3. selects only declared `SPOOF_TRAINING` and `SPOOF_EVALUATION` roles;
4. excludes `FINAL_OOD` from development and baseline fitting; and
5. requires both classes in training and every reported evaluation split.

Missing, single-class, insufficient-quality, corrupt, unlicensed, or leakage-invalid input produces
a stable blocked result with no `metrics` field. Runtime call audio and enrollment audio are not
accepted as baseline data.

## Reproducible transform and learner

The baseline consumes only Phase L windows whose quality readiness is `SUFFICIENT`. The shared
training adapter supplies read-only 16 kHz mono float32 samples and the exact hashed preprocessing
version.

`phase-m-spectral-v1` uses deterministic 25 ms Hann windows, 10 ms hop, 512-point real FFT, and 20
uniform index bands. It records mean and standard deviation of log band energy plus spectral
centroid, log frame energy, and zero-crossing summaries. These parameters are an engineering
baseline definition, not an assertion that they are optimal or model-compatible.

`phase-m-logistic-v1` standardizes features using training statistics only and fits a deterministic
L2-regularized binary logistic objective. Its seed, iterations, learning rate, regularization, and
decision threshold are serialized. The public output is an uncalibrated decision function named as
a raw score; there is deliberately no `predict_proba` interface.

Tests use generated in-memory sinusoid/noise arrays containing no human speech. Those tests prove
determinism, bounds, class/leakage rejection, and result-schema behavior only. Their scores and
metrics are not written to a report and are not scientific evidence.

## Result schema

[`result_schema.py`](../../ml/evaluation/result_schema.py) records:

- immutable result-schema and run IDs;
- status and explicit claim status;
- data version, manifest and source-register SHA-256 values;
- split-policy and preprocessing versions;
- seed, complete feature and optimizer parameters;
- Python, NumPy, operating-system release, and machine architecture without hostname or private
  paths;
- manifest/window counts; and
- measured validation/test precision, recall, F1, EER, threshold, and confusion counts only when a
  governed run completes.

A blocked result is schema-invalid if it contains metrics. A completed result remains
`MEASURED_GOVERNED_BASELINE_NOT_PROMOTED`; Phase O must freeze an evaluation protocol before any
metric becomes project evidence.

## Native commands

From `ml/`, confirm the honest blocked path:

```powershell
.\.venv\Scripts\python.exe -m baselines.run_baseline
```

The command exits `2`, emits `BLOCKED_VALIDATION_REQUIRED`, names the missing manifest/data root,
and omits metrics. Once a data steward provides an approved external data version:

```powershell
.\.venv\Scripts\python.exe -m baselines.run_baseline `
  --manifest D:\swar-governed-data\manifests\approved-version.jsonl `
  --data-root D:\swar-governed-data
```

Generated reports remain outside Git unless a later phase defines a reviewed aggregate-result
location. Reports contain no raw audio, feature arrays, embeddings, transcript, personal name,
credential, or private path.

## Phase O handoff and validation required

- Acquire and approve a locally available data version with data-steward, storage, retention,
  deletion, license, checksum, and manifest evidence.
- Run the baseline only after the Phase K promotion gate and preserve the emitted record unchanged.
- Freeze Phase O metric definitions, threshold-selection rules, slices, final-OOD handling, and
  promotion criteria before interpreting results.
- Evaluate known/unseen generators, declared channel recipes, languages, calibration, and target
  hardware separately. Phase M proves none of those outcomes.
