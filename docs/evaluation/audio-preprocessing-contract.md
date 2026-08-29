# SWAR Audio Preprocessing Contract

Status: Phase L frozen contract, version 1.0.0

Configuration: [`ml/config/audio.yaml`](../../ml/config/audio.yaml)

Requirements: FR-QUAL-001, FR-QUAL-002, FR-QUAL-003, FR-QUAL-004, NFR-REL-001, NFR-PRIV-002, MLR-GOV-002, MLR-SAFE-001

## Purpose and ownership

This contract defines deterministic audio decoding, canonicalization, rolling windows, speech sufficiency, quality evidence, and offline degradation transformations. The ML service owns this technical pipeline. It does not authenticate callers, decide the expected enterprise identity, assign a business risk state, choose an intervention, or infer authenticity from signal quality.

The same Python core is called by runtime and offline adapters:

- `app.audio.AudioPreprocessor` is the in-memory runtime entry point;
- `training.preprocessing.TrainingPreprocessor` decodes a governed file and delegates to that same core; and
- `evaluation.telephony_degradation` creates versioned evaluation variants before the same preprocessing core is applied.

No Phase L component implements ECAPA-TDNN, RawNet2, AASIST, model scores, calibration, or risk policy.

## Version and dependency evidence

`audio.yaml` uses JSON syntax, which is valid YAML 1.2. Its raw bytes are SHA-256 hashed at load time. Every prepared window carries `<config_version>+sha256:<content hash>` as `preprocessing_version`. A configuration byte change therefore creates a different preprocessing identity even if a human-readable label is accidentally reused.

The following native Python packages were checked against their official project records on 2026-08-29 before pinning:

