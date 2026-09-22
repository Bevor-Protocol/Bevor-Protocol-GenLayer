# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse
from genlayer import *


@gl.evm.contract_interface
class Wallet:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Audit:
    client: Address
    auditor: Address
    amount: u256
    withdrawn: u256
    refunded: u256
    duration: u256
    cliff: u256
    start: u256
    state: str
    terms: str
    claim: str
    response: str
    claim_id: str
    claim_opened: u256
    claim_deadline: u256
    outcome: str


def _now() -> int:
    return int(
        datetime.fromisoformat(
            gl.message_raw["datetime"].replace("Z", "+00:00")
        ).timestamp()
    )


def _text(value: str, label: str, limit: int) -> None:
    if not value.strip() or len(value) > limit:
        raise gl.vm.UserError(f"Invalid {label}")


def _sources(urls: list[str]) -> None:
    if not 1 <= len(urls) <= 5 or len(set(urls)) != len(urls):
        raise gl.vm.UserError("Provide one to five distinct evidence URLs")
    for url in urls:
        parsed = urlparse(url)
        if (
            len(url) > 2048
            or parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise gl.vm.UserError("Evidence URLs must be absolute HTTPS URLs")


class BevorProtocol(gl.Contract):
    governor: Address
    next_audit_id: u256
    audits: TreeMap[str, Audit]

    def __init__(self, governor: str):
        address = Address(governor)
        if address == Address("0x" + "00" * 20):
            raise gl.vm.UserError("Governor cannot be the zero address")
        self.governor = address
        self.next_audit_id = u256(1)

    def _audit(self, audit_id: str) -> Audit:
        if audit_id not in self.audits:
            raise gl.vm.UserError("Audit not found")
        return self.audits[audit_id]

    def _vested(self, audit: Audit, timestamp: int) -> int:
        if audit.state in ("proposed", "cancelled"):
            return 0
        if audit.state in ("disputed", "terminated"):
            timestamp = min(timestamp, int(audit.claim_opened))
        elapsed = max(0, timestamp - int(audit.start))
        if elapsed < audit.cliff:
            return 0
        return (
            int(audit.amount) * min(elapsed, int(audit.duration)) // int(audit.duration)
        )

    def _pay(self, recipient: Address, amount: int) -> None:
        if amount > 0:
            Wallet(recipient).emit_transfer(value=u256(amount))

    @gl.public.write.payable
    def create_audit(
        self, auditor: str, duration_seconds: int, cliff_seconds: int, terms_json: str
    ) -> str:
        auditor_address = Address(auditor)
        if auditor_address in (gl.message.sender_address, Address("0x" + "00" * 20)):
            raise gl.vm.UserError(
                "Client and auditor must be distinct nonzero addresses"
            )
        if (
            not 1 <= duration_seconds <= 10 * 365 * 86400
            or not 0 <= cliff_seconds <= duration_seconds
        ):
            raise gl.vm.UserError("Invalid vesting duration or cliff")
        if gl.message.value <= 0:
            raise gl.vm.UserError("Send the full audit payment as GEN")
        _text(terms_json, "audit terms", 48000)
        try:
            terms = json.loads(terms_json)
        except (ValueError, TypeError):
            raise gl.vm.UserError("Audit terms must be JSON")
        required = (
            "project",
            "chain",
            "deployment",
            "audited_commit",
            "scope",
            "exclusions",
            "report",
            "liability",
        )
        if not isinstance(terms, dict) or set(terms) != set(required):
            raise gl.vm.UserError("Audit terms must contain all required fields")
        for field in required:
            if not isinstance(terms[field], str):
                raise gl.vm.UserError("Audit term values must be strings")
            _text(terms[field], field, 20000)
        audit_id = str(self.next_audit_id)
        self.next_audit_id = u256(int(self.next_audit_id) + 1)
        self.audits[audit_id] = Audit(
            gl.message.sender_address,
            auditor_address,
            gl.message.value,
            u256(0),
            u256(0),
            u256(duration_seconds),
            u256(cliff_seconds),
            u256(0),
            "proposed",
            json.dumps(terms, sort_keys=True),
            "",
            "",
            "",
            u256(0),
            u256(0),
            "",
        )
        return audit_id

    @gl.public.write
    def accept_audit(self, audit_id: str) -> None:
        audit = self._audit(audit_id)
        if gl.message.sender_address != audit.auditor:
            raise gl.vm.UserError("Only the auditor can accept")
        if audit.state != "proposed":
            raise gl.vm.UserError("Audit is not awaiting acceptance")
        audit.start = u256(_now())
        audit.state = "active"

    @gl.public.write
    def cancel_audit(self, audit_id: str) -> None:
        audit = self._audit(audit_id)
        if gl.message.sender_address != audit.client:
            raise gl.vm.UserError("Only the client can cancel")
        if audit.state != "proposed":
            raise gl.vm.UserError("Only an unaccepted audit can be cancelled")
        audit.state = "cancelled"
        audit.refunded = audit.amount
        self._pay(audit.client, int(audit.amount))

    @gl.public.write
    def withdraw(self, audit_id: str) -> None:
        audit = self._audit(audit_id)
        if gl.message.sender_address != audit.auditor:
            raise gl.vm.UserError("Only the auditor can withdraw")
        if audit.state not in ("active", "terminated"):
            raise gl.vm.UserError("Withdrawals are not available")
        amount = self._vested(audit, _now()) - int(audit.withdrawn)
        if amount <= 0:
            raise gl.vm.UserError("No vested payment is available")
        audit.withdrawn = u256(int(audit.withdrawn) + amount)
        self._pay(audit.auditor, amount)

    @gl.public.write
    def open_claim(
        self, audit_id: str, allegation: str, evidence_urls: list[str]
    ) -> str:
        audit = self._audit(audit_id)
        if gl.message.sender_address != audit.client:
            raise gl.vm.UserError("Only the client can open a claim")
        now = _now()
        if audit.state != "active" or audit.claim_id:
            raise gl.vm.UserError("Only one claim is allowed per active audit")
        if now >= int(audit.start) + int(audit.duration):
            raise gl.vm.UserError("The vesting period has ended")
        _text(allegation, "allegation", 12000)
        _sources(evidence_urls)
        claim = json.dumps(
            {"allegation": allegation, "evidence_urls": evidence_urls}, sort_keys=True
        )
        claim_id = hashlib.sha256(
            (audit_id + ":" + str(now) + ":" + claim).encode()
        ).hexdigest()
        audit.claim = claim
        audit.claim_id = claim_id
        audit.claim_opened = u256(now)
        audit.claim_deadline = u256(now + 7 * 86400)
        audit.state = "disputed"
        return claim_id

    @gl.public.write
    def submit_response(
        self, audit_id: str, response: str, evidence_urls: list[str]
    ) -> None:
        audit = self._audit(audit_id)
        if gl.message.sender_address != audit.auditor:
            raise gl.vm.UserError("Only the auditor can respond")
        if (
            audit.state != "disputed"
            or audit.response
            or _now() >= int(audit.claim_opened) + 86400
        ):
            raise gl.vm.UserError(
                "The response window is closed or a response already exists"
            )
        _text(response, "response", 12000)
        if evidence_urls:
            _sources(evidence_urls)
        audit.response = json.dumps(
            {"statement": response, "evidence_urls": evidence_urls}, sort_keys=True
        )

    @gl.public.write
    def apply_decision(self, audit_id: str, claim_id: str, verdict: str) -> None:
        if gl.message.sender_address != self.governor:
            raise gl.vm.UserError("Only the governor can settle a claim")
        audit = self._audit(audit_id)
        if (
            not claim_id
            or claim_id != audit.claim_id
            or verdict not in ("liable", "not_liable")
        ):
            raise gl.vm.UserError("Invalid claim decision")
        if audit.outcome == verdict:
            return
        if audit.state != "disputed" or _now() >= audit.claim_deadline:
            raise gl.vm.UserError("Claim is closed or expired")
        if _now() < int(audit.claim_opened) + 86400:
            raise gl.vm.UserError("The auditor response window is still open")
        audit.outcome = verdict
        if verdict == "liable":
            refund = int(audit.amount) - self._vested(audit, int(audit.claim_opened))
            audit.state = "terminated"
            audit.refunded = u256(refund)
            self._pay(audit.client, refund)
        else:
            audit.state = "active"

    @gl.public.write
    def expire_claim(self, audit_id: str) -> None:
        audit = self._audit(audit_id)
        if audit.state != "disputed" or _now() < audit.claim_deadline:
            raise gl.vm.UserError("Claim is not eligible for expiry")
        audit.state = "active"
        audit.outcome = "expired"

    @gl.public.view
    def list_audits(self, cursor: int = 0, limit: int = 20) -> dict:
        if cursor < 0 or not 1 <= limit <= 50:
            raise gl.vm.UserError("Invalid pagination")
        total = int(self.next_audit_id) - 1
        start = total if cursor == 0 else min(cursor, total)
        end = max(0, start - limit)
        summaries = []
        for number in range(start, end, -1):
            audit = self.get_audit(str(number))
            audit["project"] = audit["terms"]["project"]
            for field in ("terms", "claim", "response"):
                del audit[field]
            summaries.append(audit)
        return {
            "audits": summaries,
            "next_cursor": end,
            "total": total,
            "governor": self.governor.as_hex,
        }

    @gl.public.view
    def get_audit(self, audit_id: str) -> dict:
        audit = self._audit(audit_id)
        vested = self._vested(audit, _now())
        return {
            "audit_id": audit_id,
            "governor": self.governor.as_hex,
            "client": audit.client.as_hex,
            "auditor": audit.auditor.as_hex,
            "amount": int(audit.amount),
            "withdrawn": int(audit.withdrawn),
            "refunded": int(audit.refunded),
            "vested": vested,
            "withdrawable": max(0, vested - int(audit.withdrawn))
            if audit.state in ("active", "terminated")
            else 0,
            "duration_seconds": int(audit.duration),
            "cliff_seconds": int(audit.cliff),
            "start": int(audit.start),
            "state": audit.state,
            "terms": json.loads(audit.terms),
            "claim": json.loads(audit.claim) if audit.claim else None,
            "response": json.loads(audit.response) if audit.response else None,
            "claim_id": audit.claim_id,
            "claim_opened": int(audit.claim_opened),
            "response_deadline": int(audit.claim_opened) + 86400
            if audit.claim_id
            else 0,
            "claim_deadline": int(audit.claim_deadline),
            "outcome": audit.outcome,
        }
