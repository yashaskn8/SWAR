# SWAR ML Data Governance

Status: FROZEN - Phase K
Date: 2026-08-29
Requirements: MLR-GOV-001, MLR-ID-001, MLR-SPOOF-001, MLR-OOD-001, MLR-ROB-001, MLR-LANG-001, NFR-PRIV-001, NFR-PRIV-002

## 1. Boundary and classification

Phase K governs research data; it does not implement audio preprocessing, training, evaluation results, model integration, or runtime collection. Voice audio, speaker identifiers, and voice-derived metadata are sensitive biometric-like data. Git stores only source/license records, schema, fictional examples, policies, and code/tests.

Runtime call audio and enrollment samples are purpose-bound operational data. They are never automatically reusable as research/training/evaluation data. Reuse would require a separately approved collection protocol, explicit purpose/version consent, withdrawal/deletion procedure, security/ethics review, and a new governed source/version. Production audio is not a convenient fallback dataset.

## 2. Roles and approvals

| Role | Responsibility | Required approval evidence |
|---|---|---|
| Data steward | Maintains source/version, access control, storage, retention, deletion, and incident records. | Named owner outside public manifests; review date and decision in the source register. |
| License reviewer | Reviews dataset terms and inherited source/generator obligations. | Official links or immutable copies, license identifier, permitted use, redistribution, and blockers. |
| Manifest owner | Maps provider metadata to the schema without inventing missing labels. | Reproducible adapter/version, acquisition receipt, sample hashes, and mapping review. |
| Split owner | Freezes speaker/group/generator partitions before experiments. | Split-policy version and passing duplicate/leakage report. |
| Evaluation owner | Uses only approved data roles and reports gaps/slices. | Frozen manifest hashes and later Phase O protocol/results. |
| Security/privacy reviewer | Confirms sensitive storage, least privilege, retention, deletion, and non-logging. | Storage review and deletion/access evidence. |

No single approval substitutes for all others. License permission does not prove consent, label quality, representativeness, scientific suitability, or production legal approval.

## 3. Candidate source review

The machine-readable [source register](../../ml/data/manifests/source-register.yaml) is authoritative for adoption status. The official evidence reviewed for Phase K includes:

- ASVspoof's official [2021 release page](https://www.asvspoof.org/index2021.html), which describes LA/PA/DF roles and the stated Open Data Commons Attribution license;
- the University of Edinburgh [ASVspoof 2019 record](https://doi.org/10.7488/ds/2555), whose separate usage agreement still requires project review;
- the author-published [WaveFake 1.2.0 record](https://doi.org/10.5281/zenodo.5642694), including its datasheet, CC-BY-SA-4.0 statement, and provider archive checksum;
- the official [LibriSpeech SLR12 record](https://www.openslr.org/12/) and its CC-BY-4.0 statement;
- the AI4Bharat [IndicVoices-R repository](https://github.com/AI4Bharat/IndicVoices-R), including its CC-BY-4.0 license and speech-enhancement lineage description;
- the [IndicSynth ACL publication](https://aclanthology.org/2025.acl-long.1070/) and author-linked [dataset card](https://huggingface.co/datasets/vdivyasharma/IndicSynth), which states CC-BY-NC-4.0; and
- the author [IndieFake project site](https://indie-fake-dataset.netlify.app/) and access workflow, whose complete delivered terms and consent evidence remain `VALIDATION REQUIRED`.

Only WaveFake 1.2.0 is currently approved for the narrowly recorded local research roles and verifiable manual archive import. This is an engineering governance decision, not a quality endorsement. Other candidates remain reference-only until every listed blocker closes. No source has been downloaded or committed by Phase K.

## 4. Acquisition and versioning

Acquisition is explicit and fail-closed:

1. The source and intended role must be approved in the register.
2. A person obtains the archive through the official access path and acknowledges the exact terms.
3. The native Python importer matches the registered filename and provider checksum.
4. The importer copies only to an external governed root, computes SHA-256, and writes an idempotent receipt; it does not extract content or call a network service.
5. A dataset-specific adapter later maps provider metadata into JSONL and records its own code/version. Missing labels remain unknown and block any role that needs them.
6. Validation checks each file and manifest; duplicate/leakage checks must pass before the data version is frozen.

A data version identifier is immutable. Any sample, label, lineage, license, split, or adapter change creates a new version. The exact manifest file SHA-256, source-register SHA-256, acquisition receipt SHA-256 values, and adapter revision become the later experiment input record.

## 5. Label and lineage rules

- `BONAFIDE` means the provider-authorized label for non-spoof speech in that source. It does not mean authenticated, safe, live, or suitable for every speaker task.
- `SPOOF` requires an attack type and stable generator/replay family plus version. Unknown family/version blocks final-OOD claims.
- TTS, voice conversion, replay, and mixed attacks remain distinct where provider evidence supports the distinction.
- Synthetic or degraded descendants retain all parent sample IDs and one lineage root. They never receive a new split independently of that root.
- Capture, codec, and degradation steps are ordered, versioned lineage. Source-provided channel effects must not be relabeled as SWAR transformations.
- Language and accent are `KNOWN` only when supported by provider metadata. Geography, speaker name, or filename is not a valid inferred accent label.
- The manifest stores no transcript or personal name because neither is required for the Phase K gate.

## 6. Quality and integrity gate

The validator rejects missing/corrupt files, unsafe paths, invalid or conflicting labels, unresolved source/license status, checksum/size mismatch, unsupported container/codec declarations, and header disagreement for duration, sample rate, channels, or frames. It validates WAV and FLAC headers only; it does not normalize signals or establish model compatibility.

The leakage check rejects exact duplicates, repeated provider/adaptor near-duplicate identities, speaker-group leakage, lineage-root leakage, conflicting duplicate labels, spoof rows without parent lineage, and final-OOD generator families outside `FINAL_OOD`. A pass means the declared metadata satisfies the frozen checks; it does not prove there are no undiscovered duplicates or annotation errors.

## 7. Retention, access, and deletion

- Use least-privilege access to the external governed data root; do not serve it from the application or frontend.
- Retain only sources required by an approved active experiment and the source terms.
- Record deletion by source/data version and verify that archives, extracted samples, derived artifacts, and caches are removed from approved locations.
- Revoke access promptly when terms, consent, purpose, staff role, or project status changes.
- Logs may contain source/data/sample IDs, hashes, counts, status, and reason codes, but no audio, transcript, personal name, access credential, or private path.
- Results may report aggregates and declared slices only after Phase O; Phase K records no metrics.

## 8. Open validation

The source register contains the per-source blockers. In addition, the project still requires an approved data steward, external governed storage location, retention duration, deletion evidence, dataset-specific metadata adapters, finalized generator-family taxonomy, and an ethics/legal review for any human-voice corpus used for biometric-like evaluation. These are `VALIDATION REQUIRED`, not silent approvals.
