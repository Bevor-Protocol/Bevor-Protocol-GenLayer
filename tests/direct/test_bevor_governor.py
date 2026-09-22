import json
import pytest
from .conftest import AUDITOR, CLIENT, START, DAY, QUOTE, URL, answer


@pytest.mark.parametrize(
    "flags,verdict",
    [
        (("yes", "yes", "yes"), "liable"),
        (("no", "unknown", "unknown"), "not_liable"),
        (("yes", "no", "no"), "not_liable"),
        (("yes", "yes", "no"), "not_liable"),
        (("unknown", "unknown", "unknown"), "inconclusive"),
        (("yes", "unknown", "yes"), "inconclusive"),
    ],
)
def test_decision_requires_all_three_positive_findings(net, flags, verdict):
    net.create()
    net.claim()
    net.mock(answer(*flags))
    net.decide()
    result = net.decision()
    assert result["verdict"] == verdict
    assert result["evidence_hashes"][0]["url"] == URL
    assert bool(net.messages) == (verdict != "inconclusive")


def test_cannot_adjudicate_before_response_window(net):
    net.create()
    net.claim()
    with pytest.raises(Exception, match="response window"):
        net.decide(at=START + 2 * DAY + 1)
    assert not net.messages


def test_inconclusive_can_retry_without_releasing_funds(net):
    net.create()
    net.claim()
    net.mock(answer("unknown", "unknown", "unknown"))
    net.decide()
    assert net.read()["state"] == "disputed"
    assert not net.transfers
    net.mock(answer())
    net.decide(at=START + 4 * DAY)
    net.deliver()
    assert net.read()["state"] == "terminated"


def test_retry_delivery_does_not_rerun_inference_or_double_refund(net):
    net.create()
    net.claim()
    net.decide()
    net.mock("broken JSON")
    net.decide(at=START + 4 * DAY)
    assert len(net.messages) == 2
    net.deliver()
    net.deliver()
    assert net.read()["refunded"] == 800
    assert len(net.transfers) == 1


@pytest.mark.parametrize(
    "result",
    [
        "not JSON",
        [],
        {**answer(), "hack_occurred": True},
        {**answer(), "within_scope": "true"},
        {**answer(), "rationale": ""},
        {**answer(), "citations": []},
        {
            **answer(),
            "citations": [
                {"url": URL, "quote": "Invented quotation that is not in the evidence."}
            ],
        },
        {**answer(), "citations": [{"url": "https://fake.example/", "quote": QUOTE}]},
    ],
)
def test_malformed_or_uncited_decision_leaves_claim_pending(net, result):
    net.create()
    net.claim()
    net.mock(result)
    with pytest.raises(Exception, match="LLM_ERROR"):
        net.decide()
    assert net.read()["state"] == "disputed"
    assert not net.messages and not net.transfers
    with pytest.raises(Exception, match="not found"):
        net.decision()


def test_fenced_json_supported(net):
    net.create()
    net.claim()
    net.mock("```json\n" + json.dumps(answer()) + "\n```")
    net.decide()
    assert net.decision()["verdict"] == "liable"


@pytest.mark.parametrize("line", [1, "1"])
def test_citation_lines_copy_exact_source_text_not_model_quote(net, line):
    net.create()
    net.claim()
    exact = "    " + QUOTE
    net.mock({**answer(), "citations": [{"url": URL, "line": line, "quote": "Invented explanation"}]}, body="Title\n" + exact)
    net.decide()
    assert net.decision()["citations"] == [{"url": URL, "quote": exact}]


@pytest.mark.parametrize("line", [-1, 999, True, 0.5, "-1", "bogus"])
def test_invalid_source_line_cannot_settle(net, line):
    net.create()
    net.claim()
    net.mock({**answer(), "citations": [{"url": URL, "line": line}]})
    with pytest.raises(Exception, match="LLM_ERROR"):
        net.decide()
    assert not net.messages and not net.transfers


def test_missing_evidence_does_not_decide(net):
    net.create()
    net.claim()
    net.vm.clear_mocks()
    net.vm.mock_web(r".*", {"status": 503, "body": "Unavailable"})
    with pytest.raises(Exception, match="EXTERNAL"):
        net.decide()
    assert not net.messages


def test_independent_validator_disagreement_reverts_decision(net, monkeypatch):
    net.create()
    net.claim()
    from genlayer import gl

    results = iter([answer(), answer(liable="no")])
    monkeypatch.setattr(gl.nondet, "exec_prompt", lambda *args, **kwargs: next(results))
    with pytest.raises(RuntimeError, match="Validator disagreement"):
        net.decide()
    assert not net.messages
    assert net.read()["state"] == "disputed"
    with pytest.raises(Exception, match="not found"):
        net.decision()


def test_validators_refetch_evidence(net, monkeypatch):
    net.create()
    net.claim()
    from genlayer import gl

    original = gl.nondet.web.get
    calls = []

    def fetch(url):
        calls.append(url)
        return original(url)

    monkeypatch.setattr(gl.nondet.web, "get", fetch)
    net.decide()
    assert calls == [URL] * 4


def test_validator_rejects_changed_source_content(net, monkeypatch):
    net.create()
    net.claim()
    from genlayer import gl
    from types import SimpleNamespace

    bodies = iter([QUOTE, QUOTE + " Additional source revision."])
    monkeypatch.setattr(
        gl.nondet.web,
        "get",
        lambda url: SimpleNamespace(status=200, body=next(bodies).encode()),
    )
    with pytest.raises(RuntimeError, match="Validator disagreement"):
        net.decide()
    assert not net.messages


def test_auditor_defense_reaches_inference(net, monkeypatch):
    net.create()
    net.claim()
    net.call(
        net.protocol,
        "submit_response",
        "1",
        "Already disclosed in finding 12.",
        [],
        sender=AUDITOR,
    )
    from genlayer import gl

    prompts = []

    def infer(prompt, **kwargs):
        prompts.append(prompt)
        return answer(liable="no")

    monkeypatch.setattr(gl.nondet, "exec_prompt", infer)
    net.decide()
    net.deliver()
    assert all("Already disclosed in finding 12." in p for p in prompts)
    assert net.read()["state"] == "active"


def test_unrelated_governor_cannot_adjudicate(net):
    from .conftest import STRANGER

    protocol, _ = net.engine.deploy(
        "contracts/bevor_protocol.py", [STRANGER], sender=CLIENT
    )
    net.protocol = protocol
    net.ledger[protocol.lower()] = 0
    net.create()
    net.claim()
    with pytest.raises(Exception, match="does not govern"):
        net.decide()


def test_validator_does_not_require_identical_rationale(net, monkeypatch):
    net.create()
    net.claim()
    from genlayer import gl

    responses = iter(
        [
            answer(),
            {**answer(), "rationale": "Independent review reaches the same findings."},
            answer(),
            answer(),
        ]
    )
    monkeypatch.setattr(
        gl.nondet, "exec_prompt", lambda *args, **kwargs: next(responses)
    )
    net.decide()
    assert len(net.messages) == 1


def test_broken_auditor_source_cannot_block_supported_claim(net):
    net.create()
    net.claim()
    net.call(
        net.protocol,
        "submit_response",
        "1",
        "See my evidence.",
        ["https://defense.example/missing.txt"],
        sender=AUDITOR,
    )
    net.vm.mock_web(
        r"https://defense\.example/.*", {"status": 503, "body": "Unavailable"}
    )
    net.decide()
    assert net.decision()["verdict"] == "liable"
    assert net.decision()["evidence_hashes"][1]["error"] == "unavailable"
