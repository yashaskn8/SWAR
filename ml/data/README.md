# SWAR Governed Data Workspace

Status: Phase K contract, version 1.0.0
Requirements: MLR-GOV-001, MLR-ID-001, MLR-SPOOF-001, MLR-OOD-001, MLR-ROB-001, MLR-LANG-001, NFR-PRIV-001, NFR-PRIV-002

This directory contains governance metadata only. Dataset archives, extracted audio, derived audio, caches, private recordings, and runtime enrollment samples must remain outside the repository. Voice recordings and speaker-linked metadata are sensitive biometric-like data even when a source publishes them openly.

## Authoritative artifacts

- [`manifests/schema.json`](manifests/schema.json) defines one JSONL sample record.
- [`manifests/source-register.yaml`](manifests/source-register.yaml) records official sources, versions, provenance, license review, adoption status, blockers, and acquisition controls. It uses JSON syntax, which is valid YAML 1.2, so the Phase K tooling needs no YAML dependency.
- [`manifests/data-version.example.jsonl`](manifests/data-version.example.jsonl) is schema documentation only. Its identifiers, hashes, labels, and path are explicitly fictional; it references no audio.
- [`licenses/README.md`](licenses/README.md) defines the license review and approval gate.
- [Data governance](../../docs/evaluation/data-governance.md), [OOD split policy](../../docs/evaluation/ood-split-policy.md), and [Indic coverage plan](../../docs/evaluation/indic-coverage-plan.md) define promotion and evaluation rules.

The source register authorizes only entries with `license.status` equal to `VERIFIED_OFFICIAL` and `adoption.status` equal to `APPROVED_FOR_LOCAL_RESEARCH`. A source named in a report, paper, website, or model repository is not automatically approved.

## Safe acquisition workflow

The acquisition command performs no network download and extracts no content. It imports only a registered archive already obtained through the provider's authorized process. It verifies the provider checksum, computes SHA-256, copies outside the Git repository, and creates an idempotent receipt.

```powershell
Set-Location ml
.\.venv\Scripts\python.exe scripts\acquire_dataset.py `
  wavefake-1.2.0 C:\governed-downloads\generated_audio.zip D:\swar-governed-data `
  --source-register data\manifests\source-register.yaml `
  --acknowledge-license CC-BY-SA-4.0
```

The command fails if the source or license is unverified, the archive is not registered, the checksum differs, acknowledgement is absent, a prior receipt conflicts, or the destination is inside the repository. An unchanged repeat returns `IDEMPOTENT_REPLAY`.

Provider MD5 values are used only where that is the checksum published for the immutable provider archive. Each successful local import additionally records SHA-256; a promoted manifest must reference the acquisition receipt SHA-256 and each sample's SHA-256.

## Manifest validation

Manifests are JSONL so a data version is diffable without putting media in Git. Validation covers source/license approval, required provenance, stable identifiers, labels, generator family, language/accent status, capture/codec/degradation lineage, sensitivity, deterministic split assignment, and—when file checks are enabled—existence, byte size, SHA-256, WAV/FLAC header integrity, duration, sample rate, and channel count.

```powershell
Set-Location ml
.\.venv\Scripts\python.exe scripts\validate_manifest.py `
  D:\swar-governed-data\manifests\swar-data-v1.jsonl `
  --source-register data\manifests\source-register.yaml `
  --data-root D:\swar-governed-data --check-files

.\.venv\Scripts\python.exe scripts\check_duplicates.py `
  D:\swar-governed-data\manifests\swar-data-v1.jsonl `
  --source-register data\manifests\source-register.yaml
```

The duplicate/leakage gate rejects repeated SHA-256 values, repeated provider/adapter `near_duplicate_id` values, speaker groups or lineage roots spanning splits, conflicting duplicate labels, spoof rows without parents, and final-OOD generator families appearing outside `FINAL_OOD`.

`near_duplicate_id` is an opaque provider/adaptor content identity in Phase K. It must not be fabricated from filenames. Phase L may add a versioned waveform-fingerprint implementation, but Phase K does not define signal preprocessing.

## Promotion gate

A data version is usable by later phases only when all of the following evidence is frozen:

1. exact source/version and official authority links;
2. reviewed license/terms, permitted role, redistribution obligations, and consent or provider reuse basis;
3. acquisition receipt and per-sample SHA-256;
4. provider sample, speaker/group, label authority, generator/attack, language/accent status, and lineage;
5. deterministic split and passing duplicate/leakage report;
6. a named data steward and storage/retention/deletion record outside Git; and
7. no unresolved source-level blocker relevant to the proposed role.

No Phase K artifact is a dataset, model result, multilingual claim, or permission to reuse runtime enrollment/call audio.
