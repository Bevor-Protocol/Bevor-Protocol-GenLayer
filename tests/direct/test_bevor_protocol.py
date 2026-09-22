import json
import pytest
from .conftest import AUDITOR, CLIENT, STRANGER, START, DAY, TERMS, URL, answer


def test_acceptance_and_full_vesting(net):
    audit = net.create(accept=False)
    assert net.read(audit)["state"] == "proposed"
    net.warp(START + DAY)
    assert net.read(audit)["vested"] == 0
    net.call(net.protocol, "accept_audit", audit, sender=AUDITOR)
    net.warp(START + 6 * DAY)
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 500
    net.warp(START + 11 * DAY)
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 1000
    assert net.ledger[net.protocol.lower()] == 0
    with pytest.raises(Exception, match="No vested payment"):
        net.call(net.protocol, "withdraw", audit, sender=AUDITOR)


def test_cliff_and_integer_rounding(net):
    audit = net.create(amount=7, duration=10, cliff=3)
    net.warp(START + 2)
    assert net.read(audit)["vested"] == 0
    net.warp(START + 3)
    assert net.read(audit)["vested"] == 2
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    net.warp(START + 10)
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 7


def test_cancel_unaccepted_refunds_once(net):
    before = net.ledger[CLIENT]
    audit = net.create(accept=False)
    net.call(net.protocol, "cancel_audit", audit)
    assert net.ledger[CLIENT] == before
    assert net.read(audit)["refunded"] == 1000
    with pytest.raises(Exception, match="unaccepted"):
        net.call(net.protocol, "cancel_audit", audit)
    with pytest.raises(Exception, match="awaiting acceptance"):
        net.call(net.protocol, "accept_audit", audit, sender=AUDITOR)


@pytest.mark.parametrize(
    "method,args",
    [
        ("accept_audit", ()),
        ("cancel_audit", ()),
        ("withdraw", ()),
        ("open_claim", ("hack", [URL])),
        ("submit_response", ("defense", [])),
    ],
)
def test_party_access_control(net, method, args):
    audit = net.create(accept=False)
    with pytest.raises(Exception, match="Only"):
        net.call(net.protocol, method, audit, *args, sender=STRANGER)


@pytest.mark.parametrize(
    "duration,cliff,amount",
    [(0, 0, 100), (-1, 0, 100), (10, -1, 100), (10, 11, 100), (10, 0, 0)],
)
def test_invalid_funding_terms_leave_no_audit(net, duration, cliff, amount):
    with pytest.raises(Exception):
        net.create(amount=amount, duration=duration, cliff=cliff)
    with pytest.raises(Exception, match="not found"):
        net.read()


@pytest.mark.parametrize(
    "terms",
    [{}, {**TERMS, "scope": ""}, {**TERMS, "report": 3}, {**TERMS, "extra": "x"}],
)
def test_requires_complete_immutable_terms(net, terms):
    with pytest.raises(Exception, match="term|scope|field"):
        net.create(terms=terms)


def test_confirmed_liability_refunds_only_unvested_and_keeps_accrued_pay(net):
    before = net.ledger[CLIENT]
    audit = net.create()
    net.warp(START + DAY)
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    claim = net.claim(audit)
    assert net.read(audit)["withdrawable"] == 0
    with pytest.raises(Exception, match="not available"):
        net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    net.decide(audit)
    assert net.read(audit)["state"] == "disputed"
    assert net.ledger[CLIENT] == before - 1000
    net.deliver()
    result = net.read(audit)
    assert (
        result["state"],
        result["refunded"],
        result["vested"],
        result["withdrawn"],
    ) == ("terminated", 800, 200, 100)
    assert net.ledger[CLIENT] == before - 200
    net.warp(START + 100 * DAY)
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 200
    assert net.ledger[net.protocol.lower()] == 0
    count = len(net.transfers)
    net.call(
        net.protocol, "apply_decision", audit, claim, "liable", sender=net.governor
    )
    assert len(net.transfers) == count


def test_claim_before_cliff_refunds_all(net):
    audit = net.create(cliff=5 * DAY)
    net.claim(audit)
    net.decide(audit)
    net.deliver()
    assert net.read(audit)["refunded"] == 1000
    assert net.read(audit)["withdrawable"] == 0


def test_rejected_claim_catches_up_original_schedule(net):
    audit = net.create()
    net.claim(audit)
    net.mock(answer(scope="no"))
    net.decide(audit, at=START + 4 * DAY)
    net.deliver()
    assert net.read(audit)["state"] == "active"
    assert net.read(audit)["withdrawable"] == 400
    net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 400
    with pytest.raises(Exception, match="one claim"):
        net.claim(audit, at=START + 5 * DAY)


def test_expiry_is_permissionless_and_rejects_late_decision(net):
    audit = net.create()
    claim = net.claim(audit)
    with pytest.raises(Exception, match="eligible"):
        net.call(net.protocol, "expire_claim", audit, sender=STRANGER)
    net.decide(audit)
    net.warp(START + 9 * DAY)
    with pytest.raises(Exception, match="expired"):
        net.deliver()
    net.call(net.protocol, "expire_claim", audit, sender=STRANGER)
    assert net.read(audit)["outcome"] == "expired"
    assert net.read(audit)["withdrawable"] == 900
    with pytest.raises(Exception, match="closed|expired"):
        net.call(
            net.protocol, "apply_decision", audit, claim, "liable", sender=net.governor
        )


