"""Local two-contract harness with queued messages and a simulated GEN ledger."""

import copy
import json
from datetime import datetime, timezone

import pytest
from glsim.engine import SimEngine
from glsim.state import StateStore

CLIENT = "0x" + "11" * 20
AUDITOR = "0x" + "22" * 20
STRANGER = "0x" + "33" * 20
START = 1780000000
DAY = 86400
URL = "https://evidence.example/incident.txt"
QUOTE = "The audited Vault at 0xabc on Ethereum lost funds through a missed reentrancy defect."
TERMS = {
    "project": "Client Vault",
    "chain": "Ethereum",
    "deployment": "0xabc",
    "audited_commit": "a" * 40,
    "scope": "Vault.sol withdrawals and accounting",
    "exclusions": "Later code changes and client key compromise",
    "report": "The auditor reported no reentrancy issues in Vault.sol.",
    "liability": "The auditor is liable for missed in-scope defects that cause an exploit.",
}


def answer(hack="yes", scope="yes", liable="yes"):
    return {
        "hack_occurred": hack,
        "within_scope": scope,
        "auditor_liable": liable,
        "rationale": "The exploit matches the agreed deployment, revision, and missed defect.",
        "citations": [{"url": URL, "quote": QUOTE}],
    }


class Network:
    def __init__(self):
        self.engine = SimEngine(StateStore(seed="bevor-tests"))
        self.engine.activate()
        self.vm = self.engine.vm
        self.governor, _ = self.engine.deploy(
            "contracts/bevor_governor.py", sender=CLIENT
        )
        self.protocol, _ = self.engine.deploy(
            "contracts/bevor_protocol.py", [self.governor], sender=CLIENT
        )
        self.messages = []
        self.transfers = []
        self.ledger = {
            CLIENT.lower(): 10**30,
            AUDITOR.lower(): 0,
            self.protocol.lower(): 0,
        }
        original_hook = self.vm._gl_call_hook

        def hook(vm, request):
            if "EthSend" in request:
                data = request["EthSend"]
                sender = "0x" + vm._to_bytes(vm._contract_address).hex()
                recipient = data["address"].as_hex.lower()
                amount = data["value"]
                if self.ledger.get(sender, 0) < amount:
                    raise RuntimeError("Insufficient simulated GEN")
                self.ledger[sender] -= amount
                self.ledger[recipient] = self.ledger.get(recipient, 0) + amount
                self.transfers.append((sender, recipient, amount))
                assert data["calldata"] == b""
                return {"ok": None}
            if "PostMessage" in request:
                self.messages.append(
                    (
                        "0x" + vm._to_bytes(vm._contract_address).hex(),
                        request["PostMessage"],
                    )
                )
                return {"ok": None}
            return original_hook(vm, request)

        self.vm._gl_call_hook = hook
        self.warp(START)
        self.mock(answer())

    def warp(self, seconds):
        from genlayer import gl

        timestamp = datetime.fromtimestamp(seconds, timezone.utc).isoformat()
        self.vm.warp(timestamp)
        # genlayer-test v0.29 updates datetime.now(), but not message_raw.
        gl.message_raw["datetime"] = timestamp

    def mock(self, result, body=QUOTE):
        self.vm.clear_mocks()
        self.vm.mock_web(r"https://evidence\.example/.*", {"status": 200, "body": body})
        self.vm.mock_llm(
            r".*", json.dumps(result) if not isinstance(result, str) else result
        )

    def call(self, contract, method, *args, sender=CLIENT, value=0, consensus=False):
        storage = {key: data.snapshot() for key, data in self.engine._storages.items()}
        ledger, messages, transfers = copy.deepcopy(
            (self.ledger, self.messages, self.transfers)
        )
        self.vm.value = value
        self.vm._captured_validators.clear()
        if value:
            assert self.ledger.get(sender.lower(), 0) >= value
            self.ledger[sender.lower()] -= value
            self.ledger[contract.lower()] = self.ledger.get(contract.lower(), 0) + value
        try:
            result = self.engine.call_method(
                contract, method, list(args), sender=sender
            )
            if consensus:
                from genlayer import gl

                for leader_result, _, validator in self.vm._captured_validators:
                    for _ in range(3):
                        if not validator(gl.vm.Return(calldata=leader_result)):
                            raise RuntimeError("Validator disagreement")
            return result
        except Exception:
            for key, data in storage.items():
                self.engine._storages[key].restore(data)
            self.ledger, self.messages, self.transfers = ledger, messages, transfers
            raise
        finally:
            self.vm.value = 0

    def create(self, amount=1000, duration=10 * DAY, cliff=0, accept=True, terms=None):
        audit_id = self.call(
            self.protocol,
            "create_audit",
            AUDITOR,
            duration,
            cliff,
            json.dumps(TERMS if terms is None else terms),
            value=amount,
        )
        if accept:
            self.call(self.protocol, "accept_audit", audit_id, sender=AUDITOR)
        return audit_id

    def read(self, audit_id="1"):
        return self.call(self.protocol, "get_audit", audit_id)

    def claim(self, audit_id="1", at=START + 2 * DAY):
        self.warp(at)
        return self.call(
            self.protocol, "open_claim", audit_id, "The vault was exploited.", [URL]
        )

    def decide(self, audit_id="1", at=START + 3 * DAY, consensus=True):
        self.warp(at)
        return self.call(
            self.governor, "adjudicate", self.protocol, audit_id, consensus=consensus
        )

    def deliver(self):
        sender, message = self.messages.pop(0)
        assert message["on"] == "finalized"
        call = message["calldata"]
        return self.call(
            message["address"].as_hex, call["method"], *call["args"], sender=sender
        )

    def decision(self, audit_id="1"):
        claim_id = self.read(audit_id)["claim_id"]
        return self.call(
            self.governor, "get_decision", self.protocol, audit_id, claim_id
        )


@pytest.fixture
def net():
    network = Network()
    yield network
    network.engine.deactivate()
