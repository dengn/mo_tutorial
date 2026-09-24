#!/usr/bin/env python3
"""One entry point for starting, resuming and resetting the tutorial."""
import fcntl
import json
import sys
from urllib.request import Request, build_opener, ProxyHandler

urlopen = build_opener(ProxyHandler({})).open
from urllib.error import HTTPError
import demo


def main():
    demo.RUNTIME.mkdir(parents=True, exist_ok=True)
    with (demo.RUNTIME / 'launch.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise demo.DemoError('另一个 start.sh 正在启动服务，请等待。')
        url = f'http://127.0.0.1:{demo.WEB_PORT}'
        if demo.port_open(demo.WEB_PORT):
            try:
                with urlopen(url + '/api/identity', timeout=5) as response:
                    identity = json.load(response)
                if identity.get('root') != str(demo.ROOT):
                    raise ValueError('other workspace')
            except Exception as exc:
                raise demo.DemoError(f'网页端口 {demo.WEB_PORT} 已被其他服务占用。设置 MO_DEMO_WEB_PORT 或停止旧版 demo 网页服务。') from exc
            if identity.get('build') != demo.SERVER_BUILD:
                raise demo.DemoError('检测到此仓库的旧版网页服务。请在原终端按 Ctrl+C 关闭，再运行 ./demo/start.sh。')
            if identity.get('version') != demo.VERSION or identity.get('mo_port') != demo.MO_PORT:
                raise demo.DemoError('现有网页服务的 MatrixOne 版本或端口与当前配置不同。请在原终端按 Ctrl+C 关闭，再运行 ./demo/start.sh。')
            if '--reset' in sys.argv:
                request = Request(url + '/api/reset', data=b'{"confirm":"reset-demo"}', headers={'Content-Type': 'application/json'})
                with urlopen(request, timeout=300) as response:
                    json.load(response)
                print('演示数据与进度已重置。')
            else:
                request = Request(url + '/api/start', data=b'{}', headers={'Content-Type': 'application/json'})
                with urlopen(request, timeout=4200) as response:
                    json.load(response)
            print('打开 ' + url + '/')
            return
        print('准备并启动 MatrixOne v4.2.4。首次编译可能需要较长时间…', flush=True)
        demo.step_start()
        if '--reset' in sys.argv:
            demo.reset_demo()
        print('打开 ' + url + '/', flush=True)
        print('Ctrl+C 关闭网页服务；数据库保留。停止数据库：python3 demo/demo.py stop', flush=True)
        fcntl.flock(lock, fcntl.LOCK_UN)
        demo.serve()


if __name__ == '__main__':
    try:
        main()
    except HTTPError as exc:
        print(f"操作失败：{exc.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f'启动失败：{exc}', file=sys.stderr)
        sys.exit(1)
