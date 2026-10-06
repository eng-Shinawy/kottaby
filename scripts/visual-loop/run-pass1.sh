#!/usr/bin/env bash
# Visual pass 1 — static captures of the 3 plan-affected surfaces × 3 viewports.
set -u
K=/home/z/my-project
CAP="$K/scripts/visual-loop/capture.sh"
OUT="$K/scratch/screenshots"
mkdir -p "$OUT"
cd "$K"

TITLE="Kottaby Academy"

# --- Teacher dashboard (sT) ---
for vp in "1440 900 desktop" "834 1112 tablet" "390 844 mobile"; do
  set -- $vp
  bash "$CAP" sT "$1" "$2" "http://127.0.0.1:3000/teacher/dashboard" \
    "p1-teacher-dashboard-$3.png" "$TITLE" "Availability" 10 || true
done

# --- Teacher sessions (sT) ---
for vp in "1440 900 desktop" "834 1112 tablet" "390 844 mobile"; do
  set -- $vp
  bash "$CAP" sT "$1" "$2" "http://127.0.0.1:3000/teacher/sessions" \
    "p1-teacher-sessions-$3.png" "$TITLE" "Teaching Sessions" 10 || true
done

# --- Student sessions (sS) ---
for vp in "1440 900 desktop" "834 1112 tablet" "390 844 mobile"; do
  set -- $vp
  bash "$CAP" sS "$1" "$2" "http://127.0.0.1:3000/student/sessions" \
    "p1-student-sessions-$3.png" "$TITLE" "My Sessions" 10 || true
done

ls -la "$OUT"/p1-*.png 2>/dev/null | wc -l
