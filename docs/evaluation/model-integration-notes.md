# Phase N Real Model Integration Notes

Status: `IMPLEMENTED + TESTED + INTEGRATED + DOCUMENTED + VERIFIED` for adapter and
checkpoint compatibility. Scientific detector performance remains `VALIDATION REQUIRED` and is
owned by Phase O.

Registry version: `swar-phase-n-model-registry-v1`

Requirements: MLR-ID-001, MLR-SPOOF-001, MLR-SPOOF-002, MLR-GOV-001, MLR-LAT-001,
NFR-PRIV-002, NFR-SEC-003

## Contract boundary

The three adapters expose a shared lifecycle: verified load, readiness, typed inference with a
bounded timeout, versioned technical result, and cleanup. Each result contains model/version,
checkpoint hash, raw score name and direction, window sequence/time range, Phase L preprocessing
version, measured model-processing latency, and readiness. No adapter emits a probability, risk
state, intervention, legal conclusion, or database write.

ECAPA-TDNN answers only how similar a window is to an in-memory enrolled reference. A high score
does not prove liveness or physical presence and can occur for a convincing clone. RawNet2 is the
fast spoof path and AASIST the asynchronous deep path; neither overrides the other. Their pinned
provider evaluation code uses class index `1` as bona fide, so the exposed technical score is the
raw `bonafide_logit` with `HIGHER_IS_MORE_BONAFIDE` direction. Phase O must calibrate and evaluate
complementarity before a policy consumes either score.

## Frozen source and artifact register

[`model_registry.yaml`](../../ml/config/model_registry.yaml) is machine-readable and authoritative.
It pins every downloaded source/config/checkpoint by immutable provider revision, exact byte count,
SHA-256, license declaration, architecture, input contract, and score semantics.

| Model | Authority and pinned revision | Declared license | Input | Verified checkpoint SHA-256 |
|---|---|---|---|---|
| SpeechBrain ECAPA-TDNN VoxCeleb | SpeechBrain model repository `0f99f2d0ebe89ac095bcc5903c4dd8f72b367286` | Apache-2.0 in the pinned model card | mono float32, 16 kHz, 64,000 samples; 192-value embedding | `0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2` |
| RawNet2 LA clean specialist | publisher model/source repository `b21501cc1436bfc25f4d2e01fb5aee871bca3b3c` | MIT declared in the pinned model card | mono float32, 16 kHz, 64,000 samples | `7c7a622acef573ef67ca211f93c6337ac61cfacbd43224a616d797894fbf1ad8` |
| AASIST | official CLOVA AI repository `a04c9863f63d44471dde8a6abcb3b082b07cd1d1` | MIT repository license | mono float32, 16 kHz; official repeat-pad from 64,000 to 64,600 samples | `51d2d9cf0738172f61e2a384ec50a54a55363240f67c971ed55a92435bc1a1c0` |

The RawNet2 model card's abbreviated construction example does not match its published constructor.
The adapter therefore supplies the frozen 128-filter architecture used by the same repository's
source and checkpoint. Strict state-dictionary loading proves compatibility; no model algorithm is
changed. A separate attractive checkpoint was rejected during review because its 20-channel first
normalization layer did not match the original 128-filter source architecture.

Dependencies are pinned in [`pyproject.toml`](../../ml/pyproject.toml): PyTorch 2.13.0 CPU/GPU-aware
runtime selection, Torchaudio 2.11.0 stable-ABI package, SpeechBrain 1.1.1, and PyYAML 6.0.3.
`auto` selects CUDA only when PyTorch reports it available; explicit unavailable devices fail with
`DEVICE_UNAVAILABLE`. Checkpoints load with `weights_only=True`. Source modules load only after
their size and hash pass.

## Privacy and lifecycle

Voice audio and embeddings are biometric-like sensitive data. Input windows are copied only into
transient tensors. Enrollment embeddings remain in a non-serializable `SensitiveEmbedding`, expose
read-only views, and are overwritten on `clear()` or context exit. Adapter close releases model
references, performs garbage collection, and clears the CUDA cache when applicable. No test uses a
person's name or voice; the integration signal is generated analytic tone plus seeded noise and is
zeroed after the run. No raw score or embedding is logged by the adapters.

[`fetch_checkpoints.py`](../../ml/scripts/fetch_checkpoints.py) requires explicit license
acknowledgment, downloads only HTTPS allowlisted artifacts, enforces exact size and hash before an
atomic placement, and keeps artifacts outside Git. Startup and inference never download models.

## Controlled CPU compatibility experiment

On 2026-08-29 the native Windows development host ran experiment
`e995e35accdd0003847bcdb1874673e69112119be5bbe9a68c04caed72ab6233` using Python 3.12.3,
PyTorch 2.13.0+cpu, AMD64, the frozen Phase L preprocessing version, seed 26104, and all three pinned
checkpoints. Strict loads and one float32 `[64000]` inference per model passed; cleanup ended in
`CLOSED` for each adapter.

Single-run measured adapter-call latencies on that host were 212.321 ms for ECAPA, 269.447 ms for
RawNet2, and 338.639 ms for AASIST. These are engineering compatibility observations on generated
non-human signals, not a distribution, target-hardware benchmark, SLA, end-to-end latency, fixed
claim, or scientific performance result. Re-running the command measures a new observation while
retaining the same content-derived experiment identity:

```powershell
cd ml
.\.venv\Scripts\python.exe -m experiments.run_experiment `
  --acknowledge-nonhuman-smoke `
  --checkpoint-root checkpoints
```

Experiment JSON is kept outside Git by default. It contains versions, hashes, input shape/dtype,
score names/directions, lifecycle outcome, runtime identity, and measured adapter-call latency; it
does not contain audio, embeddings, model raw scores, personal metadata, or performance metrics.

## Validation required for Phase O

- No governed dataset archive or approved non-example frozen manifest is locally available.
- Data-owner approval, exact dataset receipt hashes, biometric-like purpose approval, retention
  execution, and source license acknowledgment remain unresolved in the Phase K register.
- Speaker FAR/FRR/EER; spoof precision/recall/F1/EER; confidence intervals; subgroup, unseen
  generator, codec/noise, calibration, complementarity, memory, and target-hardware latency have not
  been measured.
- No model is scientifically promoted and no deployment threshold or calibration artifact exists.

The Phase N adapter exit gate is complete. The Phase O execution gate must fail closed until a data
steward supplies an approved external governed data root and frozen real manifest; generated audio
cannot substitute for evaluation evidence.
