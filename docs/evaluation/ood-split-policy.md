# SWAR Speaker, Lineage, and Generator Split Policy

Status: FROZEN - Phase K
Policy version: `swar-speaker-generator-split-v1`
Requirements: MLR-ID-001, MLR-CAL-001, MLR-OOD-001, MLR-ROB-001

## 1. Freeze order

The split is frozen before model training, threshold selection, calibration, or result inspection:

1. approve exact source versions and roles;
2. freeze provider sample, speaker, group, parent, lineage-root, attack, and generator-family mappings;
3. nominate complete generator families for `FINAL_OOD` using a written scientific rationale unrelated to model results;
4. assign all members of those families to `FINAL_OOD`;
5. hash-assign every remaining `split_group_id` to train, validation, or test;
6. run exact/near-duplicate, speaker, lineage, and generator leakage checks; and
7. hash and approve the final manifest.

Changing a mapping, family reservation, or sample set creates a new data and split-policy version. A failed experiment never justifies moving a difficult sample or generator to another partition.

## 2. Deterministic assignment

`split_group_id` must group everything that could leak speaker or source content, including a bona fide original and every synthetic, replayed, encoded, or degraded descendant. It must not be based only on a filename.

For non-final-OOD groups, compute:

```text
digest = SHA-256("swar-speaker-generator-split-v1" + NUL + split_group_id)
bucket = unsigned_big_endian(digest[0:8]) modulo 1000
0..799   -> TRAIN
800..899 -> VALIDATION
900..999 -> TEST
```

The 80/10/10 assignment is an engineering partition rule, not a claimed optimal ratio or metric target. All records with the same split group receive the same result.

## 3. Final unseen-generator partition

A `FINAL_OOD` family is the complete stable family across every source/version available to the frozen data version. No sample from that family, including derivatives or differently encoded copies, may occur in `TRAIN`, `VALIDATION`, or `TEST`. The family list is frozen before model development and is not disclosed to a training adapter as ordinary data.

The final OOD partition is evaluation-only. It must not be used for feature selection, model choice, hyperparameter tuning, threshold selection, calibration, early stopping, or repeated informal debugging. If final OOD results influence development, that data version is spent and a newly justified untouched family/version is required.

Provider terms such as “unknown attack” are not automatically a stable SWAR generator family. The mapping must cite provider keys/protocols and preserve aliases/version relationships. An opaque or incomplete mapping remains `VALIDATION REQUIRED` and cannot support AC-ML-008.

## 4. Leakage failures

The gate fails when:

- a SHA-256 or `near_duplicate_id` repeats;
- a speaker group or lineage root spans splits;
- identical/near-identical content has conflicting labels;
- a spoof row omits source-parent lineage;
- a declared final-OOD generator family occurs in any other split; or
- source-specific hidden identities prevent the required grouping.

Generator presence across normal train/validation/test is reported and allowed only for the known-generator evaluation design. Generator-disjoint experiments must define a new policy/version; they cannot reinterpret this policy after results.

## 5. Later evaluation handoff

Phase O must record manifest and policy hashes, known versus unseen generator results, worst declared slice, speaker-disjoint identity metrics, calibration partition, and exclusions. This policy creates partition evidence only; it reports no accuracy, EER, FAR, FRR, precision, recall, F1, robustness, or latency result.
