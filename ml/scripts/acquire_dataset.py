"""Import one verified dataset archive into an external governed data root."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from data_governance import (
    GovernanceError,
    acquire_archive,
    load_json_document,
    validate_source_register,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_id")
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--source-register", required=True, type=Path)
    parser.add_argument(
        "--acknowledge-license",
        metavar="LICENSE_ID",
        help="Acknowledge the exact registered license/terms identifier.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        sources = validate_source_register(load_json_document(args.source_register))
        source = sources.get(args.source_id)
        if source is None:
            raise GovernanceError("ACQUISITION_SOURCE_UNKNOWN")
        receipt = acquire_archive(
            source,
            args.archive,
            args.destination,
            args.acknowledge_license,
            REPOSITORY_ROOT,
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
                "status": receipt["status"],
                "source_id": receipt["source_id"],
                "source_version": receipt["source_version"],
                "archive_sha256": receipt["archive_sha256"],
                "content_extracted": False,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
