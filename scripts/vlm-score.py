#!/usr/bin/env python3
"""Visual scorer: VLM-based 10/10 scoring of a page screenshot.
Usage: vlm-score.py <image> <page_name> <viewport_name>
Prints: SCORE: <n>/10 then ISSUES: bullets.
"""
import json
import subprocess
import sys

PROMPT = """You are a meticulous senior UI/UX reviewer auditing a screenshot of a web page from an Arabic RTL Quran-teaching academy app (MUI React). The page name is "{page}" captured at {viewport}.

Score the VISUAL QUALITY and RESPONSIVENESS strictly out of 10, based ONLY on OBJECTIVE defects. Deduct points for:
1. Horizontal overflow / content cut off at the viewport edges
2. Text clipped, truncated, or illegibly small
3. Overlapping elements (text over text, buttons over cards, icons over labels)
4. Broken alignment: cards/columns that visibly don't line up, ragged grid
5. RTL breakage: labels on the wrong side of their icons, mixed LTR/RTL fragments that render nonsensically (note: in RTL the "end" side is the LEFT — endAdornments appearing on the left is CORRECT, not a defect)
6. Broken/unstyled raw-HTML-looking elements, stuck loading spinners, empty gray boxes
7. Contrast failure: text genuinely unreadable against its background
8. Touch targets visibly cramped/impossible to tap on mobile

DO NOT deduct for subjective taste: whitespace density preferences, "could be more modern", color preferences, brand style, spacing that is merely generous, or equal-vs-unequal footer column link counts when each column is internally aligned and readable. A clean, balanced, fully-functional page has NO objective defect — that is a 10.

A 10/10 means: no objective defect listed above is present.

Respond in EXACTLY this format:
SCORE: <number>/10
ISSUES:
- <objective defect with location> (or "NONE" if flawless)
- ...
"""

def main() -> int:
    image, page, viewport = sys.argv[1], sys.argv[2], sys.argv[3]
    out = f"/tmp/vlm-score-{abs(hash(image + page + viewport))}.json"
    subprocess.run(
        ["z-ai", "vision", "-p", PROMPT.format(page=page, viewport=viewport), "-i", image, "-o", out],
        capture_output=True, text=True, timeout=240,
    )
    try:
        with open(out) as f:
            content = json.load(f)["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"SCORER-ERROR: {e}")
        print(subprocess.run(["z-ai", "vision", "-p", PROMPT.format(page=page, viewport=viewport), "-i", image],
                             capture_output=True, text=True, timeout=240).stdout[:2000])
        return 1
    print(content.strip())
    return 0

if __name__ == "__main__":
    sys.exit(main())
