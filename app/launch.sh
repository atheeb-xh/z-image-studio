#!/bin/bash
# Started by the app. Sets up Python on first run, then starts the server.
R="$(cd "$(dirname "$0")" && pwd)"
D="$HOME/Library/Application Support/Z-Image Studio"
mkdir -p "$D"
LOG="$D/log.txt"; PID="$D/server.pid"
: > "$LOG"; rm -f "$PID"

# Already running? Just show it.
if curl -s -o /dev/null --max-time 1 http://127.0.0.1:7860/status; then
  open http://127.0.0.1:7860
  pgrep -f "Z-Image Studio.*server.py" | head -1 > "$PID"
  exit 0
fi

fail() {
  echo failed > "$PID"
  osascript -e "display alert \"Z-Image Studio couldn't start\" message \"$1 Details are in ~/Library/Application Support/Z-Image Studio/log.txt\"" >/dev/null
  exit 1
}

[ "$(uname -m)" = "arm64" ] || fail "It needs a Mac with Apple Silicon (M1 or newer)."

# Everything the app installs lives in its own folder.
export UV_PYTHON_INSTALL_DIR="$D/python" UV_CACHE_DIR="$D/cache" ZIS_UV="$R/uv"
if [ ! -x "$D/venv/bin/python" ]; then
  osascript -e 'display notification "Setting up for the first time. This takes a few minutes." with title "Z-Image Studio"'
  "$R/uv" venv --python 3.13 "$D/venv" >>"$LOG" 2>&1 || { rm -rf "$D/venv"; fail "Setup failed. Check your internet connection and try again."; }
fi

"$D/venv/bin/python" -u "$R/server.py" >>"$LOG" 2>&1 &
echo $! > "$PID"
