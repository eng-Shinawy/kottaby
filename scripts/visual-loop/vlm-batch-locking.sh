#!/usr/bin/env bash
# Batch VLM inspection for the in-session-locking visual pass.
# One image per CLI call (skill golden rule). Idempotent via verdict txt files.
set -u
cd /home/z/my-project
OUT=scratch/screenshots/verdicts
mkdir -p "$OUT"
FAIL=0

RUBRIC='You are a strict visual QA inspector for the Kottaby Academy web app (MUI dashboard, left sidebar shell - do not score the shell, only page content). The capture already passed mechanical gates (no console errors, no overflow, right page). Score each axis 0-10: hierarchy (eye guidance title->sections->actions), spacing (consistent paddings/rhythm, no dead bands), typography (scale and weight contrast, no cramped text), color (semantic theme tokens), affordance (controls look interactive, states unambiguous, empty states composed), responsive (no overflow, no dead space, purposeful reflow at THIS viewport). Output EXACTLY:
Scores: hierarchy X, spacing X, typography X, color X, affordance X, responsive X, total X
Findings:
[HIGH/MEDIUM/LOW] element - defect - concrete fix
(one line per finding, or none)
Verdict: READY (total>=9.5) | NEEDS FIXES
Be literal: do not invent elements you cannot see; do not score the pre-existing app shell.'

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

CONTEXT_TEACHER_DASH="Teacher Dashboard, locale en. Content: welcome header, Availability card with SET AS UNAVAILABLE toggle button (teacher currently online) and a status chip showing Available, Application Status card (Passed), What's next upcoming-sessions empty state, stats strip (sessions completed 2, balance 50.00, upcoming 0, notifications 1), Getting Started checklist."
CONTEXT_TEACHER_SESSIONS="Teacher 'Teaching Sessions' list page, locale en. Content: page title, status filter chips (All statuses/Scheduled/In progress/Completed/Cancelled/Disputed), session row cards (Hifz, Completed badge, fee 25.00 EGP, deadline/created/confirmation dates, SESSION REPORT action)."
CONTEXT_STUDENT_SESSIONS="Student 'My Sessions' list page, locale en. Content: page title, status filter chips, session row cards (Hifz, Completed, 25.00 EGP, dates, RATE TEACHER + OPEN DISPUTE actions)."

for shot in teacher-dashboard teacher-sessions student-sessions; do
  case $shot in
    teacher-dashboard) CTX="$CONTEXT_TEACHER_DASH" ;;
    teacher-sessions) CTX="$CONTEXT_TEACHER_SESSIONS" ;;
    student-sessions) CTX="$CONTEXT_STUDENT_SESSIONS" ;;
  esac
  inspect "p2-$shot-desktop.png" "$CTX Desktop viewport 1440x900."
  inspect "p2-$shot-tablet.png"  "$CTX Tablet viewport 834x1112."
  inspect "p2-$shot-mobile.png"  "$CTX Mobile viewport 390x844 (mobile nav)."
done

echo "DONE fail=$FAIL"
