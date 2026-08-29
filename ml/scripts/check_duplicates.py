"""Reject exact/near duplicates and speaker, lineage, or final-OOD leakage."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from data_governance import (
    GovernanceError,
    leakage_errors,
    load_json_document,
    load_manifest,
    validate_manifest_records,
    validate_source_register,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--source-register", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        sources = validate_source_register(load_json_document(args.source_register))
        records = validate_manifest_records(load_manifest(args.manifest), sources)
        errors = leakage_errors(records)
        if errors:
            raise GovernanceError("LEAKAGE_REJECTED:" + "|".join(errors))
    except GovernanceError as error:
        print(
            json.dumps({"status": "error", "code": str(error)}, sort_keys=True),
            file=sys.stderr,
        )
        return 2

    print(json.dumps({"status": "valid", "records": len(records)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
