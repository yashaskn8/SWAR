"""Validate a governed SWAR JSONL data manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from data_governance import (
    GovernanceError,
    load_json_document,
    load_manifest,
    validate_manifest_records,
    validate_source_register,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--source-register", required=True, type=Path)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument(
        "--check-files",
        action="store_true",
        help="Verify files, hashes, WAV/FLAC headers, duration, rate, and channels.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        sources = validate_source_register(load_json_document(args.source_register))
        records = load_manifest(args.manifest)
        validated = validate_manifest_records(
            records,
            sources,
            data_root=args.data_root,
            check_files=args.check_files,
        )
    except GovernanceError as error:
        print(
            json.dumps({"status": "error", "code": str(error)}, sort_keys=True),
            file=sys.stderr,
        )
        return 2

    print(
        json.dumps(
            {
                "status": "valid",
                "records": len(validated),
                "data_version": validated[0]["data_version"],
                "files_checked": args.check_files,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
