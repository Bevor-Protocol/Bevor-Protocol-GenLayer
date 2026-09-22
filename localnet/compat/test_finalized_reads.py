"""Exercise the actual patched methods without importing Studio services."""
import ast
import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace
import unittest


def method(path, class_name, method_name, namespace):
    tree = ast.parse(Path(path).read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    fn = next(n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == method_name)
    code = "from __future__ import annotations\n" + ast.unparse(fn)
    exec(code, namespace)
    return namespace[method_name]


class FinalizedReads(unittest.TestCase):
    def test_finalized_does_not_read_accepted_or_cached_values(self):
        read = method("/app/backend/node/base.py", "_SnapshotView", "storage_read_finalized", {"base64": base64})
        key = base64.b64encode(b"slot").decode()
        state = {"accepted": {key: base64.b64encode(b"unsafe").decode()}, "finalized": {key: base64.b64encode(b"final").decode()}}
        proxy = SimpleNamespace(_get_snapshot=lambda account: SimpleNamespace(states=state), _slot_key=lambda slot: key)
        self.assertEqual(read(proxy, "other", b"slot", 0, 5), b"final")
        self.assertEqual(read(proxy, "other", b"slot", 3, 4), b"al\0\0")
        self.assertEqual(read(proxy, "other", b"slot", 20, 2), b"\0\0")
        state["finalized"] = {}
        self.assertEqual(read(proxy, "other", b"slot", 0, 6), b"\0" * 6)

    def test_host_dispatch_preserves_state_selection(self):
        modes = SimpleNamespace(LATEST_FINAL=1)
        read = method("/app/backend/node/genvm/base.py", "Host", "storage_read", {"asyncio": asyncio, "StorageType": modes, "Address": lambda v: v})
        proxy = SimpleNamespace(storage_read_finalized=lambda *args: b"final", storage_read=lambda *args: b"accepted")
        host = SimpleNamespace(_state_proxy=proxy)
        self.assertEqual(asyncio.run(read(host, 1, b"addr", b"slot", 0, 5)), b"final")
        self.assertEqual(asyncio.run(read(host, 0, b"addr", b"slot", 0, 5)), b"accepted")


unittest.main()