def test_spoofed_or_mismatched_decisions_cannot_release_funds(net):
    audit = net.create()
    claim = net.claim(audit)
    net.warp(START + 3 * DAY)
    with pytest.raises(Exception, match="Only the governor"):
        net.call(
            net.protocol, "apply_decision", audit, claim, "liable", sender=STRANGER
        )
    for wrong_id, verdict in [("wrong", "liable"), (claim, "inconclusive")]:
        with pytest.raises(Exception, match="Invalid claim"):
            net.call(
                net.protocol,
                "apply_decision",
                audit,
                wrong_id,
                verdict,
                sender=net.governor,
            )
    assert net.read(audit)["state"] == "disputed"
    assert not net.transfers


def test_other_audit_funds_are_isolated(net):
    first = net.create(amount=1000)
    second = net.create(amount=3000)
    net.claim(first)
    net.decide(first)
    net.deliver()
    net.warp(START + 10 * DAY)
    net.call(net.protocol, "withdraw", second, sender=AUDITOR)
    net.call(net.protocol, "withdraw", first, sender=AUDITOR)
    assert net.ledger[AUDITOR] == 3200
    assert net.ledger[net.protocol.lower()] == 0


def test_claim_at_end_rejected(net):
    audit = net.create()
    with pytest.raises(Exception, match="ended"):
        net.claim(audit, at=START + 10 * DAY)


@pytest.mark.parametrize(
    "urls",
    [
        [],
        [URL, URL],
        ["http://example.com"],
        ["https://user:pass@example.com"],
        ["https://example.com/#x"],
        [URL] * 6,
    ],
)
def test_evidence_url_validation(net, urls):
    audit = net.create()
    with pytest.raises(Exception, match="URL"):
        net.call(net.protocol, "open_claim", audit, "hack", urls)
    assert net.read(audit)["state"] == "active"


def test_auditor_defense_is_fixed_before_inference(net):
    audit = net.create()
    net.claim(audit)
    net.call(
        net.protocol,
        "submit_response",
        audit,
        "The finding was disclosed.",
        [],
        sender=AUDITOR,
    )
    assert net.read(audit)["response"]["statement"] == "The finding was disclosed."
    with pytest.raises(Exception, match="response already"):
        net.call(
            net.protocol, "submit_response", audit, "replacement", [], sender=AUDITOR
        )
    net.warp(START + 3 * DAY)
    with pytest.raises(Exception, match="window is closed"):
        net.call(net.protocol, "submit_response", audit, "late", [], sender=AUDITOR)


def test_cannot_cancel_an_accepted_agreement(net):
    audit = net.create()
    with pytest.raises(Exception, match="unaccepted"):
        net.call(net.protocol, "cancel_audit", audit)
    assert net.read(audit)["state"] == "active"


@pytest.mark.parametrize("auditor", [CLIENT, "0x" + "00" * 20])
def test_invalid_auditor(net, auditor):
    with pytest.raises(Exception, match="distinct nonzero"):
        net.call(
            net.protocol, "create_audit", auditor, 100, 0, json.dumps(TERMS), value=1000
        )


@pytest.mark.parametrize(
    "amount,duration,cutoff", [(1, 10, 1), (17, 31, 13), (10**24, 100000, 99999)]
)
def test_refund_rounding_conserves_every_unit(net, amount, duration, cutoff):
    audit = net.create(amount=amount, duration=duration)
    net.claim(audit, at=START + cutoff)
    net.decide(audit, at=START + cutoff + DAY)
    net.deliver()
    result = net.read(audit)
    assert result["refunded"] + result["vested"] == amount
    assert result["vested"] == amount * cutoff // duration
    if result["vested"]:
        net.call(net.protocol, "withdraw", audit, sender=AUDITOR)
    assert net.ledger[net.protocol.lower()] == 0


def test_list_audits_is_paginated_newest_first(net):
    for amount in [10, 20, 30]:
        net.create(amount=amount)
    page = net.call(net.protocol, "list_audits", 0, 2)
    assert [a["audit_id"] for a in page["audits"]] == ["3", "2"]
    assert page["total"] == 3 and page["next_cursor"] == 1
    assert page["governor"].lower() == net.governor.lower()
    assert "terms" not in page["audits"][0]
    assert page["audits"][0]["project"] == TERMS["project"]
    last = net.call(net.protocol, "list_audits", page["next_cursor"], 2)
    assert [a["audit_id"] for a in last["audits"]] == ["1"]
    assert last["next_cursor"] == 0


def test_empty_list_and_invalid_pagination(net):
    assert net.call(net.protocol, "list_audits", 0, 20)["audits"] == []
    for cursor, limit in [(-1, 20), (0, 0), (0, 51)]:
        with pytest.raises(Exception, match="pagination"):
            net.call(net.protocol, "list_audits", cursor, limit)
