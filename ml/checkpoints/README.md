# SWAR Model Checkpoint Acquisition

This directory intentionally tracks only this instruction file. Model source files, configurations,
and checkpoints are sensitive supply-chain inputs and remain ignored by Git.

The authoritative artifact allowlist is [`../config/model_registry.yaml`](../config/model_registry.yaml).
Every entry pins an immutable provider revision, HTTPS download URL, exact byte count, SHA-256,
license identifier, score direction, expected sample rate, and architecture. The fetcher refuses an
unacknowledged license, an unexpected size/hash, a path escape, or a non-HTTPS URL.

From `ml/`, review each provider license and then fetch only the selected model:

```powershell
.\.venv\Scripts\python.exe -m scripts.fetch_checkpoints `
  --model ecapa-tdnn `
  --acknowledge-license ecapa-tdnn
```

Repeat for `rawnet2` and `aasist`. A project owner may use `--acknowledge-all-licenses` only after
reviewing all three notices printed by `--list`. Acknowledgment is an explicit local action; it is
not stored as a credential and does not assert that a dataset license or production use is approved.

The adapters verify every required artifact again before loading and call `torch.load` with
`weights_only=True`. RawNet2 and AASIST source modules are imported only after their pinned source
hashes pass. Missing or modified files fail readiness; no network download occurs during service
startup or inference.

Do not commit checkpoint files, cached downloads, embeddings, raw audio, Hugging Face tokens, or
license-acceptance credentials. Delete local artifacts only under the approved retention process.
