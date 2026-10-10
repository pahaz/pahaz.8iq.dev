#!/usr/bin/env bash
# Remove Recorder from this Mac: the app, its settings, logs, caches and
# downloaded models. Recordings in ~/Music/Recorder are never touched: the
# script says how much space they take and how to remove them. Everything
# removed goes to the Trash, so it can be put back until the Trash is emptied.
set -euo pipefail

dry_run=0
assume_yes=0

usage() {
  cat <<'USAGE'
Remove Recorder from this Mac.

Usage:
  ./scripts/uninstall.sh [options]

Stops the app and moves to the Trash the app, its settings, its logs and caches,
and the downloaded models. Recordings and transcripts in ~/Music/Recorder are
kept. A recording in progress is lost: the app is killed, not asked to quit.

Options:
  --dry-run             Show what would be removed and change nothing.
  -y, --yes             Do not ask for confirmation.
  -h, --help            Show this help.

Recorder Dev, the local development build (recorder.dev), is removed too.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    -y|--yes) assume_yes=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

library="$HOME/Library"

# Bundle identifiers: the release, and the ones it had before (see git history):
# app.openpiezo.recorder as Open Piezo, then -iq.murmemo.recorder and
# murmemo.recorder as MurMemo. The Open Piezo app was already called Recorder.
# recorder.dev is Recorder Dev, the local development build.
bundle_ids=(recorder recorder.dev murmemo.recorder -iq.murmemo.recorder app.openpiezo.recorder)
app_names=(Recorder "Recorder Dev" MurMemo)

# --- What there is to remove -------------------------------------------------

paths=()
add_path() {
  [[ -e "$1" || -L "$1" ]] && paths+=("$1")
  return 0
}

for name in "${app_names[@]}"; do
  add_path "/Applications/$name.app"
  add_path "$HOME/Applications/$name.app"
done

add_path "$library/Application Support/Recorder"
add_path "$library/Application Support/MurMemo"
add_path "$library/Application Support/FluidAudio"
add_path "$library/Logs/Recorder"
add_path "$library/Logs/MurMemo"
add_path "$library/Logs/Open Piezo"

for id in "${bundle_ids[@]}"; do
  add_path "$library/Caches/$id"
  add_path "$library/HTTPStorages/$id"
  add_path "$library/HTTPStorages/$id.binarycookies"
  add_path "$library/WebKit/$id"
  add_path "$library/Saved Application State/$id.savedState"
  add_path "$library/Preferences/$id.plist"
done

recordings=()
for dir in "$HOME/Music/Recorder" "$HOME/Music/MurMemo" "$HOME/Music/Open Piezo"; do
  [[ -e "$dir" ]] && recordings+=("$dir")
done

size_of() {
  du -sh "$1" 2>/dev/null | cut -f1 | tr -d ' '
}

# The recordings stay where they are; this says how big they are and how to
# remove them by hand.
show_recordings() {
  [[ ${#recordings[@]} -eq 0 ]] && return 0
  local dir
  echo "Recordings and transcripts are kept:"
  for dir in "${recordings[@]}"; do
    echo "  $(size_of "$dir")	${dir/#$HOME/~}"
  done
  echo "To remove them too (to the Trash):"
  for dir in "${recordings[@]}"; do
    if [[ -x /usr/bin/trash ]]; then
      echo "  trash \"${dir/#$HOME/\$HOME}\""
    else
      echo "  mv \"${dir/#$HOME/\$HOME}\" ~/.Trash/"
    fi
  done
}

echo "To the Trash:"
if [[ ${#paths[@]} -eq 0 ]]; then
  echo "  (nothing found)"
else
  for p in "${paths[@]}"; do
    note=""
    [[ "$p" == *"/Application Support/FluidAudio" ]] && note="  — speech models, shared with any other app built on FluidAudio"
    echo "  $(size_of "$p")	${p/#$HOME/~}$note"
  done
fi
echo
for app in ${other_copies[@]+"${other_copies[@]}"}; do
  echo "Not removed, another copy of the app: ${app/#$HOME/~}"
done
echo
show_recordings
echo

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run: nothing changed."
  exit 0
fi

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer </dev/tty || return 1
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" ]]
}

if [[ $assume_yes -eq 0 ]] && ! confirm "Uninstall Recorder?"; then
  echo "Cancelled."
  exit 1
fi

# --- Stop the app -------------------------------------------------------------

# Matched by the executable inside the bundle, so another app's process with the
# same short name is left alone.
executables=(
  "/Recorder.app/Contents/MacOS/Recorder"
  "/Recorder Dev.app/Contents/MacOS/Recorder Dev"
  "/MurMemo.app/Contents/MacOS/MurMemo"
)

running_pids() {
  local exe
  for exe in "${executables[@]}"; do
    pgrep -f -- "$exe( |\$)" || true
  done
}

pids=$(running_pids)
if [[ -n "$pids" ]]; then
  echo "Stopping the app…"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    [[ -z "$(running_pids)" ]] && break
    sleep 1
  done
  pids=$(running_pids)
  # shellcheck disable=SC2086
  [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
fi

# --- Remove -------------------------------------------------------------------

to_trash() {
  if [[ -x /usr/bin/trash ]]; then
    /usr/bin/trash "$1"
  else
    local target="$HOME/.Trash/$(basename "$1")"
    [[ -e "$target" ]] && target="$target $(date +%Y-%m-%d\ %H.%M.%S)"
    mv "$1" "$target"
  fi
}

failed=0
for p in ${paths[@]+"${paths[@]}"}; do
  if to_trash "$p"; then
    echo "Trashed ${p/#$HOME/~}"
  else
    echo "Could not move ${p/#$HOME/~} to the Trash" >&2
    failed=1
  fi
done

# cfprefsd keeps the settings it has read; restarting it drops them, so a
# reinstalled app does not get them back from its memory.
killall -u "$USER" cfprefsd 2>/dev/null || true

echo
if [[ $failed -eq 1 ]]; then
  echo "Done, with errors above."
else
  echo "Recorder is uninstalled. Empty the Trash to free the space."
  echo "If it still shows in System Settings → General → Login Items, remove it there."
fi
echo
show_recordings
exit $failed
