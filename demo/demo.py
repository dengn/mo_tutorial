#!/usr/bin/env python3
"""Interactive MatrixOne 4.2.4 demo. The local server executes all demo SQL."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, quote, urlencode, parse_qs
from urllib.request import Request, ProxyHandler, build_opener
from urllib.error import HTTPError, URLError
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
SOURCE_REPO = Path(os.environ.get("MO_DEMO_SOURCE_DIR", str(Path.home() / "matrixone"))).expanduser().resolve()
RELEASE_WORKTREE = Path(os.environ.get("MO_DEMO_RELEASE_DIR", str(SOURCE_REPO.parent / "matrixone-v4.2.4-demo"))).expanduser().resolve()
RUNTIME = ROOT / "runtime"
FIXTURES = RUNTIME / "fixtures"
STATE_FILE = RUNTIME / "state.json"
PID_FILE = RUNTIME / "mo.pid"
MO_PORT = int(os.environ.get("MO_DEMO_PORT", "16042"))
WEB_PORT = int(os.environ.get("MO_DEMO_WEB_PORT", "8042"))
VERSION = "v4.2.4"
SERVER_BUILD = hashlib.sha256(b"".join(
    (ROOT / name).read_bytes() for name in ("demo.py", "cases.py")
)).hexdigest()
LOCK = threading.RLock()
EXEC_LOCK = threading.Lock()
STEP_ORDER = ("start", "prepare", "schema", "ingest", "clone", "ci", "search", "release", "operate", "recover", "pubsub", "iceberg", "cdc")
WEB_ASSETS = {
    "index.html", "capability.html", "demo.html", "lab.html", "evidence.html",
    "site.css", "editorial.css", "explorers.css", "design.css", "ingest-chapters.css", "catalog.js", "content.js", "topics.js", "readings.js", "explorers.js", "ingest-chapters.js", "step-explainers.js", "pitr.js", "iceberg.js", "iceberg-content.js", "sample-insights.json", "common.js", "home.js", "capability.js",
    "case-runner.js", "demo-page.js", "lab.js", "evidence.js", "NotoSansCJKsc-Regular.woff2",
}

PRODUCTS = [
    (1, "GAN-65", "Travel GaN Charger 65W", "Compact charger for three devices on business trips", "travel", "299.00", 24),
    (2, "ADP-3", "Multiport Travel Adapter", "Universal adapter for international journeys", "travel", "139.00", 18),
    (3, "KEY-RGB", "Gaming Mechanical Keyboard", "Low latency keyboard with quiet switches", "gaming", "459.00", 12),
    (4, "EAR-BT", "Bluetooth Earbuds", "Wireless audio with noise reduction", "audio", "329.00", 20),
    (5, "CUP-01", "Ceramic Coffee Cup", "Handmade cup for home coffee", "home", "89.00", 30),
    (6, "PWR-20", "Portable Power Bank", "Lightweight battery for charging while travelling", "travel", "199.00", 16),
    (7, "BAD-00", "Broken Supplier Row", "Rejected by the quality gate", "travel", "-8.00", 2),
]
VECTORS = {
    1: "[0.98,0.06,0.02,0.00]",
    2: "[0.88,0.15,0.03,0.00]",
    3: "[0.05,0.95,0.05,0.00]",
    4: "[0.10,0.05,0.95,0.00]",
    5: "[0.02,0.02,0.05,0.98]",
    6: "[0.89,0.09,0.02,0.00]",
}
INTENTS = {
    "travel": ("Travel charging", "[0.95,0.08,0.02,0.00]"),
    "gaming": ("Quiet gaming setup", "[0.04,0.98,0.03,0.00]"),
    "audio": ("Wireless listening", "[0.07,0.05,0.97,0.00]"),
}


class DemoError(RuntimeError):
    pass


def command(args: list[str], *, cwd: Path | None = None, timeout: int = 180, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise DemoError(f"{' '.join(args[:3])} failed ({result.returncode}): {detail[-1400:]}")
    return result.stdout.strip()


def mysql(sql: str, *, user: str = "root", password: str | None = None, port: int = MO_PORT, timeout: int = 120) -> list[list[str]]:
    args = [
        "mysql", "--skip-ssl", "--protocol=tcp", "--connect-timeout=5",
        "-h", "127.0.0.1", "-P", str(port), "-u", user,
        "--batch", "--raw", "--skip-column-names", "-e", sql,
    ]
    env = os.environ.copy()
    env["MYSQL_PWD"] = password if password is not None else os.environ.get("MO_DEMO_PASSWORD", "111")
    output = command(args, timeout=timeout, env=env)
    return [line.split("\t") for line in output.splitlines() if line]


def scalar(sql: str, **kwargs) -> str:
    rows = mysql(sql, **kwargs)
    return rows[0][0] if rows else ""


def demo_query(statement: str) -> dict:
    """Run one bounded, read-only SQL statement against the local demo service."""
    sql = statement.strip().rstrip(";").strip()
    if not sql or len(sql) > 3000 or ";" in sql or "--" in sql or "/*" in sql or "#" in sql:
        raise DemoError("请输入一条不含注释的 SELECT 或 SHOW 语句（最多 3000 字符）")
    if not re.match(r"^(SELECT|SHOW)\b", sql, re.I):
        raise DemoError("实验台只执行 SELECT 和 SHOW 查询")
    if re.search(r"\b(INTO|OUTFILE|DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK|INFORMATION_SCHEMA|MO_CATALOG|MYSQL)\b", sql, re.I):
        raise DemoError("这条查询超出演示数据范围")
    if not re.search(r"\b(demo_shop|demo_shop_ci|demo_ingest|demo_story_lake|demo_pitr_shop|partner_catalog)\b", sql, re.I) and not re.fullmatch(r"SELECT\s+VERSION\s*\(\s*\)", sql, re.I):
        raise DemoError("请查询 demo 数据库，或执行 SELECT VERSION()")
    if re.match(r"^SELECT\b", sql, re.I) and not re.fullmatch(r"SELECT\s+VERSION\s*\(\s*\)", sql, re.I):
        limit = re.search(r"\bLIMIT\s+(\d+)\s*$", sql, re.I)
        if limit:
            if int(limit.group(1)) > 100:
                sql = sql[:limit.start(1)] + "100"
        else:
            sql += " LIMIT 100"
    args = ["mysql", "--skip-ssl", "--protocol=tcp", "--connect-timeout=5", "-h", "127.0.0.1", "-P", str(MO_PORT), "-u", "root", "--batch", "--raw", "-e", sql]
    env = os.environ.copy()
    env["MYSQL_PWD"] = os.environ.get("MO_DEMO_PASSWORD", "111")
    output = command(args, timeout=30, env=env)
    lines = [line.split("\t") for line in output.splitlines()]
    columns = lines[0] if lines else []
    rows = lines[1:101]
    result = {"sql": sql + ";", "columns": columns, "rows": rows, "truncated": len(lines) > 101}
    event("query", "实验台执行 SQL", f"返回 {len(rows)} 行", complete=False, sql=sql + ";", result=f"{len(rows)} rows" + (" (first 100)" if result["truncated"] else ""))
    return result


def sql_file(name: str, **replacements: str) -> None:
    script = (ROOT / "sql" / name).read_text()
    for key, value in replacements.items():
        script = script.replace(f"__{key}__", value)
    mysql(script, timeout=300)


def initial_state() -> dict:
    return {"version": VERSION, "step": "welcome", "completed": [], "metrics": {}, "events": [], "evidence": [], "search": [], "last_order": None, "integrations": {}}


def load_state() -> dict:
    if not STATE_FILE.exists():
        return initial_state()
    return json.loads(STATE_FILE.read_text())


def save_state(state: dict) -> None:
    RUNTIME.mkdir(exist_ok=True)
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    temp.replace(STATE_FILE)


def event(step: str, title: str, detail: str, *, metrics: dict | None = None, complete: bool = True, data: dict | None = None, sql: str | None = None, result: str | None = None) -> dict:
    with LOCK:
        state = load_state()
        if complete:
            state["step"] = step
        if complete and step not in state["completed"]:
            state["completed"].append(step)
        if metrics:
            state["metrics"].update(metrics)
        if data:
            state.update(data)
        state["events"].append({"id": time.time_ns(), "at": datetime.now(timezone.utc).isoformat(), "step": step, "title": title, "detail": detail})
        state["events"] = state["events"][-240:]
        if sql:
            state.setdefault("evidence", []).append({"id": time.time_ns(), "step": step, "sql": sql, "result": result or detail})
            state["evidence"] = state["evidence"][-160:]
        save_state(state)
        return state


def release_dir() -> Path:
    path = RELEASE_WORKTREE
    if not path.is_dir():
        raise DemoError(f"Release worktree missing: {path}. Fetch v4.2.4 and set MO_DEMO_RELEASE_DIR.")
    tag = command(["git", "describe", "--tags", "--exact-match", "HEAD"], cwd=path)
    if tag != VERSION:
        raise DemoError(f"Expected {VERSION} worktree, found {tag} at {path}")
    return path


def step_bootstrap(*, record: bool = True) -> dict:
    """Prepare a detached v4.2.4 checkout and build its service binary."""
    source = SOURCE_REPO
    destination = RELEASE_WORKTREE
    if not (source / ".git").exists():
        raise DemoError(f"MatrixOne source repository missing: {source}. Set MO_DEMO_SOURCE_DIR.")
    if not destination.exists():
        tags = command(["git", "tag", "-l", VERSION], cwd=source)
        if VERSION not in tags.splitlines():
            command(["git", "fetch", "origin", "tag", VERSION], cwd=source, timeout=600)
        command(["git", "worktree", "add", "--detach", str(destination), VERSION], cwd=source, timeout=120)
    release_dir()
    if not (destination / "mo-service").is_file():
        RUNTIME.mkdir(parents=True, exist_ok=True)
        build_log = RUNTIME / "build.log"
        print(f"编译 MatrixOne；详细日志：{build_log}", flush=True)
        with build_log.open("w") as log:
            proc = subprocess.Popen(["make", "build"], cwd=destination, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                deadline = time.monotonic() + 3600
                while proc.poll() is None:
                    if time.monotonic() > deadline:
                        raise DemoError(f"编译超过 60 分钟，请检查 {build_log} 后重试")
                    try:
                        proc.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        print(f"仍在编译… tail -f {build_log}", flush=True)
                if proc.returncode:
                    raise DemoError(f"编译失败 ({proc.returncode})；查看 {build_log}")
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
    if record:
        return event("bootstrap", "v4.2.4 运行环境已准备", f"release worktree: {destination}", complete=False, metrics={"release_dir": str(destination)})
    return {"release_dir": str(destination)}


def port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def generate_config(source: Path) -> Path:
    config_dir = RUNTIME / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    data_dir = (RUNTIME / "mo-data").resolve()
    for name in ("log.toml", "tn.toml", "cn.toml"):
        contents = (source / "etc" / "launch" / name).read_text()
        contents = contents.replace('"./mo-data', f'"{data_dir}')
        if name == "cn.toml":
            if "[cn.frontend]" in contents:
                contents = re.sub(r"(\[cn\.frontend\]\s*\n)(?:port\s*=\s*\d+\s*\n)?", rf"\1port = {MO_PORT}\n", contents, count=1)
            else:
                marker = "[cn.frontend.iceberg]"
                addition = f"[cn.frontend]\nport = {MO_PORT}\n\n"
                contents = contents.replace(marker, addition + marker) if marker in contents else contents + "\n" + addition
        (config_dir / name).write_text(contents)
    launch = config_dir / "launch.toml"
    launch.write_text(
        f'logservices = ["{config_dir / "log.toml"}"]\n'
        f'tnservices = ["{config_dir / "tn.toml"}"]\n'
        f'cnservices = ["{config_dir / "cn.toml"}"]\n'
    )
    return launch


def step_start(*, record: bool = True) -> dict:
    try:
        source = release_dir()
    except DemoError:
        step_bootstrap(record=record)
        source = release_dir()
    binary = source / "mo-service"
    if not binary.is_file():
        step_bootstrap(record=record)
    if port_open(MO_PORT):
        version = scalar("SELECT VERSION()")
        if VERSION not in version:
            raise DemoError(f"Port {MO_PORT} is occupied by {version}; choose MO_DEMO_PORT")
        if not PID_FILE.exists():
            raise DemoError(f"Port {MO_PORT} has MatrixOne {VERSION}, but it was not started by this demo")
        pid = int(PID_FILE.read_text().strip())
        proc_cmd = Path(f"/proc/{pid}/cmdline")
        if not proc_cmd.exists() or str(RUNTIME / "config" / "launch.toml").encode() not in proc_cmd.read_bytes():
            raise DemoError(f"Port {MO_PORT} is not owned by the recorded demo process")
        if record:
            return event("start", "MatrixOne 已就绪", version, metrics={"mo_version": version, "mo_port": MO_PORT}, sql="SELECT VERSION();", result=version)
        return {"mo_version": version, "mo_port": MO_PORT}
    launch = generate_config(source)
    log_path = RUNTIME / "mo.log"
    runtime_env = {**os.environ, "MO_ICEBERG_ALLOW_PLAIN_HTTP": "1"}
    library_roots = [str(source / "cgo"), str(source / "thirdparties" / "install" / "lib")]
    if runtime_env.get("LD_LIBRARY_PATH"):
        library_roots.append(runtime_env["LD_LIBRARY_PATH"])
    runtime_env["LD_LIBRARY_PATH"] = os.pathsep.join(library_roots)
    with log_path.open("a") as log:
        proc = subprocess.Popen([str(binary), "-launch", str(launch)], cwd=source, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=runtime_env)
    PID_FILE.write_text(str(proc.pid))
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise DemoError(f"MatrixOne exited ({proc.returncode}). See {log_path}")
        if port_open(MO_PORT):
            try:
                version = scalar("SELECT VERSION()")
                if VERSION not in version:
                    raise DemoError(f"Wrong MatrixOne version: {version}")
                if record:
                    return event("start", "MatrixOne 4.2.4 已启动", f"127.0.0.1:{MO_PORT}", metrics={"mo_version": version, "mo_port": MO_PORT}, sql="SELECT VERSION();", result=version)
                return {"mo_version": version, "mo_port": MO_PORT}
            except DemoError:
                pass
        time.sleep(2)
    raise DemoError(f"MatrixOne startup timed out. See {log_path}")


def step_stop() -> None:
    if not PID_FILE.exists():
        raise DemoError("No demo-owned MatrixOne PID file")
    pid = int(PID_FILE.read_text().strip())
    cmdline = Path(f"/proc/{pid}/cmdline")
    if not cmdline.exists() or str(RUNTIME / "config" / "launch.toml").encode() not in cmdline.read_bytes():
        raise DemoError(f"PID {pid} is not this demo's MatrixOne process")
    os.killpg(pid, signal.SIGTERM)
    deadline = time.monotonic() + 30
    while cmdline.exists() and cmdline.read_bytes():
        if time.monotonic() > deadline:
            raise DemoError(f"MatrixOne PID {pid} 尚未退出；查看 {RUNTIME / 'mo.log'}")
        time.sleep(0.2)
    PID_FILE.unlink()
    event("stop", "Demo MatrixOne 已停止", f"PID {pid}", complete=False)


def write_docx(path: Path) -> None:
    paragraph = (
        "Travel GaN Charger 65W manual. Compact three-device fast charging for business travel. "
        "The warranty covers manufacturing defects for twenty four months. "
        "Use the USB C port for laptops and the USB A port for accessories."
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body><w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p></w:body></w:document>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", xml)


def step_prepare() -> dict:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with (FIXTURES / "products.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["product_id", "sku", "name", "description", "category", "price", "stock"])
        writer.writerows(PRODUCTS)
    write_docx(FIXTURES / "travel_charger.docx")
    return event("prepare", "供应商数据已准备", "7 行 CSV、1 份 DOCX；其中 1 行价格无效", metrics={"supplier_rows": len(PRODUCTS), "fixture_path": str(FIXTURES)})


def require_version() -> None:
    version = scalar("SELECT VERSION()")
    if VERSION not in version:
        raise DemoError(f"Demo requires {VERSION}; connected to {version} on port {MO_PORT}")


def step_schema() -> dict:
    require_version()
    if not (FIXTURES / "products.csv").exists():
        raise DemoError("Run prepare first")
    if any("demo_orders_cdc" in row for row in mysql("SHOW CDC ALL")):
        mysql("DROP CDC TASK demo_orders_cdc")
    sql_file("01_schema.sql", DATA_DIR=str(FIXTURES.resolve()))
    external = int(scalar("SELECT COUNT(*) FROM demo_ingest.supplier_feed"))
    rejected = int(scalar("SELECT COUNT(*) FROM demo_ingest.quality_issues"))
    if external != len(PRODUCTS) or rejected != 1:
        raise DemoError(f"Unexpected external table result: rows={external}, rejected={rejected}")
    old = load_state()
    reset = initial_state()
    reset["completed"] = [step for step in old["completed"] if step in ("start", "prepare")]
    reset["metrics"] = {key: value for key, value in old["metrics"].items() if key in ("supplier_rows", "fixture_path", "mo_version", "mo_port")}
    save_state(reset)
    schema_sql = (ROOT / "sql" / "01_schema.sql").read_text().replace("__DATA_DIR__", str(FIXTURES.resolve()))
    return event("schema", "Stage、外表和业务表已建立", f"外表读取 {external} 行，质量表记录 {rejected} 行异常", metrics={"external_rows": external, "rejected_rows": rejected}, sql=schema_sql + "\nSELECT COUNT(*) FROM demo_ingest.supplier_feed;\nSELECT COUNT(*) FROM demo_ingest.quality_issues;", result=f"supplier_feed: {external} rows · quality_issues: {rejected} row")


def step_ingest(large_rows: int = 1000000) -> dict:
    require_version()
    if not 1000 <= large_rows <= 5000000:
        raise DemoError("--rows must be between 1,000 and 5,000,000")
    if "ingest" in load_state()["completed"]:
        existing = int(scalar("SELECT COUNT(*) FROM demo_shop.orders"))
        return event("ingest", "ETL 数据已存在", f"当前订单表 {existing:,} 行", metrics={"orders": existing})
    sql_file("02_task.sql")
    deadline = time.monotonic() + 60
    task_status = ""
    while time.monotonic() < deadline:
        task_status = scalar("SELECT status FROM mo_task.sql_task_run WHERE task_name='demo_load_catalog' ORDER BY run_id DESC LIMIT 1")
        if task_status == "FAILED" or (task_status == "SUCCESS" and int(scalar("SELECT COUNT(*) FROM demo_shop.products")) == 6):
            break
        time.sleep(1)
    if task_status != "SUCCESS" or int(scalar("SELECT COUNT(*) FROM demo_shop.products")) != 6:
        raise DemoError(f"Catalog task did not load six products: {task_status or 'no run'}")
    vector_sql = []
    for product_id, vector in VECTORS.items():
        statement = f"UPDATE demo_shop.products SET embedding='{vector}' WHERE product_id={product_id}"
        mysql(statement)
        vector_sql.append(statement + ";")
    document_sql = "INSERT INTO demo_shop.product_docs VALUES (1, 1, 'stage://demo_supplier/travel_charger.docx')"
    mysql(document_sql)
    orders_sql = (
        "INSERT INTO demo_shop.orders "
        "SELECT result, 1 + (result % 6), 1, 99.00, '2026-09-01 10:00:00' "
        f"FROM generate_series(1, {large_rows}) g"
    )
    mysql(orders_sql, timeout=600)
    products = int(scalar("SELECT COUNT(*) FROM demo_shop.products"))
    orders = int(scalar("SELECT COUNT(*) FROM demo_shop.orders"))
    if products != 6 or orders != large_rows:
        raise DemoError(f"Unexpected ingestion totals: products={products}, orders={orders}")
    task_rows_affected = int(scalar("SELECT rows_affected FROM mo_task.sql_task_run WHERE task_name='demo_load_catalog' ORDER BY run_id DESC LIMIT 1"))
    task_sql = (ROOT / "sql" / "02_task.sql").read_text()
    evidence_sql = (task_sql + "\nSHOW TASK RUNS FOR demo_load_catalog LIMIT 1;\n"
                    "-- 以下是任务外的演示数据准备\n" + "\n".join(vector_sql) + "\n"
                    + document_sql + ";\n" + orders_sql + ";\nSELECT COUNT(*) FROM demo_shop.orders;")
    return event("ingest", "SQL Task 已导入商品，订单基线另行生成", f"Task {task_status}、影响 {task_rows_affected} 行商品；独立生成 {orders:,} 行订单", metrics={"products": products, "orders": orders, "task_status": task_status, "task_rows_affected": task_rows_affected}, sql=evidence_sql, result=f"Task: {task_status} · products inserted: {task_rows_affected} · separate orders: {orders:,}")


def step_clone() -> dict:
    require_version()
    source_rows = int(scalar("SELECT COUNT(*) FROM demo_shop.orders"))
    mysql("DROP DATABASE IF EXISTS demo_shop_ci; DROP SNAPSHOT IF EXISTS demo_promo_base; CREATE SNAPSHOT demo_promo_base FOR DATABASE demo_shop")
    start = time.monotonic()
    mysql("CREATE DATABASE demo_shop_ci CLONE demo_shop {snapshot = 'demo_promo_base'}", timeout=300)
    elapsed_ms = round((time.monotonic() - start) * 1000)
    clone_rows = int(scalar("SELECT COUNT(*) FROM demo_shop_ci.orders"))
    if source_rows != clone_rows:
        raise DemoError(f"Clone row mismatch: {source_rows} vs {clone_rows}")
    state = load_state()
    state["completed"] = [step for step in state["completed"] if step in ("start", "prepare", "schema", "ingest")]
    state["integrations"] = {}
    save_state(state)
    return event("clone", "真实订单库已 Clone", f"{source_rows:,} 行，创建耗时 {elapsed_ms:,} ms", metrics={"source_rows": source_rows, "clone_rows": clone_rows, "clone_ms": elapsed_ms}, sql="CREATE SNAPSHOT demo_promo_base FOR DATABASE demo_shop;\nCREATE DATABASE demo_shop_ci CLONE demo_shop {snapshot = 'demo_promo_base'};\nSELECT COUNT(*) FROM demo_shop.orders;\nSELECT COUNT(*) FROM demo_shop_ci.orders;", result=f"source: {source_rows:,} · clone: {clone_rows:,} · {elapsed_ms} ms")


def step_ci() -> dict:
    require_version()
    source_price = scalar("SELECT price FROM demo_shop.products WHERE product_id=1")
    mysql("UPDATE demo_shop_ci.products SET price=-1 WHERE product_id=1")
    failing = int(scalar("SELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0"))
    if failing != 1:
        raise DemoError(f"Expected one detected bad price, found {failing}")
    event("ci", "CI 发现错误折扣", "Clone 内有 1 件商品价格无效，源库保持原价", metrics={"ci_failed_rows": failing, "source_price": source_price}, complete=False, sql="UPDATE demo_shop_ci.products SET price=-1 WHERE product_id=1;\nSELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0;", result=f"CI FAIL · invalid rows: {failing}")
    mysql(f"UPDATE demo_shop_ci.products SET price=ROUND({source_price} * 0.9, 2) WHERE product_id=1")
    passing = int(scalar("SELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0"))
    unchanged = scalar("SELECT price FROM demo_shop.products WHERE product_id=1")
    if passing or unchanged != source_price:
        raise DemoError("CI correction or source isolation failed")
    return event("ci", "CI 校验通过", "修正折扣规则后全部价格有效，源库未被修改", metrics={"ci_failed_rows": 0, "source_price": source_price, "candidate_price": scalar("SELECT price FROM demo_shop_ci.products WHERE product_id=1")}, sql=f"UPDATE demo_shop_ci.products SET price=ROUND({source_price} * 0.9, 2) WHERE product_id=1;\nSELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0;\nSELECT price FROM demo_shop.products WHERE product_id=1;\nSELECT price FROM demo_shop_ci.products WHERE product_id=1;", result=f"source: {source_price} · candidate: {scalar('SELECT price FROM demo_shop_ci.products WHERE product_id=1')}")


def keyword_statement(term: str, database: str) -> str:
    if not re.fullmatch(r"[\w\u4e00-\u9fff -]{1,60}", term):
        raise DemoError("Keyword may contain letters, numbers, spaces or hyphens")
    return (
        f"SELECT product_id, name, price, stock, MATCH(name,description) AGAINST('{term}' IN NATURAL LANGUAGE MODE) AS score "
        f"FROM {database}.products WHERE MATCH(name,description) AGAINST('{term}' IN NATURAL LANGUAGE MODE) "
        "ORDER BY score DESC, product_id LIMIT 8"
    )


def search_keyword(term: str, *, database: str = "demo_shop_ci") -> list[dict]:
    rows = mysql(keyword_statement(term, database))
    return [dict(zip(("id", "name", "price", "stock", "score"), row)) for row in rows]


def vector_statement(intent: str, database: str) -> str:
    if intent not in INTENTS:
        raise DemoError(f"Unknown intent: {intent}")
    _, vector = INTENTS[intent]
    return (
        f"SELECT product_id, name, price, stock, ROUND(L2_DISTANCE(embedding, '{vector}'), 3) "
        f"FROM {database}.products WHERE stock>0 "
        f"ORDER BY L2_DISTANCE(embedding, '{vector}') ASC LIMIT 5"
    )


def search_vector(intent: str, *, database: str = "demo_shop_ci") -> list[dict]:
    rows = mysql(vector_statement(intent, database))
    return [dict(zip(("id", "name", "price", "stock", "distance"), row)) for row in rows]


def step_search() -> dict:
    require_version()
    ensure_search_indexes("demo_shop_ci")
    ensure_fulltext_examples()
    keywords = search_keyword("charger")
    vectors = search_vector("travel")
    documents = mysql("SELECT product_id FROM demo_shop_ci.product_docs WHERE MATCH(manual) AGAINST('warranty')")
    boolean = mysql("SELECT product_id FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('+charger' IN BOOLEAN MODE)")
    json_hits = mysql("SELECT product_id FROM demo_shop_ci.product_specs WHERE MATCH(details) AGAINST('GaN')")
    if not keywords or not vectors or not documents or not boolean or not json_hits:
        raise DemoError(f"Search evidence missing: keyword={len(keywords)}, vector={len(vectors)}, docs={len(documents)}, boolean={len(boolean)}, json={len(json_hits)}")
    results = {"mode": "keyword", "query": "charger", "rows": keywords}
    return event("search", "全文、向量与文档检索已验证", f"自然语言 {len(keywords)}、布尔 {len(boolean)}、JSON {len(json_hits)}、向量 {len(vectors)}、说明书 {len(documents)}", metrics={"keyword_hits": len(keywords), "boolean_hits": len(boolean), "json_hits": len(json_hits), "vector_hits": len(vectors), "document_hits": len(documents)}, data={"search": results}, sql=f"CREATE FULLTEXT INDEX ft_products ON demo_shop_ci.products (name, description);\nCREATE FULLTEXT INDEX ft_specs ON demo_shop_ci.product_specs(details) WITH PARSER json;\nCREATE INDEX vec_products USING IVFFLAT ON demo_shop_ci.products(embedding) LISTS=3 OP_TYPE 'vector_l2_ops';\n{keyword_statement('charger', 'demo_shop_ci')};\n{vector_statement('travel', 'demo_shop_ci')};\nSELECT product_id FROM demo_shop_ci.product_specs WHERE MATCH(details) AGAINST('GaN');\nSELECT product_id FROM demo_shop_ci.product_docs WHERE MATCH(manual) AGAINST('warranty');", result=f"natural: {len(keywords)} · boolean: {len(boolean)} · JSON: {len(json_hits)} · vector: {len(vectors)} · DATALINK: {len(documents)}")


def step_release() -> dict:
    require_version()
    if int(scalar("SELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0")):
        raise DemoError("CI is not green")
    approved_price = scalar("SELECT price FROM demo_shop_ci.products WHERE product_id=1")
    mysql(f"UPDATE demo_shop.products SET price={approved_price} WHERE product_id=1")
    ensure_search_indexes("demo_shop")
    return event("release", "已应用通过验收的变更", "正式库获得折扣规则和搜索索引", metrics={"live_price": scalar("SELECT price FROM demo_shop.products WHERE product_id=1")}, sql=f"UPDATE demo_shop.products SET price={approved_price} WHERE product_id=1;\nCREATE FULLTEXT INDEX ft_products ON demo_shop.products (name, description);\nCREATE INDEX vec_products USING IVFFLAT ON demo_shop.products(embedding) LISTS=3 OP_TYPE 'vector_l2_ops';\nSELECT price FROM demo_shop.products WHERE product_id=1;\nSHOW INDEX FROM demo_shop.products;", result=f"live price: {approved_price} · fulltext + vector indexes ready")


def ensure_search_indexes(database: str) -> None:
    existing = {row[2] for row in mysql(f"SHOW INDEX FROM {database}.products")}
    if "ft_products" not in existing:
        mysql(f"CREATE FULLTEXT INDEX ft_products ON {database}.products (name, description)", timeout=300)
    if "vec_products" not in existing:
        mysql(f"CREATE INDEX vec_products USING IVFFLAT ON {database}.products(embedding) LISTS=3 OP_TYPE 'vector_l2_ops'", timeout=300)


def ensure_fulltext_examples() -> None:
    mysql("CREATE TABLE IF NOT EXISTS demo_shop_ci.product_specs (product_id BIGINT PRIMARY KEY, details JSON)")
    mysql("INSERT IGNORE INTO demo_shop_ci.product_specs VALUES "
          "(1, '{\"technology\":\"GaN\",\"ports\":\"USB-C\"}'),"
          "(2, '{\"technology\":\"adapter\",\"ports\":\"AC\"}'),"
          "(3, '{\"technology\":\"battery\",\"ports\":\"USB-C\"}')")
    if "ft_specs" not in {row[2] for row in mysql("SHOW INDEX FROM demo_shop_ci.product_specs")}:
        mysql("CREATE FULLTEXT INDEX ft_specs ON demo_shop_ci.product_specs(details) WITH PARSER json", timeout=300)


def vector_health(action: str) -> dict:
    """Build a representative IVF sample, then inspect real index buckets."""
    if "search" not in load_state().get("completed", []):
        raise DemoError("请先完成全文、向量与文档检索章节")
    table = "demo_shop_ci.ivf_health_docs"
    if not mysql("SHOW TABLES FROM demo_shop_ci LIKE 'ivf_health_docs'"):
        mysql(f"CREATE TABLE {table} (id BIGINT PRIMARY KEY, embedding VECF32(4))")
    count = int(scalar(f"SELECT COUNT(*) FROM {table}"))
    if count == 0:
        rng = random.Random(42)
        for offset in range(0, 1200, 100):
            values = []
            for number in range(offset + 1, offset + 101):
                vector = ",".join(f"{rng.random():.6f}" for _ in range(4))
                values.append(f"({number},'[{vector}]')")
            mysql(f"INSERT INTO {table} VALUES " + ",".join(values), timeout=180)
    elif count != 1200:
        raise DemoError(f"健康度样本只有 {count} 行；请检查演示专用表 {table}")
    indexes = {row[2] for row in mysql(f"SHOW INDEX FROM {table}")}
    if "idx_embedding_ivf" not in indexes:
        mysql(f"CREATE INDEX idx_embedding_ivf USING IVFFLAT ON {table}(embedding) LISTS=16 OP_TYPE 'vector_l2_ops'", timeout=300)
    if action == "rebuild":
        mysql(f"ALTER TABLE {table} ALTER REINDEX idx_embedding_ivf IVFFLAT LISTS=32", timeout=300)
    elif action != "check":
        raise DemoError("Unknown IVF health action")
    index_rows = mysql(
        "SELECT i.algo_table_type, i.index_table_name FROM mo_catalog.mo_indexes i "
        "JOIN mo_catalog.mo_tables t ON i.table_id=t.rel_id "
        "WHERE i.column_name='embedding' AND t.relname='ivf_health_docs' "
        "AND t.reldatabase='demo_shop_ci' AND i.algo='ivfflat'"
    )
    tables = {kind: name for kind, name in index_rows}
    if "entries" not in tables or "centroids" not in tables:
        raise DemoError("IVF index tables are not available")
    entries, centroids = tables["entries"], tables["centroids"]
    counts_sql = (
        f"SELECT __mo_index_centroid_fk_id AS centroid_id, COUNT(*) AS vectors "
        f"FROM demo_shop_ci.`{entries}` GROUP BY __mo_index_centroid_fk_id "
        "ORDER BY centroid_id"
    )
    counts = {int(row[0]): int(row[1]) for row in mysql(counts_sql)}
    ids = [int(row[0]) for row in mysql(f"SELECT __mo_index_centroid_id FROM demo_shop_ci.`{centroids}` ORDER BY __mo_index_centroid_id")]
    distribution = [[centroid, counts.get(centroid, 0)] for centroid in ids]
    nonzero = [value for _, value in distribution if value]
    balance = round(max(nonzero) / min(nonzero), 2) if nonzero else None
    indexed = sum(counts.values())
    if indexed != 1200:
        raise DemoError(f"IVF indexed {indexed} vectors; expected 1200")
    result = {
        "rows": distribution, "columns": ["centroid_id", "vectors"],
        "vectors": indexed, "centroids": len(ids),
        "empty_centroids": len(ids) - len(nonzero), "balance_ratio": balance,
        "lists": int(json.loads(next(row[13] for row in mysql(f"SHOW INDEX FROM {table}") if row[2] == "idx_embedding_ivf"))["lists"]),
        "sql": counts_sql + ";",
    }
    event("search", "IVF 索引健康度" if action == "check" else "IVF 索引重建与复查",
          f"{indexed} 个向量、{len(ids)} 个聚类中心、空中心 {result['empty_centroids']}、负载比 {balance}",
          complete=False, sql=(f"ALTER TABLE {table} ALTER REINDEX idx_embedding_ivf IVFFLAT LISTS=32;\n" if action == "rebuild" else "") + result["sql"],
          result=f"vectors={indexed}, centroids={len(ids)}, empty={result['empty_centroids']}, balance={balance}")
    return result


def report() -> dict:
    rows = mysql("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM demo_shop.orders")
    return {"orders": int(rows[0][0]), "revenue": str(rows[0][1])}


def place_order(product_id: int, qty: int) -> dict:
    require_version()
    if product_id not in VECTORS or not 1 <= qty <= 5:
        raise DemoError("Choose product 1-6 and quantity 1-5")
    rows = mysql(f"SELECT price, stock, name FROM demo_shop.products WHERE product_id={product_id}")
    if not rows or int(rows[0][1]) < qty:
        raise DemoError("Insufficient stock")
    from decimal import Decimal
    amount = Decimal(rows[0][0]) * qty
    order_id = int(scalar("SELECT COALESCE(MAX(order_id),0)+1 FROM demo_shop.orders"))
    mysql(
        "START TRANSACTION; "
        f"UPDATE demo_shop.products SET stock=stock-{qty} WHERE product_id={product_id}; "
        f"INSERT INTO demo_shop.orders VALUES ({order_id}, {product_id}, {qty}, {amount}, CURRENT_TIMESTAMP()); "
        "COMMIT;"
    )
    latest = report()
    payload = {"id": order_id, "product_id": product_id, "product": rows[0][2], "qty": qty, "amount": str(amount), "stock_after": int(scalar(f"SELECT stock FROM demo_shop.products WHERE product_id={product_id}"))}
    first_order = "operate" not in load_state()["completed"]
    event("operate", "新订单已提交", f"订单 #{order_id}，金额 {amount}；报表现有 {latest['orders']:,} 单", metrics={"live_orders": latest["orders"], "revenue": latest["revenue"]}, data={"last_order": payload}, complete=first_order, sql=f"START TRANSACTION;\nUPDATE demo_shop.products SET stock=stock-{qty} WHERE product_id={product_id};\nINSERT INTO demo_shop.orders VALUES ({order_id}, {product_id}, {qty}, {amount}, CURRENT_TIMESTAMP());\nCOMMIT;\nSELECT COUNT(*), COALESCE(SUM(amount),0) FROM demo_shop.orders;", result=f"order #{order_id} · count {latest['orders']:,} · revenue ¥{latest['revenue']}")
    return {"order": payload, "report": latest}


def step_operate() -> dict:
    before = report()
    result = place_order(1, 1)
    if result["report"]["orders"] != before["orders"] + 1:
        raise DemoError("HTAP order count did not advance")
    return load_state()


def step_pubsub() -> dict:
    require_version()
    mysql("DROP PUBLICATION IF EXISTS demo_catalog; DROP ACCOUNT IF EXISTS demo_partner")
    mysql("CREATE ACCOUNT demo_partner ADMIN_NAME 'admin' IDENTIFIED BY 'demo123'")
    mysql("CREATE PUBLICATION demo_catalog DATABASE demo_shop TABLE products ACCOUNT demo_partner")
    mysql("CREATE DATABASE partner_catalog FROM sys PUBLICATION demo_catalog", user="demo_partner:admin", password="demo123")
    count = int(scalar("SELECT COUNT(*) FROM partner_catalog.products", user="demo_partner:admin", password="demo123"))
    if count != len(VECTORS):
        raise DemoError(f"Subscriber saw {count} products, expected {len(VECTORS)}")
    state = load_state()
    integrations = state["integrations"]
    integrations["pubsub"] = {"account": "demo_partner", "products": count}
    return event("pubsub", "合作伙伴已订阅商品目录", f"独立账号读取 {count} 件商品", metrics={"subscribed_products": count}, data={"integrations": integrations}, sql="CREATE PUBLICATION demo_catalog DATABASE demo_shop TABLE products ACCOUNT demo_partner;\nCREATE DATABASE partner_catalog FROM sys PUBLICATION demo_catalog;\nSELECT COUNT(*) FROM partner_catalog.products;", result=f"subscriber account: demo_partner · products: {count}")


def snapshot_recovery() -> dict:
    """Actually drop a report table and restore it from a MatrixOne snapshot."""
    require_version()
    mysql("DROP SNAPSHOT IF EXISTS demo_before_accident; DROP TABLE IF EXISTS demo_shop.promo_kpis")
    mysql("CREATE TABLE demo_shop.promo_kpis (metric VARCHAR(40) PRIMARY KEY, metric_value BIGINT)")
    mysql(
        "INSERT INTO demo_shop.promo_kpis VALUES "
        f"('orders', {scalar('SELECT COUNT(*) FROM demo_shop.orders')}), "
        f"('products', {scalar('SELECT COUNT(*) FROM demo_shop.products')})"
    )
    before = mysql("SELECT metric, metric_value FROM demo_shop.promo_kpis ORDER BY metric")
    mysql("CREATE SNAPSHOT demo_before_accident FOR DATABASE demo_shop")
    event("recover", "事故模拟：误删经营报表", "已保留删除前快照，开始执行 DROP TABLE", metrics={"recovery_phase": "dropping", "recovery_rows_before": len(before)}, complete=False, sql="CREATE SNAPSHOT demo_before_accident FOR DATABASE demo_shop;", result=f"snapshot ready · {len(before)} metrics")
    mysql("DROP TABLE demo_shop.promo_kpis")
    try:
        mysql("SELECT COUNT(*) FROM demo_shop.promo_kpis")
    except DemoError:
        event("recover", "报表查询失败", "demo_shop.promo_kpis 已不存在，使用快照恢复", metrics={"recovery_phase": "missing"}, complete=False, sql="DROP TABLE demo_shop.promo_kpis;\nSELECT COUNT(*) FROM demo_shop.promo_kpis;", result="ERROR · table does not exist")
    else:
        raise DemoError("The accidental DROP was not observed")
    mysql('RESTORE TABLE demo_shop.promo_kpis{snapshot="demo_before_accident"}', timeout=300)
    after = mysql("SELECT metric, metric_value FROM demo_shop.promo_kpis ORDER BY metric")
    if before != after:
        raise DemoError(f"Recovered table differs from snapshot: {before} vs {after}")
    return event("recover", "快照对照：报表恢复完成", f"快照恢复 {len(after)} 项指标", complete=False, data={"snapshot_recovery": after}, metrics={"recovery_phase": "restored", "recovery_rows_after": len(after), "recovered_orders": int(after[0][1])}, sql='RESTORE TABLE demo_shop.promo_kpis{snapshot="demo_before_accident"};\nSELECT metric, metric_value FROM demo_shop.promo_kpis ORDER BY metric;', result=" · ".join(f"{key}: {value}" for key, value in after))



def step_recover() -> dict:
    pitr_lab("prepare")
    result = pitr_lab("restore_good")
    return event("recover", "PITR：误删价格表恢复完成", "提前开启保留窗口，误删后按事故前时间找回六件商品，逐列匹配名称与价格",
                 metrics={"pitr_rows": len(result["rows"]), "pitr_status": "good"},
                 sql=result["restore_sql"] + "\n" + result["sql"],
                 result=f"PITR · {result['good_at']} · 6 rows · all prices match")


def pitr_lab(action: str) -> dict:
    """Restore a demo-only database to two observed, server-local time points."""
    require_version()
    if "ingest" not in load_state()["completed"]:
        raise DemoError("先完成 SQL Task 入库，再演练 PITR")
    query = "SELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id"
    if action == "prepare":
        # Clear old evidence before replacing the policy that backed its time points.
        event("recover", "PITR：建立独立演练库", "为 demo_pitr_shop 创建一小时保留策略", complete=False,
              data={"pitr": None}, metrics={"pitr_status": "preparing", "pitr_rows": 0})
        setup = ("DROP PITR IF EXISTS demo_price_history; DROP DATABASE IF EXISTS demo_pitr_shop; "
                 "CREATE DATABASE demo_pitr_shop; "
                 "CREATE PITR demo_price_history FOR DATABASE demo_pitr_shop RANGE 1 'h'; "
                 "CREATE TABLE demo_pitr_shop.prices(product_id BIGINT PRIMARY KEY,name VARCHAR(120),price DECIMAL(10,2)); "
                 "INSERT INTO demo_pitr_shop.prices SELECT product_id,name,price FROM demo_shop.products;")
        mysql(setup)
        before = mysql(query)
        if len(before) != 6 or any(float(row[2]) <= 0 for row in before):
            raise DemoError("PITR 演练需要六件价格有效的商品")
        # v4.2.4 RESTORE parses second-precision server-local time, so keep the
        # captured second strictly between committed states, beyond policy creation.
        time.sleep(1.2)
        good = scalar("SELECT NOW()").split(".")[0]
        time.sleep(1.2)
        mysql("UPDATE demo_pitr_shop.prices SET price=0")
        damaged = mysql(query)
        time.sleep(1.2)
        bad = scalar("SELECT NOW()").split(".")[0]
        time.sleep(1.2)
        mysql("DROP TABLE demo_pitr_shop.prices")
        try:
            mysql(query)
        except DemoError as exc:
            missing = str(exc)
        else:
            raise DemoError("PITR 演练的 DROP TABLE 未生效")
        policy = mysql("SHOW PITR WHERE pitr_name='demo_price_history'")
        data = {"good_at": good, "bad_at": bad, "before": before, "damaged": damaged,
                "rows": [], "phase": "missing", "policy": policy, "missing_error": missing,
                "timezone": scalar("SELECT @@system_time_zone"), "sql": query + ";",
                "restore_sql": f"RESTORE DATABASE demo_pitr_shop FROM PITR demo_price_history '{good}';"}
        event("recover", "PITR：误改后又误删表", "六件商品先被改为零价，再 DROP TABLE；正常与错误两个时间点已记录", complete=False,
              data={"pitr": data}, metrics={"pitr_status": "missing", "pitr_rows": 0},
              sql=setup + f"\n-- 正常时间点：{good}\nUPDATE demo_pitr_shop.prices SET price=0;\n-- 错误时间点：{bad}\nDROP TABLE demo_pitr_shop.prices;\n" + query + ";",
              result="正常：6 行有效价格 → 误改：6 行零价 → 误删：表不存在")
        return data
    if action not in ("restore_good", "restore_bad", "inspect", "snapshot"):
        raise DemoError("Unknown PITR action")
    data = load_state().get("pitr")
    if not data:
        raise DemoError("先创建 PITR 演练数据与时间点")
    if action == "snapshot":
        snapshot_recovery()
        data["snapshot_rows"] = load_state()["snapshot_recovery"]
        state = load_state()
        state["pitr"] = data
        save_state(state)
        return data
    if action == "inspect":
        data["policy"] = mysql("SHOW PITR WHERE pitr_name='demo_price_history'")
        tables = mysql("SHOW TABLES FROM demo_pitr_shop")
        if ["prices"] not in tables:
            data.update(rows=[], phase="missing")
            try:
                mysql(query)
            except DemoError as exc:
                data["missing_error"] = str(exc)
        else:
            rows = mysql(query)
            data.update(rows=rows, phase="good" if rows == data["before"] else "bad" if rows == data["damaged"] else "changed")
        state = load_state()
        state["pitr"] = data
        save_state(state)
        return data
    good = action == "restore_good"
    timestamp = data["good_at" if good else "bad_at"]
    statement = f"RESTORE DATABASE demo_pitr_shop FROM PITR demo_price_history '{timestamp}'"
    mysql(statement, timeout=300)
    rows = mysql(query)
    expected = data["before" if good else "damaged"]
    if rows != expected:
        raise DemoError(f"PITR 恢复结果与所选时间点不符：{rows}")
    data.update(rows=rows, phase="good" if good else "bad", restore_sql=statement + ";", sql=query + ";")
    event("recover", "PITR：恢复到" + ("正常价格" if good else "错误价格"),
          f"恢复时间 {timestamp}；逐列匹配 {len(rows)} 件商品，" + ("价格全部有效" if good else "价格全部为零，说明时间点选择决定业务结果"),
          complete=False, data={"pitr": data}, metrics={"pitr_status": data["phase"], "pitr_rows": len(rows)},
          sql=statement + ";\n" + query + ";", result=f"{timestamp} · {len(rows)} rows · exact match: {data['phase']}")
    return data


ICEBERG_PHASES = ("services", "lake", "mapping", "write", "history", "append")
ICEBERG_URI = "http://127.0.0.1:19120/iceberg"
ICEBERG_WAREHOUSE = "s3://mo-iceberg/warehouse"


def lake_http(path: str, body: dict | None = None, *, storage: bool = False, allow_conflict: bool = False) -> dict | bytes:
    """Only contact the two local tutorial services; never expose returned credentials."""
    base = "http://127.0.0.1:9000" if storage else "http://127.0.0.1:19120"
    request = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type": "application/json"})
    try:
        with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
            raw = response.read()
            return raw if storage else json.loads(raw) if raw else {}
    except (HTTPError, URLError) as exc:
        if allow_conflict and isinstance(exc, HTTPError) and exc.code == 409:
            return {}
        raise DemoError(f"Local Iceberg service: {exc}") from exc


def lake_path(data: dict, ref: str = "main") -> str:
    # Nessie's REST prefix is <catalog branch>|<warehouse>, not a table snapshot ID.
    prefix = quote(ref + "|" + ICEBERG_WAREHOUSE, safe="")
    return f"/iceberg/v1/{prefix}/namespaces/{data['namespace']}/tables/append_orders"


def lake_metadata(data: dict, ref: str = "main") -> dict:
    loaded = lake_http(lake_path(data, ref))
    metadata = loaded["metadata"]
    # Whitelist teaching fields. REST load responses can contain storage credentials.
    return {"location": metadata["location"], "metadata_location": loaded.get("metadata-location"),
            "snapshot_id": str(metadata["current-snapshot-id"]) if int(metadata.get("current-snapshot-id") or 0) > 0 else "",
            "snapshots": [{"id": str(row["snapshot-id"]), "manifest_list": row.get("manifest-list", ""),
                           "operation": row.get("summary", {}).get("operation", ""),
                           "added_records": row.get("summary", {}).get("added-records", "")}
                          for row in metadata.get("snapshots", [])],
            "fields": metadata["schemas"][0]["fields"]}


def lake_objects(metadata: dict) -> list:
    location = urlparse(metadata["location"])
    query = urlencode({"list-type": 2, "prefix": location.path.lstrip("/") + "/", "max-keys": 100})
    root = ET.fromstring(lake_http("/mo-iceberg?" + query, storage=True))
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    return [[row.findtext("s3:Key", namespaces=ns), int(row.findtext("s3:Size", namespaces=ns))]
            for row in root.findall("s3:Contents", ns)]


def iceberg_lab(action: str) -> dict:
    require_version()
    state = load_state()
    if "start" not in state["completed"]:
        raise DemoError("先启动 MatrixOne")
    data = state.get("iceberg_tutorial")
    if action == "inspect":
        if not data:
            raise DemoError("先从服务准备开始")
        if "lake" in data["completed"]:
            data["metadata"] = lake_metadata(data)
            data["objects"] = lake_objects(data["metadata"])
        if "write" in data["completed"]:
            data["current"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id")
        if "history" in data["completed"]:
            data["historic"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders_old ORDER BY order_id")
        state["iceberg_tutorial"] = data
        save_state(state)
        return data
    if action == "restart":
        # Restart the tutorial's own mapping, leaving historical object-store files intact.
        data = None
        action = "services"
    if action not in ICEBERG_PHASES:
        raise DemoError("Unknown Iceberg phase")
    completed = data["completed"] if data else []
    next_phase = next((name for name in ICEBERG_PHASES if name not in completed), None)
    if action != next_phase:
        raise DemoError(f"Next Iceberg phase: {next_phase or 'finished'}")
    sql = ""
    if action == "services":
        env = os.environ.copy()
        env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost"
        command(["make", "dev-up-iceberg-tier-a"], cwd=release_dir(), timeout=300, env=env)
        config = lake_http("/iceberg/v1/config?" + urlencode({"warehouse": ICEBERG_WAREHOUSE}))
        lake_http("/mo-iceberg?list-type=2&max-keys=1", storage=True)
        data = {"namespace": "demo_lake_" + uuid.uuid4().hex[:10], "completed": [], "records": [],
                "current": [], "historic": [], "objects": [], "prefix": config["defaults"]["prefix"]}
        code = "make dev-up-iceberg-tier-a\nGET /iceberg/v1/config?warehouse=s3://mo-iceberg/warehouse\nGET http://127.0.0.1:9000/mo-iceberg?list-type=2&max-keys=1"
        result = "MinIO bucket reachable · Nessie REST config returned"
    elif action == "lake":
        root = "/iceberg/v1/" + data["prefix"] + "/namespaces"
        namespace_body = {"namespace": [data["namespace"]], "properties": {"owner": "matrixone-demo"}}
        lake_http(root, namespace_body, allow_conflict=True)
        schema = {"type": "struct", "schema-id": 0, "fields": [
            {"id": 1, "name": "order_id", "required": True, "type": "long"},
            {"id": 2, "name": "bucket", "required": False, "type": "int"},
            {"id": 3, "name": "amount", "required": False, "type": "long"},
            {"id": 4, "name": "region", "required": False, "type": "string"}]}
        body = {"name": "append_orders", "stage-create": False, "schema": schema, "partition-spec": {"spec-id": 0, "fields": []},
                "location": ICEBERG_WAREHOUSE + "/" + data["namespace"] + "/append_orders",
                "properties": {"format-version": "2", "history.expire.min-snapshots-to-keep": "2"}}
        lake_http(root + "/" + data["namespace"] + "/tables", body, allow_conflict=True)
        data["metadata"] = lake_metadata(data)
        data["objects"] = lake_objects(data["metadata"])
        code = "POST " + root + "\n" + json.dumps(namespace_body, ensure_ascii=False, indent=2) + "\nPOST " + root + "/" + data["namespace"] + "/tables\n" + json.dumps(body, indent=2)
        result = "Iceberg 表已创建：四列定义，尚未写入订单"
    elif action == "mapping":
        sql = ("DROP DATABASE IF EXISTS demo_story_lake;\n"
               "CREATE DATABASE demo_story_lake;\n"
               f"CREATE ICEBERG CATALOG IF NOT EXISTS demo_story_ice WITH ('type'='rest','uri'='{ICEBERG_URI}','warehouse'='{ICEBERG_WAREHOUSE}','auth_mode'='none');\n"
               "CALL iceberg_register_access('demo_story_ice','scope=cluster,account_id=0,external_principal=ci-local,endpoint=localhost,region=us-east-1,bucket=mo-iceberg');\n"
               "CREATE EXTERNAL TABLE demo_story_lake.append_orders(order_id BIGINT,bucket INT,amount BIGINT,region TEXT) "
               f"ENGINE=ICEBERG WITH ('catalog'='demo_story_ice','namespace'='{data['namespace']}','table'='append_orders','ref'='main','read_mode'='append_only','write_mode'='append_only');")
        mysql(sql)
        data["mapping_ddl"] = mysql("SHOW CREATE TABLE demo_story_lake.append_orders")[0][1]
        try:
            data["current"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id")
        except DemoError as exc:
            if "ICEBERG_TABLE_NOT_FOUND" not in str(exc) or "snapshot ref" not in str(exc):
                raise
            data["empty_read_error"] = str(exc)
            data["current"] = []
        if data["current"]:
            raise DemoError("Expected newly mapped lake table to contain no orders")
        code = sql + "\nSHOW CREATE TABLE demo_story_lake.append_orders;"
        result = "映射已建立，尚无数据快照；本机 4.2.4 提前 SELECT 会报告 snapshot ref not found，下一步先写入"
    elif action == "write":
        # Guard retry after a lost response: do not append the deterministic rows twice.
        count = int(scalar("SELECT COUNT(*) FROM demo_story_lake.append_orders")) if lake_metadata(data)["snapshot_id"] else 0
        sql = "INSERT INTO demo_story_lake.append_orders VALUES (1,1,10,'ksa'),(2,1,20,'uae'),(3,2,30,'ksa'),(4,2,40,'qat');"
        if count == 0:
            mysql(sql)
        data["current"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id")
        if len(data["current"]) != 4 or sum(int(row[2]) for row in data["current"]) != 100:
            raise DemoError("First Iceberg write did not produce 4 rows / 100")
        data["metadata"] = lake_metadata(data)
        data["old_snapshot"] = data["metadata"]["snapshot_id"]
        data["objects"] = lake_objects(data["metadata"])
        data["first_objects"] = data["objects"]
        verify_sql = "SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;"
        if mysql(verify_sql) != [["4", "100"]]:
            raise DemoError("First Iceberg aggregate did not match 4 / 100")
        code = sql + "\nSELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id;\n" + verify_sql
        result = "MatrixOne 已写入湖表：4 行 / 金额 100；快照 " + data["old_snapshot"]
    elif action == "history":
        ref = lake_http("/api/v1/trees/tree/main")
        branch = "demo_before_append_" + data["namespace"].removeprefix("demo_lake_")
        body = {"type": "BRANCH", "name": branch, "hash": ref["hash"]}
        lake_http("/api/v1/trees/tree", body, allow_conflict=True)
        data["history_ref"] = branch
        data["history_metadata"] = lake_metadata(data, branch)
        sql = ("CREATE EXTERNAL TABLE IF NOT EXISTS demo_story_lake.append_orders_old(order_id BIGINT,bucket INT,amount BIGINT,region TEXT) "
               f"ENGINE=ICEBERG WITH ('catalog'='demo_story_ice','namespace'='{data['namespace']}','table'='append_orders','ref'='{branch}','read_mode'='append_only','write_mode'='append_only');")
        mysql(sql)
        data["historic"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders_old ORDER BY order_id")
        if data["historic"] != data["current"]:
            raise DemoError("Historical mapping did not preserve the first four orders")
        code = "GET /api/v1/trees/tree/main\nPOST /api/v1/trees/tree\n" + json.dumps(body, indent=2) + "\n\n-- MatrixOne SQL\n" + sql
        result = "Nessie 分支保存四行时的 Catalog 状态；第二个外表映射仍指向同一湖表"
    else:
        sql = "INSERT INTO demo_story_lake.append_orders VALUES (5,3,50,'ksa');"
        if not int(scalar("SELECT COUNT(*) FROM demo_story_lake.append_orders WHERE order_id=5")):
            mysql(sql)
        data["current"] = mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id")
        data["historic"] = mysql(f"SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders_old FOR ICEBERG SNAPSHOT {data['old_snapshot']} ORDER BY order_id")
        if [row[0] for row in data["current"]] != ['1','2','3','4','5'] or [row[0] for row in data["historic"]] != ['1','2','3','4']:
            raise DemoError("Iceberg current/history row IDs did not match")
        data["metadata"] = lake_metadata(data)
        data["objects"] = lake_objects(data["metadata"])
        verify_sql = "SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;\n" + f"SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders_old FOR ICEBERG SNAPSHOT {data['old_snapshot']};"
        if mysql(verify_sql) != [["5", "150"], ["4", "100"]]:
            raise DemoError("Iceberg current/history aggregates did not match")
        sql += "\n" + verify_sql
        code, result = sql, "main：5 行 / 150；历史分支：4 行 / 100；新增的是订单 #5 / 金额 50"
    data["completed"].append(action)
    data["records"].append({"phase": action, "code": code, "result": result})
    event("iceberg", "Iceberg：" + action, result, complete=False, data={"iceberg_tutorial": data},
          sql=code, result=result,
          metrics={"iceberg_current_rows": len(data["current"]), "iceberg_history_rows": len(data["historic"])})
    return data


def step_iceberg() -> dict:
    for phase in ICEBERG_PHASES:
        if phase not in (load_state().get("iceberg_tutorial") or {}).get("completed", []):
            iceberg_lab(phase)
    data = iceberg_lab("inspect")
    if len(data["current"]) != 5 or len(data["historic"]) != 4 or sum(int(row[2]) for row in data["current"]) != 150 or sum(int(row[2]) for row in data["historic"]) != 100:
        raise DemoError("Iceberg final totals differ from 5/150 and 4/100")
    mysql("SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders; SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders_old;")
    return event("iceberg", "从空湖表到当前与历史订单已验证", "服务、REST 建表、Catalog 注册、外表映射、写入与历史对照均已完成",
                 metrics={"iceberg_current_rows": len(data["current"]), "iceberg_history_rows": len(data["historic"])},
                 sql="SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;\nSELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders_old;",
                 result="current: 5 rows / 150 · historic: 4 rows / 100")


def sink_mysql(sql: str) -> list[list[str]]:
    return mysql(sql, port=13307, password="demo123")


def index_table(database: str, relation: str, algorithm: str, kind: str = "") -> str:
    """Resolve an internal index table from trusted catalog metadata, not a client name."""
    rows = mysql(
        "SELECT i.index_table_name, i.algo_table_type, i.algo FROM mo_catalog.mo_indexes i "
        "JOIN mo_catalog.mo_tables t ON i.table_id=t.rel_id "
        f"WHERE t.reldatabase='{database}' AND t.relname='{relation}' "
        f"AND i.algo='{algorithm}'"
    )
    name = next((row[0] for row in rows if len(row) > 1 and (not kind or row[1] == kind)), "")
    if not re.fullmatch(r"__mo_index_secondary_[0-9a-f-]+", name):
        raise DemoError(f"{relation} 的 {algorithm} 索引尚未就绪")
    return name


def inspect_feature(feature: str, options: dict) -> dict:
    """Read bounded, allowlisted facts for the interactive documentation figures."""
    required = {"git4data": "clone", "vector": "search", "fulltext": "search", "ingest": "schema",
                "htap": "operate", "recovery": "recover", "pubsub": "pubsub", "iceberg": "iceberg", "cdc": "cdc"}
    if feature not in required:
        raise DemoError("Unknown insight feature")
    state = load_state()
    if required[feature] not in state.get("completed", []):
        raise DemoError(f"先完成 {required[feature]} 场景，再读取本机数据")
    if feature == "git4data":
        source_sql = "SELECT COUNT(*) FROM demo_shop.orders"
        clone_sql = "SELECT COUNT(*) FROM demo_shop_ci.orders"
        price_sql = "SELECT product_id,price FROM demo_shop.products WHERE product_id=1 UNION ALL SELECT product_id,price FROM demo_shop_ci.products WHERE product_id=1"
        return {"feature": feature, "source_rows": int(scalar(source_sql)), "clone_rows": int(scalar(clone_sql)),
                "baseline_rows": state.get("metrics", {}).get("clone_rows"),
                "prices": mysql(price_sql), "clone_ms": state.get("metrics", {}).get("clone_ms"),
                "ci_source_price": state.get("metrics", {}).get("source_price"),
                "ci_candidate_price": state.get("metrics", {}).get("candidate_price"),
                "sql": [source_sql + ";", clone_sql + ";", price_sql + ";"]}
    if feature == "vector":
        intent = str(options.get("intent", "travel"))
        if intent not in INTENTS:
            raise DemoError("Unknown vector intent")
        probe = int(options.get("probe", 1))
        if probe not in (1, 2, 3):
            raise DemoError("nprobe must be 1, 2, or 3")
        vector = INTENTS[intent][1]
        centroids = index_table("demo_shop_ci", "products", "ivfflat", "centroids")
        entries = index_table("demo_shop_ci", "products", "ivfflat", "entries")
        query_sql = (
            "SELECT product_id,name,ROUND(L2_DISTANCE(embedding,'" + vector + "'),3) AS distance "
            "FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'" + vector + "') "
            f"LIMIT 3 BY RANK WITH OPTION 'mode=post', 'nprobe={probe}'"
        )
        return {"feature": feature, "intent": intent, "query_vector": json.loads(vector), "probe": probe,
                "products": mysql("SELECT product_id,name,embedding,stock,price FROM demo_shop_ci.products ORDER BY product_id"),
                "distances": mysql(f"SELECT product_id,ROUND(L2_DISTANCE(embedding,'{vector}'),3) FROM demo_shop_ci.products ORDER BY product_id"),
                "centroids": mysql(f"SELECT __mo_index_centroid_id,__mo_index_centroid FROM demo_shop_ci.`{centroids}` ORDER BY __mo_index_centroid_id"),
                "entries": mysql(f"SELECT __mo_index_centroid_fk_id,__mo_index_pri_col FROM demo_shop_ci.`{entries}` ORDER BY __mo_index_centroid_fk_id,__mo_index_pri_col"),
                "rows": mysql(query_sql), "plan": [row[0] for row in mysql("EXPLAIN " + query_sql)],
                "sql": query_sql + ";"}
    if feature == "fulltext":
        source = str(options.get("source", "products"))
        term = str(options.get("term", "charger"))
        algorithm = str(options.get("algorithm", "TF-IDF"))
        allowed = {"products": {"charger", "travel", "battery"}, "product_specs": {"gan"}, "product_docs": {"warranty"}}
        if term not in allowed.get(source, set()) or algorithm not in ("TF-IDF", "BM25"):
            raise DemoError("Unknown fulltext inspection option")
        index_name = index_table("demo_shop_ci", source, "fulltext")
        postings_sql = f"SELECT DISTINCT doc_id,pos FROM demo_shop_ci.`{index_name}` WHERE word='{term}' ORDER BY doc_id,pos LIMIT 30"
        search_term = "GaN" if term == "gan" else term
        if source == "products":
            match = f"MATCH(name,description) AGAINST('{search_term}' IN NATURAL LANGUAGE MODE)"
            search_sql = f"SELECT product_id,name,{match} AS score FROM demo_shop_ci.products WHERE {match} ORDER BY score DESC,product_id LIMIT 8"
            rows = mysql(f"SET ft_relevancy_algorithm='{algorithm}'; " + search_sql)
        elif source == "product_specs":
            search_sql = f"SELECT product_id,details FROM demo_shop_ci.product_specs WHERE MATCH(details) AGAINST('{search_term}') ORDER BY product_id"
            rows = mysql(search_sql)
        else:
            search_sql = f"SELECT product_id FROM demo_shop_ci.product_docs WHERE MATCH(manual) AGAINST('{search_term}') ORDER BY product_id"
            rows = mysql(search_sql)
        length_sql = f"SELECT DISTINCT doc_id,pos FROM demo_shop_ci.`{index_name}` WHERE word='__DocLen' ORDER BY doc_id LIMIT 30"
        source_rows = (mysql("SELECT product_id,name,description FROM demo_shop_ci.products ORDER BY product_id") if source == "products" else
                       mysql("SELECT product_id,details FROM demo_shop_ci.product_specs ORDER BY product_id") if source == "product_specs" else
                       mysql("SELECT doc_id,product_id,manual FROM demo_shop_ci.product_docs ORDER BY doc_id"))
        return {"feature": feature, "source": source, "term": term, "algorithm": algorithm,
                "postings": mysql(postings_sql), "doc_lengths": mysql(length_sql), "source_rows": source_rows,
                "rows": rows, "plan": [row[0] for row in mysql("EXPLAIN " + search_sql)],
                "sql": (f"SET ft_relevancy_algorithm='{algorithm}';\n" if source == "products" else "") + search_sql + ";",
                "postings_sql": postings_sql + ";"}
    if feature == "ingest":
        min_price = int(options.get("min_price", 0))
        if min_price not in (0, 100, 200):
            raise DemoError("Unknown quality threshold")
        gate_sql = f"SELECT product_id,name,price FROM demo_ingest.supplier_feed WHERE price>{min_price} AND stock>=0 ORDER BY product_id"
        runs = mysql("SELECT status,trigger_type,rows_affected FROM mo_task.sql_task_run WHERE task_name='demo_load_catalog' ORDER BY run_id DESC LIMIT 1") if "ingest" in state.get("completed", []) else []
        stages = [row for row in mysql("SHOW STAGES") if row[0] == "demo_supplier"]
        return {"feature": feature,
                "raw": mysql("SELECT product_id,name,price,stock FROM demo_ingest.supplier_feed ORDER BY product_id"),
                "issues": mysql("SELECT product_id,issue FROM demo_ingest.quality_issues ORDER BY product_id"),
                "accepted": mysql("SELECT product_id,name,price FROM demo_shop.products ORDER BY product_id"),
                "filtered": mysql(gate_sql), "min_price": min_price, "sql": gate_sql + ";",
                "stage_url": stages[0][1] if stages else "", "task_run": runs[0] if runs else None,
                "order_rows": int(scalar("SELECT COUNT(*) FROM demo_shop.orders"))}
    if feature == "htap":
        last = state.get("last_order") or {}
        report_sql = "SELECT COUNT(*),COALESCE(SUM(amount),0) FROM demo_shop.orders"
        order_id = int(last.get("id", 0))
        order = mysql(f"SELECT order_id,product_id,qty,amount FROM demo_shop.orders WHERE order_id={order_id}") if order_id else []
        product_id = int(last.get("product_id", 0))
        stock = mysql(f"SELECT product_id,name,stock FROM demo_shop.products WHERE product_id={product_id}") if product_id else []
        return {"feature": feature, "order": order, "product": stock, "last_order": last, "report": mysql(report_sql)[0],
                "sql": report_sql + ";"}
    if feature == "recovery":
        sql = "SELECT metric,metric_value FROM demo_shop.promo_kpis ORDER BY metric"
        return {"feature": feature, "metrics": mysql(sql),
                "events": [item for item in state.get("events", []) if item.get("step") == "recover" and not item.get("title", "").startswith(("核对 SQL", "PITR："))][-3:],
                "sql": sql + ";"}
    if feature == "pubsub":
        sql = "SELECT product_id,name,price FROM partner_catalog.products ORDER BY product_id LIMIT 6"
        return {"feature": feature, "source": mysql("SELECT product_id,name,price FROM demo_shop.products ORDER BY product_id LIMIT 6"),
                "subscriber": mysql(sql, user="demo_partner:admin", password="demo123"), "sql": sql + ";"}
    if feature == "iceberg":
        return {"feature": feature,
                "current": mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id LIMIT 20"),
                "historic": mysql("SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders_old ORDER BY order_id LIMIT 20"),
                "sql": "SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id LIMIT 20;"}
    order_id = int(state.get("metrics", {}).get("cdc_order_id", 0))
    sql = f"SELECT order_id,product_id,qty,amount FROM demo_shop.orders WHERE order_id={order_id}"
    return {"feature": feature, "order_id": order_id, "source": mysql(sql),
            "sink": sink_mysql(f"SELECT order_id,product_id,qty,amount FROM demo_sink.orders WHERE order_id={order_id}"),
            "sql": sql + ";"}


def run_check(check_id: str, *, preview: bool = False) -> dict:
    """Execute one documented verification query on its actual data source."""
    specs = {
        "version": ("start", "SELECT VERSION()", ["version"], "matrixone"),
        "stage_list": ("schema", "SHOW STAGES", ["stage", "url", "status"], "matrixone"),
        "external_rows": ("schema", "SELECT COUNT(*) AS rows FROM demo_ingest.supplier_feed", ["rows"], "matrixone"),
        "external_sample": ("schema", "SELECT product_id,name,price,stock FROM demo_ingest.supplier_feed ORDER BY product_id", ["product_id", "name", "price", "stock"], "matrixone"),
        "quality_rows": ("schema", "SELECT product_id, issue FROM demo_ingest.quality_issues ORDER BY product_id LIMIT 5", ["product_id", "issue"], "matrixone"),
        "task_runs": ("ingest", "SELECT run_id,trigger_type,status,rows_affected FROM mo_task.sql_task_run WHERE task_name='demo_load_catalog' ORDER BY run_id DESC LIMIT 1", ["run_id", "trigger_type", "status", "rows_affected"], "matrixone"),
        "products": ("ingest", "SELECT product_id, name, price FROM demo_shop.products ORDER BY product_id LIMIT 6", ["product_id", "name", "price"], "matrixone"),
        "order_count": ("ingest", "SELECT COUNT(*) AS orders FROM demo_shop.orders", ["orders"], "matrixone"),
        "source_count": ("clone", "SELECT COUNT(*) AS orders FROM demo_shop.orders", ["orders"], "matrixone"),
        "clone_count": ("clone", "SELECT COUNT(*) AS orders FROM demo_shop_ci.orders", ["orders"], "matrixone"),
        "ci_prices": ("ci", "SELECT 'source' AS library, price FROM demo_shop.products WHERE product_id=1 UNION ALL SELECT 'candidate', price FROM demo_shop_ci.products WHERE product_id=1", ["library", "price"], "matrixone"),
        "keyword": ("search", keyword_statement("charger", "demo_shop_ci"), ["product_id", "name", "price", "stock", "score"], "matrixone"),
        "fulltext_tfidf": ("search", "SET ft_relevancy_algorithm='TF-IDF'; SELECT product_id, MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AS score FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) ORDER BY score DESC", ["product_id", "score"], "matrixone"),
        "fulltext_bm25": ("search", "SET ft_relevancy_algorithm='BM25'; SELECT product_id, MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AS score FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) ORDER BY score DESC", ["product_id", "score"], "matrixone"),
        "boolean": ("search", "SELECT product_id, name FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('+charger' IN BOOLEAN MODE) ORDER BY product_id LIMIT 8", ["product_id", "name"], "matrixone"),
        "json_spec": ("search", "SELECT product_id FROM demo_shop_ci.product_specs WHERE MATCH(details) AGAINST('GaN') ORDER BY product_id", ["product_id"], "matrixone"),
        "vector": ("search", vector_statement("travel", "demo_shop_ci"), ["product_id", "name", "price", "stock", "distance"], "matrixone"),
        "vector_probe": ("search", "SELECT product_id, name FROM demo_shop_ci.products ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5 BY RANK WITH OPTION 'nprobe=2'", ["product_id", "name"], "matrixone"),
        "vector_plan": ("search", "EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5", ["plan"], "matrixone"),
        "vector_plan_pre": ("search", "EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5 BY RANK WITH OPTION 'mode=pre'", ["plan"], "matrixone"),
        "hybrid": ("search", "SELECT product_id,name,price,stock FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AND stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5", ["product_id", "name", "price", "stock"], "matrixone"),
        "fulltext_plan": ("search", "EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE)", ["plan"], "matrixone"),
        "document": ("search", "SELECT product_id FROM demo_shop_ci.product_docs WHERE MATCH(manual) AGAINST('warranty')", ["product_id"], "matrixone"),
        "live_price": ("release", "SELECT product_id, name, price FROM demo_shop.products WHERE product_id=1", ["product_id", "name", "price"], "matrixone"),
        "live_report": ("operate", "SELECT COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue FROM demo_shop.orders", ["orders", "revenue"], "matrixone"),
        "pitr_policy": ("recover", "SHOW PITR WHERE pitr_name='demo_price_history'", ["pitr_name", "created_time", "modified_time", "pitr_level", "account_name", "database_name", "table_name", "pitr_length", "pitr_unit"], "matrixone"),
        "pitr_prices": ("recover", "SELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id", ["product_id", "name", "price"], "matrixone"),
        "restored_kpis": ("recover", "SELECT metric, metric_value FROM demo_shop.promo_kpis ORDER BY metric", ["metric", "metric_value"], "matrixone"),
        "subscriber": ("pubsub", "SELECT product_id, name, price FROM partner_catalog.products ORDER BY product_id LIMIT 6", ["product_id", "name", "price"], "subscriber"),
        "iceberg_current": ("iceberg", "SELECT COUNT(*), SUM(amount) FROM demo_story_lake.append_orders", ["rows", "amount"], "matrixone"),
        "iceberg_history": ("iceberg", "SELECT COUNT(*), SUM(amount) FROM demo_story_lake.append_orders_old", ["rows", "amount"], "matrixone"),
    }
    if check_id in ("cdc_source", "cdc_sink"):
        order_id = load_state().get("metrics", {}).get("cdc_order_id")
        if not order_id:
            raise DemoError("请先完成 CDC 章节")
        source = "matrixone" if check_id == "cdc_source" else "mysql"
        table = "demo_shop.orders" if source == "matrixone" else "demo_sink.orders"
        specs[check_id] = ("cdc", f"SELECT COUNT(*) FROM {table} WHERE order_id={int(order_id)}", ["rows"], source)
    if check_id not in specs:
        raise DemoError(f"Unknown verification query: {check_id}")
    owner, sql, columns, source = specs[check_id]
    if preview:
        return {"check": check_id, "sql": sql + ";", "columns": columns, "source": source}
    if owner not in load_state().get("completed", []):
        raise DemoError(f"请先完成 {owner} 章节，再运行核对 SQL")
    started = time.monotonic()
    if source == "subscriber":
        rows = mysql(sql, user="demo_partner:admin", password="demo123")
    elif source == "mysql":
        rows = sink_mysql(sql)
    else:
        rows = mysql(sql)
    duration_ms = round((time.monotonic() - started) * 1000)
    if len(rows) > 100:
        rows = rows[:100]
    result = {"check": check_id, "sql": sql + ";", "columns": columns, "rows": rows, "source": source, "duration_ms": duration_ms}
    summary = f"{len(rows)} row(s) · {source} · {duration_ms} ms"
    event(owner, f"核对 SQL：{check_id}", summary, complete=False, sql=sql + ";", result=summary)
    return result


def step_cdc() -> dict:
    """Replicate new order changes into a dedicated local MySQL sink."""
    require_version()
    container = "matrixone-demo-mysql-42"
    status = command(["docker", "inspect", "-f", "{{.State.Running}}", container]) if container in command(["docker", "ps", "-a", "--format", "{{.Names}}"] ).splitlines() else ""
    if status != "true":
        if status:
            command(["docker", "start", container])
        else:
            command(["docker", "run", "-d", "--name", container, "-p", "127.0.0.1:13307:3306", "-e", "MYSQL_ROOT_PASSWORD=demo123", "mysql:8.0"])
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            sink_mysql("SELECT 1")
            break
        except DemoError:
            time.sleep(2)
    else:
        raise DemoError("MySQL CDC sink did not become ready")
    sink_mysql("CREATE DATABASE IF NOT EXISTS demo_sink")
    if not any("demo_cdc_pitr" in row for row in mysql("SHOW PITR")):
        mysql("CREATE PITR demo_cdc_pitr FOR DATABASE demo_shop RANGE 3 'h'")
    if any("demo_orders_cdc" in row for row in mysql("SHOW CDC ALL")):
        mysql("DROP CDC TASK demo_orders_cdc")
    mysql(
        "CREATE CDC demo_orders_cdc "
        f"'mysql://sys#root:{os.environ.get('MO_DEMO_PASSWORD', '111')}@127.0.0.1:{MO_PORT}' "
        "'mysql' 'mysql://root:demo123@127.0.0.1:13307' "
        "'demo_shop.orders:demo_sink.orders' {'Level'='table','NoFull'='true'}"
    )
    task_rows = [row for row in mysql("SHOW CDC ALL") if "demo_orders_cdc" in row]
    if not task_rows:
        raise DemoError("CDC task was not created")
    task_id = task_rows[0][0]
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if int(scalar(f"SELECT COUNT(*) FROM mo_catalog.mo_cdc_watermark WHERE task_id='{task_id}'")):
            break
        time.sleep(2)
    else:
        raise DemoError("CDC stream did not reach its initial checkpoint")
    before = int(scalar("SELECT COUNT(*) FROM demo_shop.orders"))
    result = place_order(2, 1)
    order_id = result["order"]["id"]
    deadline = time.monotonic() + 60
    target = 0
    while time.monotonic() < deadline:
        try:
            target = int(sink_mysql(f"SELECT COUNT(*) FROM demo_sink.orders WHERE order_id={order_id}")[0][0])
        except (DemoError, IndexError):
            target = 0
        if target == 1:
            break
        time.sleep(2)
    source_count = int(scalar(f"SELECT COUNT(*) FROM demo_shop.orders WHERE order_id={order_id}"))
    if target != 1 or source_count != 1 or result["report"]["orders"] != before + 1:
        raise DemoError(f"CDC order #{order_id} did not reach MySQL sink; SHOW CDC TASK demo_orders_cdc")
    return event("cdc", "CDC 增量已到达 MySQL", f"新订单 #{order_id} 在 MatrixOne 与 MySQL 两端均可查询", metrics={"cdc_order_id": order_id, "cdc_target_rows": target}, sql=f"SELECT COUNT(*) FROM demo_shop.orders WHERE order_id={order_id};\n-- MySQL sink\nSELECT COUNT(*) FROM demo_sink.orders WHERE order_id={order_id};", result="MatrixOne: 1 row · MySQL: 1 row")


def reset_demo() -> dict:
    """Replay reset: remove the fixed demo objects, retaining tools and lake history."""
    step_start()
    pid = int(PID_FILE.read_text().strip())
    proc = Path(f"/proc/{pid}/cmdline")
    if not proc.exists() or str(RUNTIME / "config" / "launch.toml").encode() not in proc.read_bytes():
        raise DemoError("重置仅允许连接本教程启动的 MatrixOne 实例")
    previous = load_state()
    # Save a recovery record before the first destructive operation. On failure,
    # retain progress so the user can inspect the error and retry the reset.
    archive = RUNTIME / "reset-history"
    archive.mkdir(exist_ok=True)
    (archive / f"{time.time_ns()}.json").write_text(json.dumps(previous, ensure_ascii=False, indent=2))
    if any("demo_orders_cdc" in row for row in mysql("SHOW CDC ALL")):
        mysql("DROP CDC TASK demo_orders_cdc")
    sql_file("99_reset.sql")
    names = command(["docker", "ps", "-a", "--format", "{{.Names}}"] ).splitlines()
    if "matrixone-demo-mysql-42" in names:
        command(["docker", "start", "matrixone-demo-mysql-42"])
        deadline = time.monotonic() + 90
        while True:
            try:
                sink_mysql("DROP DATABASE IF EXISTS demo_sink")
                break
            except DemoError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(2)
    leftovers = mysql("SHOW DATABASES")
    reserved = {"demo_shop", "demo_shop_ci", "demo_ingest", "demo_pitr_shop", "demo_story_lake"}
    if any(row[0] in reserved for row in leftovers):
        raise DemoError("重置校验失败：仍有演示数据库，进度未清空")
    for filename in ("products.csv", "travel_charger.docx"):
        (FIXTURES / filename).unlink(missing_ok=True)
    state = initial_state()
    state["reset"] = {"at": datetime.now(timezone.utc).isoformat(), "verified": True,
                      "retained": "依赖、编译产物、运行服务与 Iceberg 湖端历史保留；下轮使用新命名空间"}
    save_state(state)
    return state


class Handler(BaseHTTPRequestHandler):
    def valid_host(self) -> bool:
        return self.headers.get("Host") in (f"127.0.0.1:{WEB_PORT}", f"localhost:{WEB_PORT}")

    def send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self.valid_host():
            self.send_error(403, "Invalid host")
            return
        path = urlparse(self.path).path
        if path == "/api/case":
            import cases
            try:
                feature = parse_qs(urlparse(self.path).query).get("feature", [""])[0]
                self.send_json(200, cases.get(sys.modules[__name__], feature).view())
            except (DemoError, OSError, ValueError) as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if path == "/api/identity":
            self.send_json(200, {"root": str(ROOT), "version": VERSION, "build": SERVER_BUILD, "mo_port": MO_PORT})
            return
        if path == "/api/environment":
            from environment import inspect
            self.send_json(200, inspect())
            return
        if path == "/api/state":
            self.send_json(200, load_state())
            return
        if path == "/" or path.lstrip("/") in WEB_ASSETS:
            name = "index.html" if path == "/" else path.lstrip("/")
            file = ROOT / "web" / name
            data = file.read_bytes()
            kind = "text/html" if name.endswith(".html") else "text/css" if name.endswith(".css") else "font/woff2" if name.endswith(".woff2") else "text/javascript"
            self.send_response(200)
            self.send_header("Content-Type", kind + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        host = self.headers.get("Host")
        origin = self.headers.get("Origin")
        if not self.valid_host() or (origin is not None and origin != f"http://{host}"):
            self.send_error(403, "Invalid request origin")
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            self.send_error(415, "JSON content type required")
            return
        path = urlparse(self.path).path
        if path not in ("/api/case", "/api/start", "/api/search", "/api/order", "/api/step", "/api/reset", "/api/query", "/api/check", "/api/vector-health", "/api/insight", "/api/pitr", "/api/iceberg"):
            self.send_error(404)
            return
        if not EXEC_LOCK.acquire(blocking=False):
            self.send_json(409, {"error": "Another operation is still running"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 2048:
                raise DemoError("Request too large")
            body = json.loads(self.rfile.read(size) or b"{}")
            if path == "/api/case":
                import cases
                self.send_json(200, cases.dispatch(sys.modules[__name__], body))
            elif path == "/api/reset":
                if body.get("confirm") != "reset-demo":
                    raise DemoError("请确认删除演示数据与进度")
                self.send_json(200, reset_demo())
            elif path == "/api/start":
                self.send_json(200, step_start())
            elif path == "/api/step":
                step = str(body.get("step", ""))
                completed = set(load_state()["completed"])
                expected = next((name for name in STEP_ORDER if name not in completed), None)
                if step != expected:
                    raise DemoError(f"Next step is {expected or 'finished'}, requested {step}")
                self.send_json(200, run_step(step, 1000000))
            elif path == "/api/query":
                self.send_json(200, demo_query(str(body.get("sql", ""))))
            elif path == "/api/check":
                self.send_json(200, run_check(str(body.get("check", ""))))
            elif path == "/api/iceberg":
                self.send_json(200, iceberg_lab(str(body.get("action", "inspect"))))
            elif path == "/api/pitr":
                self.send_json(200, pitr_lab(str(body.get("action", "inspect"))))
            elif path == "/api/vector-health":
                self.send_json(200, vector_health(str(body.get("action", "check"))))
            elif path == "/api/insight":
                self.send_json(200, inspect_feature(str(body.get("feature", "")), body))
            elif path == "/api/search":
                mode = body.get("mode", "keyword")
                database = "demo_shop" if "release" in load_state()["completed"] else "demo_shop_ci"
                if mode == "keyword":
                    query = str(body.get("query", "charger"))
                    rows = search_keyword(query, database=database)
                    statement = keyword_statement(query, database)
                elif mode == "vector":
                    query = str(body.get("query", "travel"))
                    rows = search_vector(query, database=database)
                    statement = vector_statement(query, database)
                else:
                    raise DemoError("mode must be keyword or vector")
                result = {"mode": mode, "query": query, "rows": rows}
                event("search", "页面执行搜索", f"{mode}: {query}，返回 {len(rows)} 条", complete=False, data={"search": result}, sql=statement + ";", result=f"{len(rows)} rows · " + (", ".join(row["name"] for row in rows[:3]) or "no match"))
                self.send_json(200, result)
            else:
                product_id = int(body.get("product_id", 1))
                qty = int(body.get("qty", 1))
                self.send_json(200, place_order(product_id, qty))
        except (DemoError, ValueError, KeyError, subprocess.TimeoutExpired, OSError) as exc:
            self.send_json(400, {"error": str(exc)})
        finally:
            EXEC_LOCK.release()

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("[web] " + format % args + "\n")


def serve() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", WEB_PORT), Handler)
    print(f"Demo HTML: http://127.0.0.1:{WEB_PORT}/", flush=True)
    server.serve_forever()


def run_step(step: str, rows: int) -> dict:
    return {
        "bootstrap": step_bootstrap, "start": step_start, "stop": step_stop, "prepare": step_prepare,
        "schema": step_schema, "ingest": lambda: step_ingest(rows),
        "clone": step_clone, "ci": step_ci, "search": step_search,
        "release": step_release, "operate": step_operate, "recover": step_recover,
        "pubsub": step_pubsub, "iceberg": step_iceberg, "cdc": step_cdc,
    }[step]()


def main() -> int:
    parser = argparse.ArgumentParser(description="MatrixOne 4.2.4 interactive demo")
    parser.add_argument("step", choices=("bootstrap", "start", "stop", "prepare", "schema", "ingest", "clone", "ci", "search", "release", "operate", "recover", "pubsub", "iceberg", "cdc", "serve", "status"))
    parser.add_argument("--rows", type=int, default=1000000, help="Order rows for ingest; use 100000 for a quick run")
    args = parser.parse_args()
    try:
        if args.step == "status":
            print(json.dumps(load_state(), ensure_ascii=False, indent=2))
        elif args.step == "serve":
            serve()
        else:
            result = run_step(args.step, args.rows)
            if isinstance(result, dict):
                state = load_state()
                last_sql = state.get("evidence", [])[-1] if state.get("evidence") else None
                latest = last_sql if last_sql and last_sql["step"] == args.step else None
                print(json.dumps({"step": args.step, "sql": latest["sql"] if latest else None, "result": latest["result"] if latest else None, "metrics": result.get("metrics", {})}, ensure_ascii=False, indent=2))
        return 0
    except (DemoError, subprocess.TimeoutExpired, OSError) as exc:
        print(f"demo {args.step}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