| Package | Pin | Compatibility and purpose | License evidence |
|---|---:|---|---|
| [NumPy](https://pypi.org/project/numpy/2.4.6/) | 2.4.6 | Python 3.11+, canonical arrays and deterministic signal measurements | BSD-3-Clause and bundled-component expressions published by PyPI |
| [SoundFile](https://pypi.org/project/soundfile/) | 0.14.0 | Python 3.10+, bounded offline WAV/FLAC decoding through libsndfile | BSD-3-Clause published by PyPI |
| [Python-SoXR](https://pypi.org/project/soxr/) | 1.1.0 | Python 3.9+, one-shot and streaming-capable sample-rate conversion | LGPL-2.1-or-later published by PyPI |

These packages are installed natively in `ml/.venv`; no container is required. The LGPL dependency and redistribution method require review again before a production binary is distributed. Phase L records dependency facts, not legal approval.

## Accepted runtime envelope

Runtime callers must provide a `PcmEnvelope` with all media facts explicitly declared:

| Field | Accepted value |
|---|---|
| `payload` | Bounded bytes, bytearray, or memoryview containing interleaved PCM; never logged |
| `sample_rate_hz` | 8000, 16000, 24000, 32000, 44100, or 48000 |
| `channels` | One or two |
| `sample_format` | `PCM_S16LE` or `PCM_F32LE` |
| `samples_per_channel` | Optional declared count; when supplied it must exactly match byte length |
| `source_sequence` | Optional monotonic source-frame sequence used to detect gaps |

Big-endian PCM, unsigned PCM, compressed bytes, empty input, non-finite float samples, unaligned bytes, unsupported rates/channels, and mismatched declared lengths fail explicitly. The default runtime envelope is bounded to 1,000 ms and 384,000 bytes, enough for one second of 48 kHz stereo float32. These are memory-safety bounds, not latency or scientific-performance claims.

LiveKit's Python [`AudioFrame`](https://docs.livekit.io/reference/python/livekit/rtc/audio_frame.html) exposes interleaved signed 16-bit samples with explicit sample rate, channel count, and samples per channel. Phase P must copy those facts into this envelope; it may not assume that the received frame is already 16 kHz mono. Phase P must also configure a bounded [`AudioStream`](https://docs.livekit.io/reference/python/livekit/rtc/audio_stream.html) capacity rather than accept an unbounded default queue.

Stable pipeline errors are intentionally separate from insufficient-quality reasons:

| Error code | Boundary failure |
|---|---|
| `EMPTY_AUDIO` | Empty runtime payload, decoded array, or file |
| `PAYLOAD_TOO_LARGE` | Encoded, decoded, frame-duration, or buffer safety bound exceeded |
| `INVALID_PCM_LENGTH` | Bytes do not align to declared sample width and channel count |
| `DECLARED_LENGTH_MISMATCH` | `samples_per_channel` disagrees with byte length |
| `UNSUPPORTED_FORMAT` | Runtime sample representation is not accepted PCM |
| `UNSUPPORTED_ENDIAN` | Big-endian PCM was supplied |
| `UNSUPPORTED_SAMPLE_RATE` | Rate is outside the explicit allowlist |
| `UNSUPPORTED_CHANNELS` | Channel count is outside the explicit allowlist |
| `NON_FINITE_SAMPLE` | Float input contains NaN or infinity |
| `AUDIO_DECODE_FAILED` | File cannot be opened or decoded safely |
| `UNSUPPORTED_FILE_CONTAINER` | Decoded container is not approved |
| `UNSUPPORTED_FILE_SUBTYPE` | Decoded encoding/subtype is not approved |
| `INVALID_CANONICAL_AUDIO` | Internal/public canonical invariants fail |
| `MEDIA_FORMAT_CHANGED` | Rate, channel count, or sample format changes within one runtime session |
| `BUFFER_LIMIT_EXCEEDED` | A rolling input or retained buffer would exceed its bound |
| `PIPELINE_CLOSED` | A caller attempts to reuse a terminated session pipeline |
| `INVALID_AUDIO_CONFIG` | Serialized configuration is missing, malformed, or violates invariants |

## Accepted governed-file envelope

The offline adapter accepts only files already approved by the Phase K manifest and storage gate. Phase L decoding currently supports:

- WAV with `PCM_16` subtype; and
- FLAC with `PCM_16` subtype.

The file itself and its decoded float32 representation are bounded by the configured 256 MiB safety limit. Unsupported container/subtype, corrupt headers, unavailable files, invalid media metadata, or decompressed-size excess fail with stable non-sensitive errors. This adapter reads input for training/evaluation; the runtime adapter has no file-decoding or file-writing path.

Supporting another file subtype requires a reviewed configuration/version change and parity tests. A Phase K manifest claiming a codec does not silently authorize an unsupported Phase L decoder.

## Canonical representation

Every accepted input becomes:

- sample rate: exactly 16,000 Hz;
- channel layout: exactly one channel;
- dtype: NumPy `float32`;
- amplitude range: `[-1.0, 1.0]` inclusive; and
- memory layout: contiguous, read-only arrays at public boundaries.

Signed 16-bit PCM is divided by 32768.0, so -32768 maps exactly to -1.0 and +32767 remains below +1.0. Stereo is reduced by arithmetic mean. Float input outside the range is clipped and the number of out-of-range source samples is retained as quality evidence. NaN and infinity are rejected. There is no automatic gain control, peak normalization, silence filling, denoising, or authenticity-related transformation.

Non-16-kHz inputs use SoXR `HQ` conversion. Runtime uses one stateful resampler per media session; offline conversion uses the same streaming primitive and final flush. Tests prove that 48 kHz input split into one-second runtime chunks is sample-identical to the same decoded input supplied offline as one array. The configured library and quality label are part of the serialized preprocessing contract. Actual resampler/model effects remain subject to Phase O evaluation.

## Rolling-window contract

The default engineering setting is a 4,000 ms window and a 1,000 ms stride at 16 kHz:

- window size: exactly 64,000 samples;
- stride: exactly 16,000 samples;
- maximum per-session rolling buffer: 128,000 samples; and
- window sequence: integer starting at 1 and increasing in emission order.

`start_sample` and `end_sample` are the canonical timeline authority. Millisecond offsets are derived from those integers; no wall-clock rounding determines window membership. With five contiguous seconds, the emitted ranges are exactly `[0, 4000)` and `[1000, 5000)` ms.

A source-sequence jump, reconnect, overlap, or sample-position gap clears both residual window state and resampler delay before more audio is accumulated. No output window may cross that discontinuity. Canonical timeline offsets account for the consumed pre-gap media and a deterministically inferable fixed-frame packet gap instead of mistaking resampler delay for missing audio. The first full post-discontinuity window carries `DISCONTINUITY`; a known missing interval or source packet jump also carries `PACKET_GAP`. Phase P must supply authoritative media timestamps where packet duration is not inferable from fixed frame sizes.

On normal end, the buffer emits at most one final partial window only when audio exists beyond the last complete window. It never pads that partial input. Partial windows carry `PARTIAL_WINDOW` and cannot be sent to a model as sufficient evidence. `finish()` and `clear()` zero and release the transient array and permanently close that session buffer.

## Speech sufficiency and quality evidence

Phase L uses a deterministic energy-frame speech sufficiency heuristic. It is not a trained VAD, speaker model, spoof detector, probability, or proof of human presence. It records actual speech milliseconds from 20 ms frames at the configured dBFS threshold.

Quality evidence includes:

- actual and total duration;
- RMS dBFS;
- clipped-sample ratio;
- silence ratio;
- a spectral-flatness noise proxy;
- continuity/gap facts; and
- a bounded deterministic `quality_score` heuristic.

`quality_score` summarizes coverage, measured speech ratio, level, clipping, spectral flatness, and continuity. It is not calibrated and must not be presented as model confidence or a universal quality threshold. All current thresholds are engineering defaults under `VALIDATION REQUIRED`.

The stable insufficient-evidence reason codes are:

| Reason | Observable condition |
|---|---|
| `PARTIAL_WINDOW` | Window contains less than the scheduled 4,000 ms because the stream ended |
| `INSUFFICIENT_SPEECH` | Measured speech is below the configured minimum |
| `EXCESSIVE_SILENCE` | Measured silence ratio meets/exceeds the configured bound |
| `CLIPPING` | Clipped-sample ratio meets/exceeds the configured bound |
| `LOW_LEVEL` | Whole-window RMS dBFS is at/below the configured bound |
| `NOISE_PROXY_HIGH` | Active-frame spectral flatness meets/exceeds the configured bound |
| `DISCONTINUITY` | The preceding buffered segment was cleared after a timeline/reconnect discontinuity |
| `PACKET_GAP` | Source sequence or timeline indicates missing media |

Any reason produces `INSUFFICIENT_EVIDENCE`; Phase L does not force a model score. Several reasons may coexist so the backend receives observable causes rather than a generic failure. Quality alone must never produce `VERIFIED`, `HIGH_RISK`, or `CRITICAL`.

Malformed inputs produce a `PIPELINE_ERROR` candidate with one stable `AudioErrorCode`; they do not become spoof evidence. Error strings contain neither bytes, filesystem paths, call content, participant identity, nor private metadata.

## Training, evaluation, and runtime parity

Training/evaluation and runtime share the `PcmNormalizer`, `RollingWindowBuffer`, `EnergyVad`, and `QualityEvaluator` implementations and the same hashed configuration. The offline adapter adds governed file decoding only. Tests compare exact samples, timing, readiness, reasons, and version across adapters.

No model adapter may silently:

- pad a partial or inadequate window;
- crop around a quality failure to manufacture sufficiency;
- peak-normalize a weak signal;
- substitute a different sample rate, channel policy, VAD, or threshold; or
- accept an unsupported file because a training library happens to decode it.

Future ECAPA-TDNN, RawNet2, and AASIST adapters must document any model-specific feature transform after this shared canonical boundary. A model-specific transform belongs to that adapter and checkpoint contract; it cannot mutate this frozen Phase L definition without a new version.

## Telephony-like evaluation recipes

`evaluation.telephony_degradation` provides deterministic in-memory variants with recipe name, recipe version, seed, and ordered parameter lineage:

| Recipe | Transformation | Claim boundary |
|---|---|---|
| `narrowband_mulaw_proxy` | 16 kHz to 8 kHz, analytic mu-law compand/8-bit quantization proxy, then 16 kHz | Codec-like evaluation proxy, not a bitstream or every-carrier simulation |
| `narrowband_noise_proxy` | 8 kHz round trip plus seeded white noise at a requested engineering SNR | Controlled noise slice, not a field-noise distribution claim |
| `clipped_channel_proxy` | Deterministic gain and hard clipping | Clipping stress case only |

Recipes neither overwrite governed source files nor write derived audio by themselves. A later evaluation that persists variants outside Git must create Phase K-compatible parent/child lineage, hashes, retention, and deletion evidence. Results across these recipes are measured in Phase O; Phase L records no detector accuracy or robustness result.

## Security and privacy invariants

- Runtime PCM, windows, and quality arrays remain in process memory only.
- Public arrays are read-only and rolling buffers are bounded.
- Buffers are zeroed and released on finish, clear, discontinuity, overflow error, or session termination.
- No runtime method writes audio to disk.
- Error messages and logs must contain no audio, waveform excerpt, path, caller identity, or private call content.
- Phase P remains responsible for authorized call/participant/track binding before it passes frames into this pipeline.
- Phase K remains responsible for consent/license/provenance and for external governed storage.
- Raw audio persistence remains prohibited by default.

## Verification map

| Gate | Evidence |
|---|---|
| Golden normalization and decoding | `ml/tests/unit/audio/test_pcm_normalizer.py` |
| Exact sizes, stride, order, gap reset, final partial, and cleanup | `ml/tests/unit/audio/test_rolling_window.py` |
| Silence, short speech, clipping, low level, noise proxy, and gaps | `ml/tests/unit/audio/test_vad_quality.py` |
| Training/runtime exact parity and runtime no-write guard | `ml/tests/unit/audio/test_pipeline_parity.py` |
| Deterministic degradation and lineage | `ml/tests/unit/audio/test_telephony_degradation.py` |
| Serialized configuration validation | `ml/tests/unit/audio/test_config.py` |

## VALIDATION REQUIRED

- Validate the 4-second/1-second setting and every VAD/quality threshold against governed development data, frozen OOD slices, and the declared target hardware; Phase L provides engineering defaults only.
- Measure preprocessing latency, memory, queue coverage, insufficient-evidence rate, and time-to-first-intervention in Phases O, P, and Y.
- Verify model-specific waveform/feature expectations and checkpoint licenses in Phase N before adding adapter transforms.
- Validate codec/noise robustness in Phase O; the three recipes do not establish deployment coverage or multilingual performance.
- Review native LGPL redistribution obligations before production distribution.
