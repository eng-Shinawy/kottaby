#!/usr/bin/env bash
# visual-precheck.sh — objective capture gate for the visual-improvement-loop skill.
# Runs the mechanical checks from references/objective-prechecks.md on a single capture target.
# Exit 0 = all checks PASS. Exit 1 = at least one check FAILED (fix the page). Exit 2 = harness error.
#
# Uses the ambient agent-browser session (AGENT_BROWSER_SESSION); create one with:
#   agent-browser session id --scope worktree --prefix <prefix>
set -u -o pipefail

URL=""
SETTLE=10
EXPECT_TITLE=""
NAV=1

usage() {
  cat >&2 <<'EOF'
usage: visual-precheck.sh --url <url> [--settle <seconds>] [--expect-title <substr>]
       visual-precheck.sh --no-nav [--expect-title <substr>]

Options:
  --url <url>           Navigate the current session to this URL before checking.
  --settle <seconds>    Sleep after navigation before checking (default 10).
  --expect-title <s>    FAIL the title guard unless document.title contains <s>.
  --no-nav              Gate whatever page is already open (use between recaptures).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:?--url needs a value}"; shift 2 ;;
    --settle) SETTLE="${2:?--settle needs a value}"; shift 2 ;;
    --expect-title) EXPECT_TITLE="${2:?--expect-title needs a value}"; shift 2 ;;
    --no-nav) NAV=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

command -v agent-browser >/dev/null 2>&1 || { echo "ERROR: agent-browser CLI not on PATH" >&2; exit 2; }

if [ "$NAV" -eq 1 ]; then
  [ -n "$URL" ] || { echo "ERROR: --url is required unless --no-nav" >&2; exit 2; }
  agent-browser open "$URL" >/dev/null 2>&1 || { echo "ERROR: navigation failed for $URL" >&2; exit 2; }
  sleep "$SETTLE"
fi

report() { # <name> <PASS|FAIL|ERROR> <detail>
  printf 'CHECK %-16s %-5s %s\n' "$1" "$2" "$3"
}

# agent-browser eval returns JSON strings with escaped inner quotes ("{\"a\":0}").
# Strip backslashes and quotes once so greps see plain `a:0` text.
norm() { printf '%s' "$1" | tr -d '\\"'; }

STATUS=0

eval_js() { # <js> -> stdout of the page evaluation, empty on failure
  agent-browser eval "$1" 2>/dev/null
}

# 1. Title guard
TITLE_RAW=$(eval_js "document.title")
if [ -z "$TITLE_RAW" ]; then
  report "title" "ERROR" "eval returned nothing (session dead?)"
  exit 2
fi
TITLE=$(printf '%s' "$TITLE_RAW" | tr -d '"')
if [ -n "$EXPECT_TITLE" ]; then
  case "$TITLE" in
    *"$EXPECT_TITLE"*) report "title" "PASS" "\"$TITLE\"" ;;
    *) report "title" "FAIL" "expected substring \"$EXPECT_TITLE\", got \"$TITLE\""; STATUS=1 ;;
  esac
elif printf '%s' "$TITLE" | grep -qi 'login'; then
  report "title" "FAIL" "looks like a login page: \"$TITLE\" — re-auth, then recapture"
  STATUS=1
else
  report "title" "PASS" "\"$TITLE\""
fi

# 2. Console errors (heuristic: count lines containing 'error' from the error-level console dump)
CONSOLE_OUT=$(agent-browser console --level error 2>/dev/null || true)
CONSOLE_HITS=$(printf '%s' "$CONSOLE_OUT" | grep -ci 'error' || true)
if [ "$CONSOLE_HITS" -eq 0 ]; then
  report "console" "PASS" "no error-level console entries"
else
  report "console" "FAIL" "${CONSOLE_HITS} error-level console entries — inspect with: agent-browser console --level error"
  STATUS=1
fi

# 3. Horizontal overflow
OVERFLOW_RAW=$(eval_js 'JSON.stringify({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth })')
if [ -z "$OVERFLOW_RAW" ]; then
  report "overflow" "ERROR" "eval returned nothing"
  STATUS=2
else
  OVERFLOW=$(norm "$OVERFLOW_RAW")
  if printf '%s' "$OVERFLOW" | grep -q 'overflow:true'; then
    report "overflow" "FAIL" "$OVERFLOW"
    STATUS=1
  else
    report "overflow" "PASS" "$OVERFLOW"
  fi
fi

# 4. Off-viewport bleed (first 10 offenders; empty array = pass)
OFFSCREEN_RAW=$(eval_js 'JSON.stringify(Array.from(document.querySelectorAll("body *")).filter((el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).position !== "fixed" && r.width > 0 && r.right > window.innerWidth + 1; }).slice(0, 10).map((el) => el.tagName + "." + (String(el.className).split(" ")[0] || "")))')
if [ -z "$OFFSCREEN_RAW" ]; then
  report "offscreen" "ERROR" "eval returned nothing"
  STATUS=2
else
  OFFSCREEN=$(norm "$OFFSCREEN_RAW")
  if printf '%s' "$OFFSCREEN" | grep -qF '[]'; then
    report "offscreen" "PASS" "no elements bleed past the viewport"
  else
    report "offscreen" "FAIL" "offenders: $OFFSCREEN"
    STATUS=1
  fi
fi

# 5. A11y smoke (imgs without alt, icon-only buttons without accessible name)
A11Y_RAW=$(eval_js 'JSON.stringify({ imgsNoAlt: document.querySelectorAll("img:not([alt])").length, unnamedIconButtons: Array.from(document.querySelectorAll("button:not([aria-label])")).filter((b) => !b.textContent.trim()).length })')
if [ -z "$A11Y_RAW" ]; then
  report "a11y" "ERROR" "eval returned nothing"
  STATUS=2
else
  A11Y=$(norm "$A11Y_RAW")
  if printf '%s' "$A11Y" | grep -q 'imgsNoAlt:0' && printf '%s' "$A11Y" | grep -q 'unnamedIconButtons:0'; then
    report "a11y" "PASS" "$A11Y"
  else
    report "a11y" "FAIL" "$A11Y"
    STATUS=1
  fi
fi

exit "$STATUS"
