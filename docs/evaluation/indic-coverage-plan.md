# SWAR Indic Coverage Evidence Plan

Status: Phase K gap register
Date: 2026-08-29
Requirement: MLR-LANG-001

Language availability is not detector support. SWAR may claim a language or accent slice only after exact licensed manifests, sample sufficiency, label/lineage review, speaker/generator-disjoint partitions, and per-language Phase O results exist.

| Proposed slice | Bona fide candidate evidence | Spoof candidate evidence | Phase K status | Claim allowed now |
|---|---|---|---|---|
| English | LibriSpeech SLR12; ASVspoof bona fide partitions | WaveFake; ASVspoof LA/DF | Source records exist; only WaveFake has a narrow approved local role. Speaker-purpose, exact subsets, and split mapping remain open. | None. |
| Indian English | IndieFake provider project site/preprint | IndieFake provider project site/preprint | Access agreement, complete license artifact, consent basis, archive hashes, speakers, and generator families are `VALIDATION REQUIRED`. | None. |
| Hindi (`hi`) | IndicVoices-R candidate | IndicSynth candidate | Exact archives, inherited terms/consent, enhancement lineage, speaker groups, generator families, and sample sufficiency are `VALIDATION REQUIRED`. | None. |
| Kannada (`kn`) | IndicVoices-R candidate | IndicSynth candidate | Exact archives, inherited terms/consent, enhancement lineage, speaker groups, generator families, and sample sufficiency are `VALIDATION REQUIRED`. | None. |
| Other Indic languages | IndicVoices-R declares broader language availability | IndicSynth declares twelve languages | This is only a candidate inventory. Language-specific manifests and results do not exist. | None. |

## Required per-language evidence

Before a slice is promoted, record:

1. exact BCP-47 label authority and any dialect/accent metadata authority;
2. source/version/license/consent or provider reuse basis and redistribution limits;
3. speaker count, sample count, duration distribution, capture/channel distribution, and class balance from the governed manifest;
4. speaker/group and generator-family leakage results;
5. known and final-OOD generator coverage;
6. clean versus declared codec/noise/degradation coverage using versioned lineage; and
7. Phase O metrics with uncertainty and failure/abstention counts.

Counts and performance values are intentionally absent because no audio has been acquired or evaluated. No filename, location, name, or model output may be used to infer a language or accent label.

## Gap handling

If a slice lacks licensed bona fide and spoof data with compatible label authority, report the gap. Do not fill it with runtime call/enrollment audio, translate English results, pool unrelated languages, or make “multilingual,” “Hindi,” “Kannada,” “Indian accent,” or broader Indic performance claims.
