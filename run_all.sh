#!/usr/bin/env bash
# =====================================================================
# MatrixOne 六大能力演示 · 一键运行
# 用法：先设置连接信息（环境变量），再运行：
#   export MO_HOST=127.0.0.1 MO_PORT=6001 MO_USER=root MO_PASS=111
#   # MatrixOne Cloud 形如： MO_USER='<account>:admin:accountadmin'
#   bash run_all.sh            # 跑全部
#   bash run_all.sh 04         # 只跑某一个（按编号）
# =====================================================================
set -u

HOST="${MO_HOST:-127.0.0.1}"
PORT="${MO_PORT:-6001}"
USER="${MO_USER:-root}"
PASS="${MO_PASS:-111}"
DIR="$(cd "$(dirname "$0")/sql" && pwd)"

run() {
  local f="$1"
  echo
  echo "############################################################"
  echo "# 执行 $f"
  echo "############################################################"
  mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" --force --table mo_demo \
    < "$DIR/$f" 2>&1 | grep -vi "Using a password"
}

# setup 不指定库名（脚本里自己 CREATE/USE）
run_setup() {
  echo "############################################################"
  echo "# 执行 00_setup.sql（建库 + 造数）"
  echo "############################################################"
  mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" --force \
    < "$DIR/00_setup.sql" 2>&1 | grep -vi "Using a password"
}

case "${1:-all}" in
  00|setup) run_setup ;;
  01) run 01_transaction.sql ;;
  02) run 02_analytics.sql ;;
  03) run 03_git4data.sql ;;
  04) run 04_vector_fulltext.sql ;;
  05) run 05_hybrid.sql ;;
  06) run 06_stage.sql ;;
  07) run 07_scheduled_task.sql ;;
  all)
    run_setup
    run 01_transaction.sql
    run 02_analytics.sql
    run 03_git4data.sql
    run 04_vector_fulltext.sql
    run 05_hybrid.sql
    run 06_stage.sql
    run 07_scheduled_task.sql
    ;;
  *) echo "未知参数: $1（可选 00|01|02|03|04|05|06|07|all）" ;;
esac
