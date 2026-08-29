from __future__ import annotations

import hashlib
import io
from pathlib import Path

from app.models.registry import ArtifactSpec
from scripts.fetch_checkpoints import fetch_artifact


class Response(io.BytesIO):
    def __enter__(self) -> Response:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def test_fetcher_verifies_before_atomic_placement(monkeypatch: object, tmp_path: Path) -> None:
    payload = b"pinned-test-checkpoint"
    artifact = ArtifactSpec(
        artifact_id="test-checkpoint",
        relative_path="test/model.pth",
        kind="CHECKPOINT",
        url="https://example.invalid/model.pth",
        sha256=hashlib.sha256(payload).hexdigest(),
        byte_size=len(payload),
    )
    monkeypatch.setattr(  # type: ignore[attr-defined]
        "urllib.request.urlopen", lambda *_args, **_kwargs: Response(payload)
    )
    target = fetch_artifact(artifact, checkpoint_root=tmp_path)
    assert target.read_bytes() == payload
    assert not target.with_name(f".{target.name}.download").exists()
