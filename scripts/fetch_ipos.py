#!/usr/bin/env python3
"""Fetch live MUFG IPO list and write ipos.json for GitHub Pages."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.proxy import get_mufg_list  # noqa: E402


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'ipos.json'
    ipos = get_mufg_list()
    out.write_text(json.dumps(ipos, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(ipos)} IPOs to {out}')


if __name__ == '__main__':
    main()
