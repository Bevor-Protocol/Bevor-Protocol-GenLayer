"""Add finalized storage reads to the pinned local Studio v0.121.6 host.

That release asserts on LATEST_FINAL although its snapshots already contain
separate accepted and finalized state. Do not substitute accepted state.
"""
from pathlib import Path

root = Path("/app/backend/node")
host_path = root / "genvm/base.py"
snapshot_path = root / "base.py"
host = host_path.read_text()
snapshot = snapshot_path.read_text()
old = """        assert type != StorageType.LATEST_FINAL
        return await asyncio.to_thread(
            self._state_proxy.storage_read, Address(account), slot, index, le
        )"""
new = """        if type == StorageType.LATEST_FINAL:
            return await asyncio.to_thread(
                self._state_proxy.storage_read_finalized, Address(account), slot, index, le
            )
        return await asyncio.to_thread(
            self._state_proxy.storage_read, Address(account), slot, index, le
        )"""
assert host.count(old) == 1, "Unexpected Studio host version"
anchor = "    def storage_read(\n"
position = snapshot.index(anchor, snapshot.index("class _SnapshotView("))
method = '''    def storage_read_finalized(
        self, account: Address, slot: bytes, index: int, le: int, /
    ) -> bytes:
        # Use the immutable execution snapshot. Accepted slot caches and local
        # writes must never leak into a finalized read.
        snap = self._get_snapshot(account)
        raw = snap.states.get("finalized", {}).get(self._slot_key(slot))
        data = base64.b64decode(raw) if raw is not None else b""
        return data[index:index + le].ljust(le, b"\\x00")

'''
assert "def storage_read_finalized(" not in snapshot
host = host.replace(old, new)
snapshot = snapshot[:position] + method + snapshot[position:]
compile(host, str(host_path), "exec")
compile(snapshot, str(snapshot_path), "exec")
host_path.write_text(host)
snapshot_path.write_text(snapshot)
print("Bevor local Studio compatibility: finalized reads use finalized snapshot storage.")
