"""Fetch only pinned Phase N artifacts after explicit local license acknowledgment."""

from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path

from app.models.registry import ArtifactSpec, ModelRegistry, file_sha256


class FetchError(RuntimeError):
    pass


def _target_path(root: Path, artifact: ArtifactSpec) -> Path:
    resolved_root = root.resolve()
    target = (resolved_root / artifact.relative_path).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError as error:
        raise FetchError("MODEL_ARTIFACT_PATH_OUTSIDE_ROOT") from error
    return target


def _existing_is_verified(target: Path, artifact: ArtifactSpec) -> bool:
    return (
        target.is_file()
        and target.stat().st_size == artifact.byte_size
        and file_sha256(target) == artifact.sha256
    )


def fetch_artifact(
    artifact: ArtifactSpec,
    *,
    checkpoint_root: Path,
    timeout_seconds: float = 60.0,
) -> Path:
    target = _target_path(checkpoint_root, artifact)
    if _existing_is_verified(target, artifact):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.download")
    request = urllib.request.Request(artifact.url, headers={"User-Agent": "SWAR-Phase-N/1.0"})
    received = 0
    try:
        with (
            urllib.request.urlopen(request, timeout=timeout_seconds) as response,
            temporary.open("wb") as destination,
        ):
            while chunk := response.read(1024 * 1024):
                received += len(chunk)
                if received > artifact.byte_size:
                    raise FetchError("MODEL_ARTIFACT_SIZE_MISMATCH")
                destination.write(chunk)
    except (OSError, urllib.error.URLError) as error:
        temporary.unlink(missing_ok=True)
        raise FetchError("MODEL_ARTIFACT_DOWNLOAD_FAILED") from error
    if received != artifact.byte_size or file_sha256(temporary) != artifact.sha256:
        temporary.unlink(missing_ok=True)
        raise FetchError("MODEL_ARTIFACT_VERIFICATION_FAILED")
    os.replace(temporary, target)
    return target


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path)
    parser.add_argument(
        "--checkpoint-root",
        type=Path,
        default=Path(__file__).parents[1] / "checkpoints",
    )
    parser.add_argument("--model", action="append", choices=("ecapa-tdnn", "rawnet2", "aasist"))
    parser.add_argument("--acknowledge-license", action="append", default=[])
    parser.add_argument("--acknowledge-all-licenses", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(argv)

    registry = ModelRegistry.load(args.registry)
    selected = list(args.model or [])
    if args.list:
        for model in registry.document.models:
            print(
                f"{model.model_id}: {model.license_identifier}; {model.license_url}; "
                f"{model.license_acknowledgment}"
            )
        return 0
    if not selected:
        parser.error("at least one --model is required unless --list is used")
    acknowledged = set(args.acknowledge_license)
    for model_id in selected:
        if not args.acknowledge_all_licenses and model_id not in acknowledged:
            print(f"LICENSE_ACKNOWLEDGMENT_REQUIRED:{model_id}", file=sys.stderr)
            return 2
    try:
        for model_id in selected:
            model = registry.get(model_id)
            for artifact in model.artifacts:
                path = fetch_artifact(artifact, checkpoint_root=args.checkpoint_root)
                print(f"VERIFIED:{model_id}:{artifact.artifact_id}:{path.name}")
    except FetchError as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
