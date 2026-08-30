# SWAR Phase O Evaluation and Promotion Gates

Status: `FROZEN FRAMEWORK - EXECUTION BLOCKED`

Gate version: `swar-phase-o-promotion-gates-v1`

## Gate order

Every gate is fail-closed and runs in order. Passing software tests is necessary but cannot replace
scientific evidence.

1. **Governance gate** - exact sources, licenses/purpose, acquisition receipts, data steward,
   retention/deletion execution, external root, and a non-example frozen manifest are approved.
2. **Leakage gate** - source hashes, near duplicates, speakers, lineages, enrollment/test trials,
   calibration use, and complete final-OOD generator families are disjoint under the frozen policy.
3. **Version gate** - every score matches one manifest hash, Phase N registry/checkpoint hashes,
   Phase L preprocessing version, score name, score direction, model version, and declared split.
4. **Coverage gate** - speaker, spoof, test, complete final OOD, declared degradation, available
   language/accent/channel slices, failed samples, and insufficient samples have explicit counts.
5. **Calibration gate** - parameters and any operating points use `VALIDATION` only; reliability is
   evaluated on untouched holdout/OOD data and score direction is verified.
6. **Evaluation gate** - speaker FAR/FRR/EER and spoof precision/recall/F1/EER are reported with
   class/threshold/count definitions; OOD and robustness remain separate from clean/seen results.
7. **Latency/resource gate** - named hardware/runtime/concurrency reports cold/warm stage
   distributions, queue and memory. Phase O model latency cannot claim end-to-end intervention.
8. **Safety/review gate** - failures, weak slices, clone similarity, unseen generators, channel
   degradation, disagreement, and calibration limitations are reviewed; the decision is explicitly
   `PROMOTED`, `NOT_PROMOTED`, or `BLOCKED`.

## No invented numeric pass line

The repository has no evidence-backed universal FAR, FRR, EER, F1, calibration, latency, memory, or
slice threshold. Phase O must report measured values and an authorized risk/usability decision. If
the project cannot justify a numeric gate, the promotion remains `VALIDATION REQUIRED`; a convenient
number must not be inserted.

The only current machine-readable state is
[`calibration.json`](../../ml/config/calibration.json): `BLOCKED_VALIDATION_REQUIRED`, no operating
points, no calibration package version, and no promoted manifest. Production serving must reject
that state.

## Stable blocker codes

| Code | Meaning | Minimum resolution |
|---|---|---|
| `GOVERNED_DATA_ROOT_NOT_PROVIDED` | No approved external audio/data root was supplied. | Data steward supplies and approves the external root. |
| `GOVERNED_MANIFEST_NOT_PROVIDED` | No real frozen manifest was supplied. | Freeze a non-example Phase K-valid manifest. |
| `DATA_STEWARD_APPROVAL_NOT_PROVIDED` | Purpose/license/retention ownership is unresolved. | Record authorized approval outside sensitive repository data. |
| `MEASURED_SCORE_RECORDS_NOT_PROVIDED` | Exact-version model evaluation has not run. | Run the promoted Phase N adapters over governed splits. |
| `CALIBRATION_PACKAGE_NOT_PROVIDED` | No validation-only parameters/operating points exist. | Fit on `VALIDATION`, serialize provenance, and review. |
| `FINAL_OOD_SCORE_RECORDS_NOT_PROVIDED` | Untouched complete held-out generators were not evaluated. | Run once after decisions freeze; do not tune on results. |
| `ROBUSTNESS_SCORE_RECORDS_NOT_PROVIDED` | Clean/degraded paired evaluation is absent. | Run every declared versioned recipe with lineage. |
| `TARGET_HARDWARE_PROFILE_NOT_APPROVED` | Deployment benchmark target is unnamed. | Approve exact hardware/runtime/concurrency profile. |
| `LATENCY_OBSERVATIONS_NOT_PROVIDED` | No distribution observations exist. | Record stage timestamps/memory without content. |

## Unlock rule

Phase O passes only after all required artifacts are measured, reviewed, versioned, reproducible,
documented, and marked `PROMOTED` or an explicitly authorized limited profile. Until then Phase P
and Phase Q remain locked and Phase R is forbidden.
