#!/usr/bin/env python3
"""Print a paired cost summary for a results JSONL file."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import analyze_cli

if __name__ == "__main__":
    raise SystemExit(analyze_cli())
