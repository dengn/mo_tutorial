#!/usr/bin/env bash
# Install the dependencies for the complete local v4.2.4 tutorial.
set -euo pipefail
DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == --check ]]; then
  [[ ! -f "$DEMO_DIR/runtime/env.sh" ]] || source "$DEMO_DIR/runtime/env.sh"
  exec python3 "$DEMO_DIR/environment.py"
fi
[[ $# == 0 ]] || { echo 'Usage: ./demo/setup.sh [--check]' >&2; exit 2; }
[[ $(uname -s) == Linux && -f /etc/os-release ]] || { echo '自动安装支持 Debian 12/13、Ubuntu 22.04/24.04。其他环境请按 README 手动准备。'; exit 1; }
case "$(uname -m)" in x86_64|aarch64) ;; *) echo '自动安装仅支持 amd64 / arm64'; exit 1;; esac
source /etc/os-release
case "$ID:$VERSION_ID" in debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;; *) echo "暂不支持自动安装：$ID $VERSION_ID"; exit 1;; esac
sudo_cmd=()
if (( EUID != 0 )); then
  command -v sudo >/dev/null || { echo '请管理员安装 sudo，并授予当前用户软件安装权限。'; exit 1; }
  sudo_cmd=(sudo)
fi
echo '安装 Python、MariaDB 客户端、Git 和 C/C++ 构建依赖（需要管理员权限）。'
"${sudo_cmd[@]}" apt-get update
"${sudo_cmd[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-remove python3 ca-certificates curl git build-essential cmake pkg-config unzip libomp-dev mariadb-client
# Reuse an existing engine. Do not replace containerd or remove existing runtimes.
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  if ! command -v docker >/dev/null && (dpkg-query -W -f='${Status}' containerd 2>/dev/null | grep -q 'install ok installed'); then
    echo '检测到已有 containerd。请按 Docker 官方说明安装兼容的 Docker Engine，再重跑本脚本。' >&2; exit 1
  fi
  if ! grep -Rqs "download.docker.com/linux/$ID" /etc/apt/sources.list /etc/apt/sources.list.d; then
    "${sudo_cmd[@]}" install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" | "${sudo_cmd[@]}" tee /etc/apt/keyrings/docker.asc >/dev/null
    "${sudo_cmd[@]}" chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" | "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/mo-demo-docker.list >/dev/null
  fi
  "${sudo_cmd[@]}" apt-get update
  if command -v docker >/dev/null; then
    "${sudo_cmd[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-remove docker-compose-plugin
  else
    "${sudo_cmd[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-remove docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
if ! docker info >/dev/null 2>&1; then
  "${sudo_cmd[@]}" systemctl start docker
  if (( EUID != 0 )); then
    "${sudo_cmd[@]}" usermod -aG docker "$(id -un)"
    echo '已加入 docker 用户组（该组拥有管理员级容器权限）；start.sh 会使用新组权限启动。'
  fi
fi
python3 "$DEMO_DIR/environment.py" --prepare
"$DEMO_DIR/start.sh" --check
printf '\n环境准备完成。运行：%s/start.sh\n' "$DEMO_DIR"
