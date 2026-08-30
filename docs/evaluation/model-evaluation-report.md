# SWAR Phase O Model Evaluation Report

Status: `BLOCKED - VALIDATION REQUIRED`

Report version: `phase-o-evaluation-report-v1`

Evaluation date: not run

Requirements: MLR-GOV-001, MLR-GOV-002, MLR-ID-001, MLR-SPOOF-001,
MLR-CAL-001, MLR-OOD-001, MLR-ROB-001, MLR-LANG-001, MLR-LAT-001

## Decision

No model, calibration, threshold, robustness claim, OOD claim, language claim, latency target, or
serving profile is promoted. Phase O cannot pass because the repository has no approved external
governed data root, non-example frozen manifest, data-steward approval record, or approved target
hardware profile. The only committed sample manifest is explicitly fictional schema documentation
and is prohibited from scientific use.

The machine-readable [`calibration.json`](../../ml/config/calibration.json) therefore has status
`BLOCKED_VALIDATION_REQUIRED`, contains no manifest hash, calibrator, fusion weight, probability,
operating threshold, or promotion decision, and cannot authorize Phase P or Phase Q.

## Scientific exit criteria

- [ ] Scientific speaker/spoof/OOD/robustness/latency metrics are measured from approved,
  traceable governed data.
- [ ] Calibration and operating points are fitted on approved validation evidence and verified on
  untouched holdout/OOD evidence.
- [ ] Model/calibration promotion approval is recorded by the authorized reviewers.

These final three criteria are intentionally unchecked. Phase P engineering may exercise only
explicit fixture or shadow paths while this scientific gate remains blocked; it is not a production
promotion decision.

## Implemented fail-closed framework

- Speaker verification metrics record FAR, FRR, and EER with explicit genuine/impostor semantics,
  the decision threshold, counts, and Wilson intervals for rates.
- Spoof metrics record precision, recall, F1, and EER with explicit spoof-positive semantics and
  support Phase N's higher-is-more-bona-fide RawNet2/AASIST logits without relabelling them as
  probabilities.
- Calibration metrics record Brier score and expected calibration error only for bounded
  probability inputs. Platt calibration and RawNet2/AASIST fusion can fit only on `VALIDATION` and
  serialize content-derived versions with manifest, registry, preprocessing, model, checkpoint,
  score, class, and method provenance.
- The evaluation split gate repeats Phase K speaker, lineage, source, and final-generator checks and
  rejects calibration outside `VALIDATION` or use of `FINAL_OOD` for calibration.
- Clean/seen, final unseen-generator, and codec/noise/degradation runners produce separate aggregate
  records. Failed and insufficient samples remain in reason-code counts instead of disappearing
  from denominators.
- The latency runner requires a named hardware/runtime profile and keeps cold/warm stage
  distributions and memory observations separate. It does not equate configured audio accumulation
  with measured inference or end-to-end intervention latency.

Generated numeric arrays in unit tests prove only metric definitions, score-direction handling,
determinism, serialization, blocking, and absence of NaN/zero-denominator crashes. They are not
voice data, detector results, thresholds, or project performance evidence.

## Required scientific execution

An authorized data steward must provide all of the following outside Git before rerunning Phase O:

1. an approved external governed data root with acquisition receipts, executed retention/deletion
   controls, and purpose/license acknowledgements;
2. a non-example manifest with exact source and sample hashes, speaker groups, lineage roots,
   known-generator mappings, complete held-out generator families, declared language/accent status,
   and a frozen split-policy hash;
3. score records from the exact Phase N registry and Phase L preprocessing version, including every
   failed or insufficient sample and no source audio or personal metadata in reports;
4. validation-only calibrator and operating-point selection with an untouched `TEST` and
   `FINAL_OOD` evaluation; and
5. a named target hardware/runtime/concurrency profile for cold/warm preprocessing, ECAPA, RawNet2,
   AASIST, fusion, queue, memory, and later end-to-end measurements.

The scientific run must report speaker FAR/FRR/EER; spoof precision/recall/F1/EER; calibration
reliability; known versus complete unseen-generator results; clean versus each versioned
degradation; every supported metadata slice with counts and gaps; model failures/timeouts; and
named-hardware latency distributions. Final OOD results may not change a calibrator, operating
point, model choice, slice definition, or promotion gate.

## Current evidence table

| Required evidence | Current state | Claim allowed |
|---|---|---|
| Speaker-disjoint FAR/FRR/EER | Not run - governed identity trials unavailable | None |
| Spoof precision/recall/F1/EER | Not run - governed bona-fide/spoof trials unavailable | None |
| Validation-only calibration/fusion | Not fit - validation scores unavailable | No probability or threshold |
| Complete unseen-generator OOD | Not run - final family manifest unavailable | None |
| Codec/noise/resampling/quality robustness | Recipes exist; governed comparisons not run | Recipe behavior only |
| Language/accent slices | Metadata/data sufficiency unresolved | No coverage or performance claim |
| Target-hardware latency/memory | Compatibility observations are not Phase O distributions | No target or SLA |
| Model promotion | Blocked | Phase P and Q locked |

## Privacy and integrity

The framework reads governed artifacts supplied at execution time and writes aggregate JSON only
when explicitly requested. It does not commit or persist audio, embeddings, feature arrays, raw
scores, speaker identities, private paths, credentials, or source-level sample metadata. A failed or
insufficient sample contributes an aggregate reason code. The final OOD partition remains untouched
until all model/calibration decisions are frozen.
