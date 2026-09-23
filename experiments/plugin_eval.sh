set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin:$HOME/.cargo/bin
exec python3 "$REPO/experiments/claude_eval.py" "$@"