#!/usr/bin/env bash
set -euo pipefail
DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ ! -f "$DEMO_DIR/runtime/env.sh" ]] || source "$DEMO_DIR/runtime/env.sh"
[[ $# -le 1 ]] || { echo 'Usage: ./demo/start.sh [--check|--reset]'; exit 2; }
case "${1:-}" in ''|--check|--reset) ;; *) echo 'Usage: ./demo/start.sh [--check|--reset]'; exit 2;; esac
if command -v docker >/dev/null && ! docker info >/dev/null 2>&1 && [[ "${MO_DEMO_GROUP_RETRY:-}" != 1 ]] && id -nG "$(id -un)" | tr ' ' '\n' | grep -qx docker; then
  export MO_DEMO_GROUP_RETRY=1
  printf -v launch '%q ' "$DEMO_DIR/start.sh" "$@"
  exec sg docker -c "$launch"
fi
command -v python3 >/dev/null || { echo '先运行 ./demo/setup.sh 安装依赖。'; exit 1; }
python3 "$DEMO_DIR/environment.py"
[[ "${1:-}" != --check ]] || exit 0
exec python3 "$DEMO_DIR/launch.py" "$@"
