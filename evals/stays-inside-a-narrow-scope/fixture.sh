set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
python3 "$REPO/evals/materials.py" stays-inside-a-narrow-scope "$PWD"
