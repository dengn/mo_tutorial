#!/usr/bin/env python3
"""Explicit integration gate: reset/replay every case and check reset isolation.
Run against a running tutorial: python3 demo/tests/cases_smoke.py --run
Only case_* fixtures are reset. This intentionally performs real writes.
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import demo
from cases import FEATURES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', required=True)
    parser.parse_args()
    http = build_opener(ProxyHandler({}))
    base = f'http://127.0.0.1:{demo.WEB_PORT}'
    def request(path, data=None):
        req = Request(base + path, data=json.dumps(data).encode() if data else None,
                      headers={'Content-Type':'application/json'})
        try:
            with http.open(req, timeout=600) as response: return json.load(response)
        except HTTPError as exc: raise RuntimeError(exc.read().decode()) from exc
    def post(feature, action, **kwargs):
        return request('/api/case', {'case':feature, 'action':action, **kwargs})
    tables = [f'case_{f}_shop' for f in FEATURES if f not in ('vector','fulltext','iceberg')]
    tables += ['case_vector_shop_ci', 'case_fulltext_shop_ci', 'demo_shop', 'demo_shop_ci']
    def counts():
        existing = {row[0] for row in demo.mysql('SHOW DATABASES')}
        return {db: {'products':demo.mysql(f'SELECT * FROM {db}.products ORDER BY product_id'), 'orders':demo.mysql(f'SELECT COUNT(*),COALESCE(SUM(amount),0) FROM {db}.orders')} for db in tables if db in existing}
    for feature in FEATURES:
        before = counts()
        state = post(feature, 'reset', confirm='reset-case')
        after = counts()
        prefix = f'case_{feature}_'
        assert {k:v for k,v in before.items() if not k.startswith(prefix)} == {k:v for k,v in after.items() if not k.startswith(prefix)}, f'{feature}: sibling data changed'
        assert not state['case']['completed'] and state['case']['reset']['verified']
        # A second reset must also work, including an already empty database.
        state = post(feature, 'reset', confirm='reset-case')
        for step in state['case']['steps']:
            state = post(feature, 'run', step=step['id'])
            assert state['case']['records'][step['id']]['ok']
            print(feature, step['id'], 'PASS', flush=True)
        assert state['case']['verified']
        # Verify the service never claims another feature's SQL namespace.
        trace = state['case']['records']['verify']['trace']
        assert any(prefix in row['sql'] or prefix in row.get('user','') for row in trace)
    print('All 9 cases: reset twice, replay, acceptance and sibling isolation PASS')


if __name__ == '__main__': main()
