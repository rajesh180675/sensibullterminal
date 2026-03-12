#!/usr/bin/env python3

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "logs" / "automation_webhook_samples.jsonl"
DEFAULT_DESTINATION = REPO_ROOT / "tests" / "fixtures" / "icici_webhook_real_capture.json"


def load_latest_icici_payload(source: Path) -> dict:
    if not source.exists():
        raise FileNotFoundError(f"Webhook sample log not found: {source}")

    latest_payload = None
    for raw_line in source.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        record = json.loads(raw_line)
        if not record.get("matchesIciciOrderUpdate"):
            continue
        payload = record.get("payload")
        if isinstance(payload, dict):
            latest_payload = payload

    if latest_payload is None:
        raise RuntimeError(f"No captured ICICI webhook samples found in {source}")
    return latest_payload


def main(argv: list[str]) -> int:
    source = Path(argv[1]).resolve() if len(argv) > 1 else DEFAULT_SOURCE
    destination = Path(argv[2]).resolve() if len(argv) > 2 else DEFAULT_DESTINATION
    payload = load_latest_icici_payload(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
