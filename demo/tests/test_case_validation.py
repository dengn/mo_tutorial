"""Validation failures retain the actual evidence needed to diagnose a case."""

import sys
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cases
import demo


class CaseValidationTest(unittest.TestCase):
    def test_clone_count_failure_keeps_expected_and_actual_rows(self):
        observed = {
            'source_count': [['1000000']],
            'clone_count': [['999999']],
            'ci_prices': [['source', '299.00'], ['candidate', '269.10']],
        }

        class Database:
            DemoError = demo.DemoError
            ICEBERG_PHASES = ()

            @staticmethod
            def run_check(check, *, preview=False):
                return {'check': check, 'sql': f'SELECT {check};',
                        'columns': ['value'], 'rows': observed[check]}

        case = cases.Case.__new__(cases.Case)
        case.feature = 'git4data'
        case.mo = Database()
        with self.assertRaisesRegex(demo.DemoError, 'Clone 完整性'):
            case.verify()
        clone = next(check for check in case.validation_checks if check['check'] == 'clone_count')
        self.assertFalse(clone['passed'])
        self.assertEqual(clone['rows'], [['999999']])
        self.assertIn('100 万', clone['purpose'])
        self.assertTrue(next(check for check in case.validation_checks if check['check'] == 'source_count')['passed'])

    def test_failed_verify_record_preserves_check_rows(self):
        observed = {'source_count': [['1000000']], 'clone_count': [['999999']],
                    'ci_prices': [['source', '299.00'], ['candidate', '269.10']]}

        class Database:
            DemoError = demo.DemoError
            ICEBERG_PHASES = ()

            @staticmethod
            def run_check(check, *, preview=False):
                return {'check': check, 'sql': f'SELECT {check};',
                        'columns': ['value'], 'rows': observed[check]}

        with tempfile.TemporaryDirectory() as directory:
            case = cases.Case.__new__(cases.Case)
            case.feature = 'git4data'
            case.mo = Database()
            case.core = SimpleNamespace(DemoError=demo.DemoError)
            case.redact = str
            case.progress = Path(directory) / 'case.json'
            case.write({'completed':['start','seed','clone','ci'], 'records':{}, 'verified':False})
            with self.assertRaisesRegex(demo.DemoError, 'Clone 完整性'):
                case.run('verify')
            state = json.loads(case.progress.read_text())
            self.assertNotIn('verify', state['completed'])
            failed = state['records']['verify']
            self.assertFalse(failed['ok'])
            clone = next(check for check in failed['result']['checks'] if check['check']=='clone_count')
            self.assertEqual(clone['rows'], [['999999']])
            self.assertFalse(clone['passed'])


if __name__ == '__main__':
    unittest.main()
