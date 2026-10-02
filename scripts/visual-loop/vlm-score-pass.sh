#!/usr/bin/env bash
# VLM inspector pass — ONE image per z-ai vision call (skill golden rule).
# Scores each capture against the visual-improvement-loop 6-axis rubric.
# Usage: vlm-score-pass.sh <shot1> [shot2 ...]
set -u
K=/home/z/my-project
cd "$K"
mkdir -p vi-out

PROMPT='You are a strict visual QA inspector for an admin dashboard (Arabic-first, RTL-aware, MUI-based). Score this ONE screenshot against ALL SIX axes (0-10 each): 1) hierarchy & layout (eye guidance title->sections->actions), 2) spacing & alignment (consistent paddings, shared rhythm, no dead bands), 3) typography (scale/weight contrast, no cramped text; for AR: bidi-correct shaping, no clipped Arabic glyphs), 4) color & theming (semantic color use, token-consistent), 5) control affordance (buttons/inputs look interactive; selected states unambiguous), 6) responsiveness for this viewport (no overflow, no dead space, purposeful reflow; for AR: layout mirrors, no stuck left/right regions). Output EXACTLY this format:
=== <image> (locale: <ar|en>) ===
Scores: hierarchy X - spacing X - typography X - color X - affordance X - responsive X -> total X
Findings: for each defect: [HIGH/MEDIUM/LOW] element - defect - concrete fix (name the exact element; if none, write "none")
Verdict: READY (total >= 9.5) | NEEDS FIXES
Be precise and literal; do not invent elements you cannot see.'

for shot in "$@"; do
  base=$(basename "$shot" .png)
  echo "=== inspecting $shot ==="
  z-ai vision -p "$PROMPT" -i "scratch/screenshots/$shot" -o "vi-out/$base.json" >/dev/null 2>&1 || echo "VLM CALL FAILED: $shot"
  python3 - "$base" <<'PYEOF'
import json, sys
base = sys.argv[1]
try:
    d = json.load(open(f"vi-out/{base}.json"))
    content = d if isinstance(d, str) else d.get("content") or d.get("choices", [{}])[0].get("message", {}).get("content", "")
    print(content[:1200])
except Exception as e:
    print(f"(no parseable output for {base}: {e})")
PYEOF
done
