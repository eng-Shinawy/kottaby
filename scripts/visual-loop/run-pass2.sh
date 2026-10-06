#!/usr/bin/env bash
# Visual pass 2 — recapture after fix wave 1 (same 3 pages × 3 viewports).
set -u
K=/home/z/my-project
CAP="$K/scripts/visual-loop/capture.sh"
cd "$K"
TITLE="Kottaby Academy"

for vp in "1440 900 desktop" "834 1112 tablet" "390 844 mobile"; do
  set -- $vp
  bash "$CAP" sT "$1" "$2" "http://127.0.0.1:3000/teacher/dashboard" \
    "p2-teacher-dashboard-$3.png" "$TITLE" "Availability" 10 || true
  bash "$CAP" sT "$1" "$2" "http://127.0.0.1:3000/teacher/sessions" \
    "p2-teacher-sessions-$3.png" "$TITLE" "Teaching Sessions" 10 || true
  bash "$CAP" sS "$1" "$2" "http://127.0.0.1:3000/student/sessions" \
    "p2-student-sessions-$3.png" "$TITLE" "My Sessions" 10 || true
done

ls "$K/scratch/screenshots"/p2-*.png 2>/dev/null | wc -l
