#!/usr/bin/env bash
# Batch VLM inspection of all captures. One image per CLI call.
# Usage: vlm-batch.sh  (idempotent — skips images with existing verdicts)
set -u
cd /home/z/my-project
OUT=scratch/screenshots/verdicts
mkdir -p "$OUT"
FAIL=0

RUBRIC='You are a strict visual QA inspector for the Kottaby Academy web app (MUI dashboard, left sidebar shell - do not score the shell, only page content). The capture already passed mechanical gates (no console errors, no overflow, right page). Score each axis 0-10: hierarchy (eye guidance title->sections->actions), spacing (consistent paddings/rhythm, no dead bands), typography (scale and weight contrast, no cramped text), color (semantic theme tokens), affordance (controls look interactive, states unambiguous, empty states composed), responsive (no overflow, no dead space, purposeful reflow at THIS viewport). For Arabic (locale ar) captures also check: layout mirrors RTL, text is right-aligned start, no broken Arabic glyphs, directional icons mirrored. Output EXACTLY:
Scores: hierarchy X, spacing X, typography X, color X, affordance X, responsive X, total X
Findings:
[HIGH/MEDIUM/LOW] element - defect - concrete fix
(one line per finding, or none)
Verdict: READY (total>=9.5) | NEEDS FIXES'

inspect() { # <image> <screen-context>
  local IMG="scratch/screenshots/$1"
  local NAME="${1%.png}"
  [ -s "$OUT/$NAME.txt" ] && { echo "SKIP $1"; return 0; }
  if ! z-ai vision -p "$RUBRIC

Screen context: $2" -i "$IMG" -o "/tmp/vlm-out-$NAME.json" >/dev/null 2>&1; then
    echo "VLM CALL FAILED $1"
    FAIL=1
    return 1
  fi
  if ! python3 -c "
import json, sys
try:
    d=json.load(open('/tmp/vlm-out-$NAME.json'))
    c=d['choices'][0]['message']['content'] if isinstance(d,dict) and d.get('choices') else None
    if not isinstance(c, str) or not c.strip():
        raise ValueError('empty or missing completion content')
    open('$OUT/$NAME.txt','w').write('=== $1 ===\n'+c)
    print(c.split(chr(10))[0][:100])
except Exception as e:
    print('VLM ERROR $1:', e)
    sys.exit(1)
"; then
    FAIL=1
    return 1
  fi
}

inspect "01-student-empty-mobile.png"    "Student Sessions page, EMPTY state (no sessions yet), mobile 390x844, locale en"
inspect "02-student-escrow-row-desktop.png" "Student Sessions page with ONE booked session row: Hifz intent, Scheduled status, fee 25.00 EGP held in escrow, cancel + dispute row actions, desktop 1440x900, locale en"
inspect "02-student-escrow-row-tablet.png"  "Same student sessions page with escrow row, tablet 834x1112, locale en"
inspect "02-student-escrow-row-mobile.png"  "Same student sessions page with escrow row, mobile 390x844, locale en"
inspect "03-teacher-escrow-desktop.png"  "Teacher 'Teaching Sessions' page with one session row (Hifz, scheduled, fee held escrow badge, student name, confirm/decline style actions), desktop 1440x900, locale en"
inspect "03-teacher-escrow-tablet.png"   "Same teacher sessions page, tablet 834x1112, locale en"
inspect "03-teacher-escrow-mobile.png"   "Same teacher sessions page, mobile 390x844, locale en"
inspect "04-wallet-empty-desktop.png"    "Teacher Wallet page EMPTY state: zero balance 0.00 EGP, empty transaction ledger, disabled withdraw CTA, desktop 1440x900, locale en"
inspect "05-student-completed-desktop.png" "Student Sessions page, session COMPLETED by teacher: 'Awaiting student confirmation' notice, CONFIRM COMPLETION button with consequence explainer (student confirmation settles the held fee to the teacher), desktop 1440x900, locale en"
inspect "05-student-completed-mobile.png"  "Same completed-state student session row, mobile 390x844, locale en"
inspect "06-wallet-credited-desktop.png" "Teacher Wallet page AFTER settlement: balance 25.00 EGP, withdraw button, one Earning ledger row of 25.00 EGP (Completed), desktop 1440x900, locale en"
inspect "06-wallet-credited-tablet.png"  "Same credited teacher wallet, tablet 834x1112, locale en"
inspect "06-wallet-credited-mobile.png"  "Same credited teacher wallet, mobile 390x844, locale en"
inspect "07-teacher-completed-desktop.png" "Teacher sessions page with the settled Completed session row (both confirmations stamped), desktop 1440x900, locale en"
inspect "08-admin-governance-desktop.png" "Admin Session Governance page: filterable directory over all platform sessions (filter bar with selects/search, session rows with escrow state), desktop 1440x900, locale en"
inspect "08-admin-governance-tablet.png"  "Same admin governance page, tablet 834x1112, locale en"
inspect "08-admin-governance-mobile.png"  "Same admin governance page, mobile 390x844, locale en"
inspect "09-student-sessions-ar-desktop.png" "Student Sessions page with escrow session row, Arabic locale AR (RTL layout - check mirroring, start-alignment, Arabic glyph rendering), desktop 1440x900"
inspect "09-student-sessions-ar-mobile.png"  "Same Arabic RTL student sessions page, mobile 390x844"
inspect "09-wallet-ar-mobile.png"            "Teacher wallet credited 25.00 EGP, Arabic locale AR (RTL), mobile 390x844"

echo "ALL DONE (FAIL=$FAIL)"
# A batch with any failed/unaired VLM inspection is a failed validation.
exit $FAIL
