#!/usr/bin/env python3
"""Read-only preflight and user-owned source/toolchain preparation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('MO_DEMO_SOURCE_DIR', str(Path.home() / 'matrixone'))).expanduser().resolve()
RELEASE = Path(os.environ.get('MO_DEMO_RELEASE_DIR', str(SOURCE.parent / 'matrixone-v4.2.4-demo'))).expanduser().resolve()


def output(args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, stderr=subprocess.STDOUT, timeout=120).strip()


def inspect():
    checks = []
    def add(name, ok, detail):
        checks.append(dict(name=name, ok=bool(ok), detail=detail))
    add('Python ≥ 3.10', sys.version_info >= (3, 10), sys.version.split()[0])
    add('Linux', sys.platform == 'linux', platform.platform())
    for tool in ('git', 'gcc', 'g++', 'make', 'cmake', 'mysql', 'curl', 'docker'):
        found = shutil.which(tool)
        add(tool, found, found or '缺失：运行 ./demo/setup.sh')
    add('源码路径', not any(c.isspace() for c in str(RELEASE)), str(RELEASE))
    try:
        tag = output(['git', 'describe', '--tags', '--exact-match', 'HEAD'], RELEASE)
        add('Release v4.2.4', tag == 'v4.2.4', tag)
        required = re.search(r'^go (\S+)', (RELEASE / 'go.mod').read_text(), re.M)[1]
        # A check must not trigger Go's automatic toolchain download.
        local_env = {**os.environ, 'GOTOOLCHAIN': 'local'}
        effective = output(['go', 'env', 'GOVERSION'], ROOT, local_env).removeprefix('go')
        parts = lambda v: tuple(map(int, v.split('.')))
        if parts(effective) < parts(required) and os.environ.get('GOTOOLCHAIN', 'auto') == 'auto':
            cache = Path(output(['go', 'env', 'GOMODCACHE'], ROOT, local_env))
            arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
            cached_go = cache / f'golang.org/toolchain@v0.0.1-go{required}.linux-{arch}/bin/go'
            if cached_go.is_file():
                effective = output([str(cached_go), 'env', 'GOVERSION'], ROOT, local_env).removeprefix('go')
        add('Go 工具链', parts(effective) >= parts(required), f'{effective} / 要求 {required}')
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        add('源码 / Go 工具链', False, str(exc)[-400:] + '；运行 ./demo/setup.sh')
    for label, args in [('Docker Compose', ['docker', 'compose', 'version']), ('Docker daemon', ['docker', 'info', '--format', '{{.ServerVersion}}'])]:
        try:
            add(label, True, output(args))
        except (OSError, subprocess.SubprocessError) as exc:
            add(label, False, str(exc)[-200:] + '；检查 Docker 服务与用户权限')
    free = shutil.disk_usage(ROOT).free // (1024**3)
    return {'ok': all(c['ok'] for c in checks), 'checks': checks,
            'notes': [f'当前磁盘可用 {free} GiB；建议预留 30 GiB，内存 16 GiB。首次构建和下载镜像可能较慢。']}


def prepare():
    if any(c.isspace() for c in str(RELEASE)):
        raise RuntimeError('MatrixOne 编译目录不能含空白字符；设置 MO_DEMO_RELEASE_DIR。')
    if not SOURCE.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', 'v4.2.4', 'https://github.com/matrixorigin/matrixone.git', str(SOURCE)], check=True)
    if not RELEASE.exists():
        if 'v4.2.4' not in output(['git', 'tag', '-l', 'v4.2.4'], SOURCE).splitlines():
            subprocess.run(['git', 'fetch', 'origin', 'tag', 'v4.2.4'], cwd=SOURCE, check=True)
        subprocess.run(['git', 'worktree', 'add', '--detach', str(RELEASE), 'v4.2.4'], cwd=SOURCE, check=True)
    if output(['git', 'describe', '--tags', '--exact-match', 'HEAD'], RELEASE) != 'v4.2.4':
        raise RuntimeError(f'{RELEASE} 不是 v4.2.4；请指定另一 MO_DEMO_RELEASE_DIR。')
    required = re.search(r'^go (\S+)', (RELEASE / 'go.mod').read_text(), re.M)[1]
    tool = ROOT / 'runtime' / 'tools' / ('go' + required)
    try:
        ready = output(['go', 'env', 'GOVERSION'], RELEASE) == 'go' + required
    except (OSError, subprocess.SubprocessError):
        ready = False
    if not ready and not (tool / 'go/bin/go').is_file():
        arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
        if not arch:
            raise RuntimeError('自动安装 Go 仅支持 Linux amd64 / arm64')
        print(f'下载并校验 Go {required}（只安装到 demo/runtime/tools）', flush=True)
        with urlopen('https://go.dev/dl/?mode=json&include=all', timeout=60) as response:
            releases = json.load(response)
        file = next(f for r in releases if r['version'] == 'go' + required for f in r['files'] if f['os'] == 'linux' and f['arch'] == arch and f['kind'] == 'archive')
        tool.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tool.parent) as temp:
            archive = Path(temp) / 'go.tgz'
            with urlopen('https://go.dev/dl/' + file['filename'], timeout=120) as response, archive.open('wb') as target:
                shutil.copyfileobj(response, target)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != file['sha256']:
                raise RuntimeError('Go SHA256 校验失败')
            with tarfile.open(archive) as tar:
                for member in tar.getmembers():
                    if not member.name.startswith('go/') or '..' in Path(member.name).parts or not (member.isfile() or member.isdir()):
                        raise RuntimeError('Go 归档含异常路径')
                tar.extractall(Path(temp) / 'unpacked')
            if tool.exists():
                shutil.rmtree(tool)
            (Path(temp) / 'unpacked').rename(tool)
    env = ROOT / 'runtime/env.sh'
    env.parent.mkdir(parents=True, exist_ok=True)
    env.write_text(f'export MO_DEMO_SOURCE_DIR=${{MO_DEMO_SOURCE_DIR:-{shlex.quote(str(SOURCE))}}}\n'
                   f'export MO_DEMO_RELEASE_DIR=${{MO_DEMO_RELEASE_DIR:-{shlex.quote(str(RELEASE))}}}\n'
                   + (f'export PATH={shlex.quote(str(tool / "go/bin"))}:"$PATH"\n' if (tool / 'go/bin/go').is_file() else ''))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    try:
        if args.prepare:
            prepare()
        else:
            result = inspect()
            for check in result['checks']:
                print(('✓ ' if check['ok'] else '✗ ') + check['name'] + ': ' + check['detail'])
            print('\n'.join(result['notes']))
            sys.exit(0 if result['ok'] else 1)
    except (OSError, subprocess.SubprocessError, RuntimeError, StopIteration) as exc:
        print(f'环境准备失败：{exc}', file=sys.stderr)
        sys.exit(1)
