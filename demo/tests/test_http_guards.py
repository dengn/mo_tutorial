"""HTTP boundary checks that do not require a running MatrixOne service."""

import json
import io
import sys
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import demo
import launch


class HttpGuardsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), demo.Handler)
        cls.port = cls.server.server_port
        cls.old_port = demo.WEB_PORT
        demo.WEB_PORT = cls.port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.http = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        demo.WEB_PORT = cls.old_port

    def request(self, path, *, method="GET", host=None, origin=None, content_type=None, body=None):
        headers = {"Host": host or f"127.0.0.1:{self.port}"}
        if origin is not None:
            headers["Origin"] = origin
        if content_type is not None:
            headers["Content-Type"] = content_type
        request = Request(f"http://127.0.0.1:{self.port}{path}", data=body,
                          headers=headers, method=method)
        try:
            with self.http.open(request, timeout=3) as response:
                return response.status, response.read()
        except HTTPError as exc:
            return exc.code, exc.read()

    def test_cross_origin_and_simple_content_type_cannot_reset(self):
        payload = b'{"confirm":"reset-demo"}'
        with patch.object(demo, "reset_demo") as reset:
            status, _ = self.request("/api/reset", method="POST", body=payload,
                                     origin="http://127.0.0.1:9999", content_type="application/json")
            self.assertEqual(status, 403)
            status, _ = self.request("/api/reset", method="POST", body=payload,
                                     content_type="text/plain")
            self.assertEqual(status, 415)
            reset.assert_not_called()

    def test_rebinding_host_is_rejected_before_reading_identity(self):
        status, _ = self.request("/api/identity", host=f"example.test:{self.port}")
        self.assertEqual(status, 403)

    def test_same_origin_json_request_still_works(self):
        with patch.object(demo, "demo_query", return_value={"rows": []}) as query:
            status, body = self.request("/api/query", method="POST", body=b'{"sql":"SELECT VERSION()"}',
                                        origin=f"http://127.0.0.1:{self.port}", content_type="application/json; charset=utf-8")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), {"rows": []})
            query.assert_called_once_with("SELECT VERSION()")


class CaseStartIsolationTest(unittest.TestCase):
    def test_service_check_does_not_write_main_story_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "mo-service").touch()
            pid_file = Mock()
            pid_file.exists.return_value = True
            pid_file.read_text.return_value = "123"
            process = Mock()
            process.exists.return_value = True
            process.read_bytes.return_value = str(demo.RUNTIME / "config" / "launch.toml").encode()
            with patch.object(demo, "release_dir", return_value=source), \
                 patch.object(demo, "port_open", return_value=True), \
                 patch.object(demo, "scalar", return_value="v4.2.4"), \
                 patch.object(demo, "PID_FILE", pid_file), \
                 patch.object(demo, "Path", return_value=process), \
                 patch.object(demo, "event") as event:
                self.assertEqual(demo.step_start(record=False),
                                 {"mo_version": "v4.2.4", "mo_port": demo.MO_PORT})
                event.assert_not_called()


class LaunchIdentityTest(unittest.TestCase):
    def test_stale_handler_is_not_reused(self):
        identity = {"root": str(demo.ROOT), "version": demo.VERSION,
                    "mo_port": demo.MO_PORT, "build": "previous-build"}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(demo, "RUNTIME", Path(directory)), \
             patch.object(demo, "port_open", return_value=True), \
             patch.object(launch, "urlopen", return_value=io.BytesIO(json.dumps(identity).encode())), \
             patch.object(demo, "step_start") as start, \
             patch.object(sys, "argv", ["launch.py"]):
            with self.assertRaisesRegex(demo.DemoError, "旧版网页服务"):
                launch.main()
            start.assert_not_called()


if __name__ == "__main__":
    unittest.main()
