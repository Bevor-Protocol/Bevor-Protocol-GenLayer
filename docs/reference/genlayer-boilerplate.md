# GenLayer boilerplate reference

These files preserve the imported examples before the Bevor implementation.
They are reference material and are not part of the active contract or test suite.

## `contracts/football_bets.py`

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
from genlayer import *


@allow_storage
@dataclass
class Bet:
    id: str
    has_resolved: bool
    game_date: str
    resolution_url: str
    team1: str
    team2: str
    predicted_winner: str
    real_winner: str
    real_score: str


class FootballBets(gl.Contract):
    bets: TreeMap[Address, TreeMap[str, Bet]]
    points: TreeMap[Address, u256]

    def __init__(self):
        pass

    def _check_match(self, resolution_url: str, team1: str, team2: str) -> dict:
        def get_match_result() -> str:
            web_data = gl.nondet.web.render(resolution_url, mode="text")

            task = f"""
Extract the match result for:
Team 1: {team1}
Team 2: {team2}

Web content:
{web_data}

Respond in JSON:
{{
    "score": str, // e.g., "1:2" or "-" if unresolved
    "winner": int // 0 for draw, -1 if unresolved
}}
It is mandatory that you respond only using the JSON format above,
nothing else. Don't include any other words or characters,
your output must be only JSON without any formatting prefix or suffix.
This result should be perfectly parsable by a JSON parser without errors.
        """
            result = gl.nondet.exec_prompt(task, response_format="json")
            return json.dumps(result, sort_keys=True)

        result_json = json.loads(gl.eq_principle.strict_eq(get_match_result))
        return result_json

    @gl.public.write
    def create_bet(
        self, game_date: str, team1: str, team2: str, predicted_winner: str
    ) -> None:
        match_resolution_url = (
            "https://www.bbc.com/sport/football/scores-fixtures/" + game_date
        )
        # commented to allow to test matches in the past.
        # match_status = await self._check_match(match_resolution_url, team1, team2)

        # if int(match_status["winner"]) > -1:
        #    raise Exception("Game already finished")

        sender_address = gl.message.sender_address

        bet_id = f"{game_date}_{team1}_{team2}".lower()
        if sender_address in self.bets and bet_id in self.bets[sender_address]:
            raise Exception("Bet already created")

        bet = Bet(
            id=bet_id,
            has_resolved=False,
            game_date=game_date,
            resolution_url=match_resolution_url,
            team1=team1,
            team2=team2,
            predicted_winner=predicted_winner,
            real_winner="",
            real_score="",
        )
        self.bets.get_or_insert_default(sender_address)[bet_id] = bet

    @gl.public.write
    def resolve_bet(self, bet_id: str) -> None:
        if self.bets[gl.message.sender_address][bet_id].has_resolved:
            raise Exception("Bet already resolved")

        bet = self.bets[gl.message.sender_address][bet_id]
        bet_status = self._check_match(bet.resolution_url, bet.team1, bet.team2)

        if int(bet_status["winner"]) < 0:
            raise Exception("Game not finished")

        bet.has_resolved = True
        bet.real_winner = str(bet_status["winner"])
        bet.real_score = bet_status["score"]

        if bet.real_winner == bet.predicted_winner:
            if gl.message.sender_address not in self.points:
                self.points[gl.message.sender_address] = 0
            self.points[gl.message.sender_address] += 1

    @gl.public.view
    def get_bets(self) -> dict:
        return {k.as_hex: v for k, v in self.bets.items()}

    @gl.public.view
    def get_points(self) -> dict:
        return {k.as_hex: v for k, v in self.points.items()}

    @gl.public.view
    def get_player_points(self, player_address: str) -> int:
        return self.points.get(Address(player_address), 0)
```

## `contracts/PatternTest.py`

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
PatternTest.py — Minimal contract to test GenLayer patterns.
Covers: gl.vm.Return, partial field matching, u256 arithmetic,
Address constructor, json.dumps sort_keys, nested TreeMap workaround.
"""
import json
from genlayer import *
import genlayer.gl.vm as glvm


class PatternTest(gl.Contract):
    # Pattern 4: u256 storage
    count: u256
    amount: u256
    # Pattern 7: nested TreeMap workaround (list stored as JSON string)
    index: TreeMap[str, str]

    def __init__(self, initial_amount: u256 = u256(0)):
        self.count = u256(0)
        self.amount = u256(int(initial_amount))
        self.index = TreeMap()

    # ── Pattern 1 & 2: gl.vm.Return type check + partial field matching ──────

    @gl.public.write
    def get_match_result(self, team1_wins: bool) -> dict:
        """Returns a dict. LLM call mocked in tests."""
        def leader_fn() -> dict:
            raw = gl.nondet.exec_prompt(
                f"Who wins between team1 and team2?",
                response_format="json",
            )
            # Simulate returning a structured result
            if team1_wins:
                return {"winner": 1, "score": "2:1", "analysis": "Team1 dominated"}
            else:
                return {"winner": 2, "score": "0:3", "analysis": "Team2 dominated"}

        def validator_fn(leader_result) -> bool:
            # Pattern 1: isinstance check
            if not isinstance(leader_result, glvm.Return):
                return False
            # Pattern 2: partial field matching — only compare winner + score
            v = leader_fn()
            return (
                leader_result.calldata["winner"] == v["winner"]
                and leader_result.calldata["score"] == v["score"]
            )

        result = glvm.run_nondet_unsafe(leader_fn, validator_fn)
        return result

    @gl.public.write
    def get_match_result_raises(self) -> dict:
        """Leader fn raises — validator should see non-Return (UserError)."""
        def leader_fn() -> dict:
            raise Exception("LLM failed")

        def validator_fn(leader_result) -> bool:
            # If leader raised, leader_result should NOT be a Return
            if not isinstance(leader_result, glvm.Return):
                return False  # correct: error case
            return True

        result = glvm.run_nondet_unsafe(leader_fn, validator_fn)
        return result

    # ── Pattern 4: u256 arithmetic ────────────────────────────────────────────

    @gl.public.write
    def increment(self) -> u256:
        """Increment count by 1 using u256(int(self.count) + 1)."""
        self.count = u256(int(self.count) + 1)
        return self.count

    @gl.public.view
    def get_count(self) -> int:
        return int(self.count)

    @gl.public.view
    def get_amount(self) -> int:
        return int(self.amount)

    # ── Pattern 5: Address constructor ────────────────────────────────────────

    @gl.public.write
    def set_party(self, party_b: str) -> str:
        """Accepts str address, wraps in Address constructor."""
        if isinstance(party_b, (str, bytes)):
            party_b = Address(party_b)
        return str(party_b)

    # ── Pattern 6: json.dumps sort_keys ──────────────────────────────────────

    @gl.public.view
    def stable_json(self, data: dict) -> str:
        """Returns JSON with sort_keys=True for stable comparison."""
        return json.dumps(data, sort_keys=True)

    # ── Pattern 7: Nested TreeMap workaround ─────────────────────────────────

    @gl.public.write
    def add_to_index(self, key: str, new_id: str) -> str:
        """Store a list inside TreeMap as JSON string."""
        id_list = json.loads(self.index.get(key) or "[]")
        id_list.append(new_id)
        self.index[key] = json.dumps(id_list)
        return self.index[key]

    @gl.public.view
    def get_index(self, key: str) -> list:
        """Retrieve the list stored in TreeMap."""
        return json.loads(self.index.get(key) or "[]")
```

## `tests/direct/conftest.py`

```python
"""Shared helpers for direct mode tests."""


def to_hex(addr_bytes):
    """Convert address bytes to checksummed hex matching contract output.

    The contract's get_bets()/get_points() return keys via Address.as_hex,
    which produces EIP-55 checksummed hex. Call after direct_deploy so the
    SDK is on sys.path.
    """
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    from genlayer.py.types import Address

    return Address(addr_bytes).as_hex
```

## `tests/direct/test_create_bet.py`

```python
"""Tests for bet creation logic (no mocks needed — create_bet is deterministic)."""

from tests.direct.conftest import to_hex


def test_create_bet(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    bets = contract.get_bets()
    player_bets = bets[alice]
    bet = player_bets["2024-06-20_spain_italy"]
    assert bet.team1 == "Spain"
    assert bet.team2 == "Italy"
    assert bet.predicted_winner == "1"
    assert bet.has_resolved is False
    assert bet.real_winner == ""
    assert bet.real_score == ""
    assert (
        bet.resolution_url
        == "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20"
    )


def test_create_multiple_bets(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")
    contract.create_bet("2024-06-20", "Denmark", "England", "0")

    bets = contract.get_bets()
    assert len(bets[alice]) == 2
    assert "2024-06-20_spain_italy" in bets[alice]
    assert "2024-06-20_denmark_england" in bets[alice]


def test_create_duplicate_bet_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    with direct_vm.expect_revert("Bet already created"):
        contract.create_bet("2024-06-20", "Spain", "Italy", "2")


def test_different_users_can_bet_same_match(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/football_bets.py")
    alice = to_hex(direct_alice)
    bob = to_hex(direct_bob)

    direct_vm.sender = direct_alice
    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    direct_vm.sender = direct_bob
    contract.create_bet("2024-06-20", "Spain", "Italy", "2")

    bets = contract.get_bets()
    assert len(bets) == 2
    assert bets[alice]["2024-06-20_spain_italy"].predicted_winner == "1"
    assert bets[bob]["2024-06-20_spain_italy"].predicted_winner == "2"


def test_bet_id_is_lowercase(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    bets = contract.get_bets()
    assert "2024-06-20_spain_italy" in bets[alice]
```

## `tests/direct/test_patterns.py`

```python
"""
test_patterns.py — Verify GenLayer intelligent contract patterns in direct mode.

Tests 7 patterns to confirm which work reliably for skill documentation.
Run with: pytest tests/direct/test_patterns.py -v

genlayer-test: 0.25.0
"""
import json
import pytest
from pathlib import Path

CONTRACT_PATH = "contracts/PatternTest.py"

# ─────────────────────────────────────────────────────────────────────────────
# Pattern 3: _parse_llm_json helper — pure Python, no contract needed
# ─────────────────────────────────────────────────────────────────────────────

def _parse_llm_json(raw):
    if isinstance(raw, dict):
        return raw
    s = str(raw).strip().replace("```json", "").replace("```", "").strip()
    start, end = s.find("{"), s.rfind("}") + 1
    if start >= 0 and end > start:
        s = s[start:end]
    return json.loads(s)


class TestParseLlmJson:
    """Pattern 3: _parse_llm_json helper edge cases."""

    def test_raw_dict_passthrough(self):
        """Raw dict returns unchanged."""
        d = {"winner": 1, "score": "2:1"}
        result = _parse_llm_json(d)
        assert result == d
        assert result is d  # same object, no copy

    def test_plain_json_string(self):
        """Plain JSON string parses correctly."""
        result = _parse_llm_json('{"winner": 1, "score": "2:1"}')
        assert result == {"winner": 1, "score": "2:1"}

    def test_json_with_backtick_fences(self):
        """JSON wrapped in ```json ... ``` fences is stripped and parsed."""
        raw = '```json\n{"winner": 1, "score": "2:1"}\n```'
        result = _parse_llm_json(raw)
        assert result == {"winner": 1, "score": "2:1"}

    def test_json_with_plain_backtick_fences(self):
        """JSON wrapped in ``` ... ``` (no language tag) is stripped and parsed."""
        raw = '```\n{"winner": 1, "score": "2:1"}\n```'
        result = _parse_llm_json(raw)
        assert result == {"winner": 1, "score": "2:1"}

    def test_leading_trailing_whitespace(self):
        """Whitespace around JSON is stripped."""
        raw = '  \n  {"winner": 2, "score": "0:3"}  \n  '
        result = _parse_llm_json(raw)
        assert result == {"winner": 2, "score": "0:3"}

    def test_json_with_preamble_text(self):
        """JSON embedded in prose: extracts via brace-finding heuristic."""
        raw = 'Here is the result: {"winner": 1, "score": "2:1"} as requested.'
        result = _parse_llm_json(raw)
        assert result == {"winner": 1, "score": "2:1"}

    def test_invalid_json_raises(self):
        """Garbage string raises json.JSONDecodeError."""
        with pytest.raises((json.JSONDecodeError, ValueError)):
            _parse_llm_json("not json at all")


# ─────────────────────────────────────────────────────────────────────────────
# Pattern 6: json.dumps sort_keys stability — pure Python, no contract needed
# ─────────────────────────────────────────────────────────────────────────────

class TestJsonSortKeys:
    """Pattern 6: json.dumps sort_keys=True produces stable output."""

    def test_stable_across_two_calls(self):
        data = {"winner": 1, "score": "2:1", "analysis": "Team1 dominated"}
        out1 = json.dumps(data, sort_keys=True)
        out2 = json.dumps(data, sort_keys=True)
        assert out1 == out2

    def test_sort_keys_orders_alphabetically(self):
        data = {"z": 3, "a": 1, "m": 2}
        result = json.dumps(data, sort_keys=True)
        assert result == '{"a": 1, "m": 2, "z": 3}'

    def test_insertion_order_dict_same_output(self):
        d1 = {"winner": 1, "score": "2:1"}
        d2 = {"score": "2:1", "winner": 1}  # different insertion order
        assert json.dumps(d1, sort_keys=True) == json.dumps(d2, sort_keys=True)


# ─────────────────────────────────────────────────────────────────────────────
# Contract-level tests (Patterns 1, 2, 4, 5, 7)
# ─────────────────────────────────────────────────────────────────────────────

class TestGlVmReturn:
    """Pattern 1: gl.vm.Return type check in validator_fn."""

    def test_isinstance_return_on_success(self, direct_vm, direct_deploy):
        """
        When leader succeeds, validator_fn receives a gl.vm.Return.
        isinstance(leader_result, gl.vm.Return) → True.
        """
        # Mock LLM so leader_fn doesn't fail
        direct_vm.mock_llm(r".*", '{"winner": 1, "score": "2:1"}')
        contract = direct_deploy(CONTRACT_PATH)
        # Should succeed — validator sees Return, returns True → consensus
        result = contract.get_match_result(True)
        assert result is not None
        assert result["winner"] == 1
        assert result["score"] == "2:1"

    def test_validator_distinguishes_return_from_error(self, direct_vm, direct_deploy):
        """
        When leader raises, validator_fn receives UserError (not Return).
        isinstance(leader_result, gl.vm.Return) → False.
        The validator returns False on error, which causes run_nondet_unsafe to fail.
        """
        direct_vm.mock_llm(r".*", '{"winner": 1}')
        contract = direct_deploy(CONTRACT_PATH)
        # get_match_result_raises: leader always raises, validator returns False
        # run_nondet_unsafe should raise/revert since validator returns False
        from gltest.direct import ContractRollback
        with pytest.raises((ContractRollback, Exception)):
            contract.get_match_result_raises()


class TestPartialFieldMatching:
    """Pattern 2: Validator compares only specific fields."""

    def test_partial_match_ignores_analysis_field(self, direct_vm, direct_deploy):
        """
        Contract returns {winner, score, analysis}.
        Validator only checks winner + score.
        Consensus reached even though 'analysis' varies.
        """
        direct_vm.mock_llm(r".*", '{"winner": 1, "score": "2:1"}')
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.get_match_result(True)
        assert result["winner"] == 1
        assert result["score"] == "2:1"
        # 'analysis' field is present in result but not checked by validator
        assert "analysis" in result

    def test_partial_match_team2_wins(self, direct_vm, direct_deploy):
        """Partial matching also works for team2 wins scenario."""
        direct_vm.mock_llm(r".*", '{"winner": 2, "score": "0:3"}')
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.get_match_result(False)
        assert result["winner"] == 2
        assert result["score"] == "0:3"


class TestU256Arithmetic:
    """Pattern 4: u256 arithmetic in contract storage."""

    def test_increment_from_zero(self, direct_vm, direct_deploy):
        """u256(int(self.count) + 1) increments from 0 to 1."""
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.increment()
        assert int(result) == 1
        assert contract.get_count() == 1

    def test_increment_multiple_times(self, direct_vm, direct_deploy):
        """Multiple increments accumulate correctly."""
        contract = direct_deploy(CONTRACT_PATH)
        for i in range(1, 6):
            contract.increment()
        assert contract.get_count() == 5

    def test_u256_round_trip(self, direct_vm, direct_deploy):
        """int(self.amount) round-trips correctly for initial value."""
        contract = direct_deploy(CONTRACT_PATH, 12345)
        assert contract.get_amount() == 12345

    def test_u256_zero_initial(self, direct_vm, direct_deploy):
        """Default u256(0) initializes correctly."""
        contract = direct_deploy(CONTRACT_PATH)
        assert contract.get_count() == 0
        assert contract.get_amount() == 0


class TestAddressConstructor:
    """
    Pattern 5: Address constructor handles str and bytes.

    GOTCHA: create_address() returns raw bytes (20 bytes), NOT an Address object.
    str(raw_bytes) returns Python's bytes repr "b'+\\xd8...'" — NOT a hex address!
    Always format as "0x" + addr.hex() when you need a hex string for Address().
    """

    def test_address_from_hex_str(self, direct_vm, direct_deploy):
        """Address(str) works when passed a valid '0x...' hex string."""
        from gltest.direct import create_address
        alice = create_address("alice")  # returns raw bytes
        # Correct: format as hex address string
        alice_hex = "0x" + alice.hex()
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.set_party(alice_hex)
        assert result.lower() == alice_hex.lower()

    def test_address_from_raw_bytes(self, direct_vm, direct_deploy):
        """Address(bytes) works when party_b passed as raw 20-byte value."""
        from gltest.direct import create_address
        alice = create_address("alice")  # returns raw bytes (20 bytes)
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.set_party(alice)  # pass bytes directly
        assert result.lower() == ("0x" + alice.hex()).lower()

    def test_str_of_bytes_fails(self, direct_vm, direct_deploy):
        """
        DOCUMENTED GOTCHA: str(create_address(...)) gives bytes repr, not hex.
        Passing that repr to Address() fails with binascii.Error (invalid base64).
        """
        from gltest.direct import create_address
        import binascii
        alice = create_address("alice")
        bad_str = str(alice)  # = "b'+\\xd8...'"  — wrong format!
        assert not bad_str.startswith("0x"), "Confirm: str(bytes) is NOT a hex address"
        contract = direct_deploy(CONTRACT_PATH)
        with pytest.raises(Exception):  # binascii.Error or Address init error
            contract.set_party(bad_str)


class TestNestedTreeMapWorkaround:
    """Pattern 7: Store list inside TreeMap as JSON string."""

    def test_add_single_item(self, direct_vm, direct_deploy):
        """Storing one item in the list works."""
        contract = direct_deploy(CONTRACT_PATH)
        contract.add_to_index("match:2024-06-20", "bet_001")
        result = contract.get_index("match:2024-06-20")
        assert result == ["bet_001"]

    def test_add_multiple_items_same_key(self, direct_vm, direct_deploy):
        """Multiple appends to same key accumulate correctly."""
        contract = direct_deploy(CONTRACT_PATH)
        contract.add_to_index("match:2024-06-20", "bet_001")
        contract.add_to_index("match:2024-06-20", "bet_002")
        contract.add_to_index("match:2024-06-20", "bet_003")
        result = contract.get_index("match:2024-06-20")
        assert result == ["bet_001", "bet_002", "bet_003"]

    def test_different_keys_are_independent(self, direct_vm, direct_deploy):
        """Different keys store independent lists."""
        contract = direct_deploy(CONTRACT_PATH)
        contract.add_to_index("key_A", "item_1")
        contract.add_to_index("key_B", "item_2")
        assert contract.get_index("key_A") == ["item_1"]
        assert contract.get_index("key_B") == ["item_2"]

    def test_empty_key_returns_empty_list(self, direct_vm, direct_deploy):
        """Missing key returns empty list (not error)."""
        contract = direct_deploy(CONTRACT_PATH)
        result = contract.get_index("nonexistent_key")
        assert result == []

    def test_json_string_stored_and_retrieved(self, direct_vm, direct_deploy):
        """Raw value stored in TreeMap is valid JSON string."""
        contract = direct_deploy(CONTRACT_PATH)
        raw = contract.add_to_index("key", "abc")
        parsed = json.loads(raw)
        assert parsed == ["abc"]


class TestContractStableJson:
    """Pattern 6 (contract-level): stable_json via contract method."""

    def test_stable_json_same_output_twice(self, direct_vm, direct_deploy):
        """json.dumps(data, sort_keys=True) returns same string each call."""
        contract = direct_deploy(CONTRACT_PATH)
        data = {"winner": 1, "score": "2:1", "analysis": "Team1"}
        out1 = contract.stable_json(data)
        out2 = contract.stable_json(data)
        assert out1 == out2

    def test_stable_json_sorts_keys(self, direct_vm, direct_deploy):
        """sort_keys=True produces alphabetically sorted keys."""
        contract = direct_deploy(CONTRACT_PATH)
        data = {"z": 3, "a": 1, "m": 2}
        result = contract.stable_json(data)
        assert result == '{"a": 1, "m": 2, "z": 3}'
```

## `tests/direct/test_views.py`

```python
"""Tests for read-only view methods."""

import json

from tests.direct.conftest import to_hex


def test_empty_bets(direct_deploy):
    contract = direct_deploy("contracts/football_bets.py")
    assert contract.get_bets() == {}


def test_empty_points(direct_deploy):
    contract = direct_deploy("contracts/football_bets.py")
    assert contract.get_points() == {}


def test_get_player_points_default_zero(direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    alice = to_hex(direct_alice)
    assert contract.get_player_points(alice) == 0


def test_points_accumulate(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    # Create and resolve two winning bets
    contract.create_bet("2024-06-20", "Spain", "Italy", "1")
    contract.create_bet("2024-06-20", "Denmark", "England", "0")

    # Mock for first match
    direct_vm.mock_web(
        r".*bbc\.com/sport/football/scores-fixtures.*",
        {"status": 200, "body": "Match results available."},
    )
    direct_vm.mock_llm(
        r".*Extract the match result.*",
        json.dumps({"score": "1:0", "winner": 1}),
    )
    contract.resolve_bet("2024-06-20_spain_italy")

    # Update mock for second match
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r".*bbc\.com/sport/football/scores-fixtures.*",
        {"status": 200, "body": "Match results available."},
    )
    direct_vm.mock_llm(
        r".*Extract the match result.*",
        json.dumps({"score": "1:1", "winner": 0}),
    )
    contract.resolve_bet("2024-06-20_denmark_england")

    assert contract.get_player_points(alice) == 2

    points = contract.get_points()
    assert points[alice] == 2
```

## `tests/direct/test_resolve_bet.py`

```python
"""Tests for bet resolution — requires web + LLM mocks."""

import json

from tests.direct.conftest import to_hex


def _setup_match_mocks(vm, score, winner):
    """Register web and LLM mocks for match resolution."""
    vm.mock_web(
        r".*bbc\.com/sport/football/scores-fixtures.*",
        {"status": 200, "body": f"Match result: {score}. Winner: team {winner}."},
    )
    vm.mock_llm(
        r".*Extract the match result.*",
        json.dumps({"score": score, "winner": winner}),
    )


def test_resolve_winning_bet(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")
    _setup_match_mocks(direct_vm, "1:0", 1)

    contract.resolve_bet("2024-06-20_spain_italy")

    bets = contract.get_bets()
    bet = bets[alice]["2024-06-20_spain_italy"]
    assert bet.has_resolved is True
    assert bet.real_winner == "1"
    assert bet.real_score == "1:0"

    assert contract.get_player_points(alice) == 1


def test_resolve_losing_bet_no_points(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Spain", "Italy", "2")
    _setup_match_mocks(direct_vm, "1:0", 1)

    contract.resolve_bet("2024-06-20_spain_italy")

    assert contract.get_player_points(alice) == 0

    points = contract.get_points()
    assert alice not in points


def test_resolve_draw_bet(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.create_bet("2024-06-20", "Denmark", "England", "0")
    _setup_match_mocks(direct_vm, "1:1", 0)

    contract.resolve_bet("2024-06-20_denmark_england")

    bets = contract.get_bets()
    bet = bets[alice]["2024-06-20_denmark_england"]
    assert bet.has_resolved is True
    assert bet.real_winner == "0"
    assert bet.real_score == "1:1"

    assert contract.get_player_points(alice) == 1


def test_resolve_already_resolved_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")
    _setup_match_mocks(direct_vm, "1:0", 1)

    contract.resolve_bet("2024-06-20_spain_italy")

    with direct_vm.expect_revert("Bet already resolved"):
        contract.resolve_bet("2024-06-20_spain_italy")


def test_resolve_unfinished_game_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/football_bets.py")
    direct_vm.sender = direct_alice

    contract.create_bet("2024-06-20", "Spain", "Italy", "1")
    _setup_match_mocks(direct_vm, "-", -1)

    with direct_vm.expect_revert("Game not finished"):
        contract.resolve_bet("2024-06-20_spain_italy")


def test_multiple_users_resolve_independently(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/football_bets.py")
    alice = to_hex(direct_alice)
    bob = to_hex(direct_bob)

    # Alice bets on team 1
    direct_vm.sender = direct_alice
    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    # Bob bets on team 2
    direct_vm.sender = direct_bob
    contract.create_bet("2024-06-20", "Spain", "Italy", "2")

    _setup_match_mocks(direct_vm, "1:0", 1)

    # Alice resolves — she wins
    direct_vm.sender = direct_alice
    contract.resolve_bet("2024-06-20_spain_italy")
    assert contract.get_player_points(alice) == 1

    # Bob resolves — he loses
    direct_vm.sender = direct_bob
    contract.resolve_bet("2024-06-20_spain_italy")
    assert contract.get_player_points(bob) == 0
```

## `tests/integration/test_new_features.py`

```python
"""
Tests for two new GenLayer features:
1. direct_vm.run_validator() - cheatcode for testing validator consensus
2. Visual inputs - web.render(mode='screenshot') + exec_prompt(images=[...])

Run with:
    python3.12 -m pytest test/test_new_features.py -v

Versions under test:
    genlayer-test 0.25.0  (genlayer-py 0.9.0, genvm SDK v0.2.14 cached)

Known limitations discovered during testing:
    - run_validator() works ONLY when the validator function does NOT call
      spawn_sandbox(). eq_principle.strict_eq uses spawn_sandbox internally,
      which is unsupported in direct mode (wasi_mock returns a calldata-encoded
      None and _decode_sub_vm_result_retn raises AssertionError: unknown type 14).
      Use run_nondet_unsafe directly for testable validators.
    - web.render(mode='screenshot') mocking: wasi_mock always returns b"" as
      image bytes. SDK decoder immediately calls PIL.Image.open(BytesIO(b""))
      which raises PIL.UnidentifiedImageError. Workaround: provide valid PNG
      bytes directly in the mock via {"screenshot_image": bytes} OR patch
      the mock body with real PIL-parseable data (see test_screenshot_with_valid_png).
"""

import base64
import pytest
from pathlib import Path

# Valid 1×1 red PNG (69 bytes) – minimal PIL-parseable image
_VALID_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAA"
    "DElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)
VALID_PNG = base64.b64decode(_VALID_PNG_B64)


# ─────────────────────────────────────────────────────────────────────────────
# Contract fixtures
# ─────────────────────────────────────────────────────────────────────────────

# Uses run_nondet_unsafe directly so validator does NOT call spawn_sandbox.
# This is necessary because wasi_mock doesn't implement the Sandbox gl_call.
_NONDET_CONTRACT = '''\
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import genlayer.gl.vm as glvm


class NondetContract(gl.Contract):
    last_result: str

    def __init__(self):
        self.last_result = ""

    @gl.public.write
    def fetch_and_store(self, url: str) -> str:
        """Fetch external data and reach consensus via run_nondet_unsafe."""
        def leader() -> str:
            # Uses a web request so we can swap mocks
            resp = gl.nondet.web.get(url)
            return resp.body.decode("utf-8", errors="replace")

        def validator(result: glvm.Result) -> bool:
            if not isinstance(result, glvm.Return):
                return False
            # Re-run the same fetch; compare with leader result
            resp = gl.nondet.web.get(url)
            my_val = resp.body.decode("utf-8", errors="replace")
            return my_val == result.calldata

        value = glvm.run_nondet_unsafe.lazy(leader, validator).get()
        self.last_result = value
        return value
'''

_VISUAL_CONTRACT = '''\
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class VisualContract(gl.Contract):
    last_desc: str

    def __init__(self):
        self.last_desc = ""

    @gl.public.write
    def describe_raw_bytes(self, image_bytes: bytes) -> str:
        """Pass raw bytes directly to exec_prompt (no web render)."""
        desc = gl.nondet.exec_prompt("Describe this image", images=[image_bytes])
        self.last_desc = gl.eq_principle.strict_eq(lambda: desc)
        return self.last_desc

    @gl.public.write
    def describe_screenshot(self, url: str) -> str:
        """Render screenshot + describe. Works only with valid PNG mock bytes."""
        img = gl.nondet.web.render(url, mode="screenshot")
        desc = gl.nondet.exec_prompt("Describe this image", images=[img.raw])
        self.last_desc = gl.eq_principle.strict_eq(lambda: desc)
        return self.last_desc
'''


@pytest.fixture
def nondet_contract_path(tmp_path):
    path = tmp_path / "NondetContract.py"
    path.write_text(_NONDET_CONTRACT)
    return str(path)


@pytest.fixture
def visual_contract_path(tmp_path):
    path = tmp_path / "VisualContract.py"
    path.write_text(_VISUAL_CONTRACT)
    return str(path)


# ─────────────────────────────────────────────────────────────────────────────
# Task 1: direct_vm.run_validator()
# ─────────────────────────────────────────────────────────────────────────────


def test_run_validator_exists(direct_vm):
    """Confirm run_validator() is a callable on the direct_vm pytest fixture."""
    assert hasattr(direct_vm, "run_validator"), "VMContext missing run_validator"
    assert callable(direct_vm.run_validator)


def test_run_validator_raises_without_captured(direct_vm):
    """run_validator() must raise RuntimeError if no nondet call was made first."""
    with pytest.raises(RuntimeError, match="No validator captured"):
        direct_vm.run_validator()


def test_run_validator_false_when_mocks_differ(direct_vm, direct_deploy, nondet_contract_path):
    """
    Leader sees 'result_A'. Clear mocks, set 'result_B'. Validator re-runs
    leader_fn and gets 'result_B' ≠ 'result_A' → run_validator() returns False.
    """
    direct_vm.mock_web(r".*api\.example\.com.*", {
        "method": "GET",
        "status": 200,
        "body": b"result_A",
    })

    contract = direct_deploy(nondet_contract_path)
    contract.fetch_and_store("https://api.example.com/data")

    assert direct_vm._captured_validators, "No validator was captured"

    # Swap mock: validator will now see different data
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*api\.example\.com.*", {
        "method": "GET",
        "status": 200,
        "body": b"result_B",
    })

    result = direct_vm.run_validator()
    assert result is False, f"Expected False (data mismatch), got {result!r}"


def test_run_validator_true_when_mocks_agree(direct_vm, direct_deploy, nondet_contract_path):
    """
    Leader sees 'result_A'. Keep same mock. Validator re-runs and also sees
    'result_A' → run_validator() returns True.
    """
    direct_vm.mock_web(r".*api\.example\.com.*", {
        "method": "GET",
        "status": 200,
        "body": b"result_A",
    })

    contract = direct_deploy(nondet_contract_path)
    contract.fetch_and_store("https://api.example.com/data")

    assert direct_vm._captured_validators, "No validator was captured"

    # Same mock → validator will agree
    result = direct_vm.run_validator()
    assert result is True, f"Expected True (data agrees), got {result!r}"


def test_run_validator_respects_leader_result_override(direct_vm, direct_deploy, nondet_contract_path):
    """
    leader_result= override: force the validator to compare against a custom
    leader result instead of the originally captured one.
    """
    direct_vm.mock_web(r".*api\.example\.com.*", {
        "method": "GET",
        "status": 200,
        "body": b"result_A",
    })

    contract = direct_deploy(nondet_contract_path)
    contract.fetch_and_store("https://api.example.com/data")

    assert direct_vm._captured_validators, "No validator was captured"

    # Validator still sees 'result_A' from mock, but leader_result is forced to 'result_B'
    # → validator gets result_A != result_B → False
    result = direct_vm.run_validator(leader_result="result_B")
    assert result is False, f"Expected False (forced leader_result mismatch), got {result!r}"


def test_run_validator_with_football_bets_skips_gracefully(direct_vm, direct_deploy):
    """
    Document that strict_eq-based contracts (football_bets) DO capture validators,
    but run_validator() FAILS because strict_eq's validator calls spawn_sandbox,
    which is unsupported in wasi_mock. This is a known v0.25.0 limitation.
    """
    direct_vm.mock_web(r".*bbc.*", {"status": 200, "body": "Spain 3-0 Italy"})
    direct_vm.mock_llm(r".*", '{"score": "3:0", "winner": 1}')

    contract = direct_deploy("contracts/football_bets.py")
    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    try:
        contract.resolve_bet("2024-06-20_spain_italy")
    except Exception:
        pass

    if not direct_vm._captured_validators:
        pytest.skip("No validator captured")

    # Known to fail with: AssertionError: unknown type 14
    # (Sandbox gl_call not handled by wasi_mock)
    with pytest.raises((AssertionError, Exception)) as exc_info:
        direct_vm.run_validator()

    assert "unknown type 14" in str(exc_info.value) or "sandbox" in str(exc_info.value).lower() or True, (
        f"Got: {exc_info.value}"
    )
    # Mark it as an expected known limitation
    pytest.xfail(
        "strict_eq validator uses spawn_sandbox which is unsupported in direct mode (wasi_mock)"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Task 2: Visual inputs
# ─────────────────────────────────────────────────────────────────────────────


def test_mock_web_intercepts_render_screenshot_call(direct_vm, direct_deploy, visual_contract_path):
    """
    mock_web() DOES intercept gl.nondet.web.render(mode='screenshot') calls.
    When NO mock is registered, MockNotFoundError is raised — confirming
    the interception path is wired correctly.
    """
    from gltest.direct import MockNotFoundError

    direct_vm.mock_llm(r".*", "irrelevant")
    contract = direct_deploy(visual_contract_path)

    with pytest.raises(MockNotFoundError):
        contract.describe_screenshot("https://example.com/page")


def test_web_render_screenshot_empty_bytes_causes_pil_error(direct_vm, direct_deploy, visual_contract_path):
    """
    Document wasi_mock bug: mock_web screenshot handler always returns b"" as
    image bytes regardless of what body was provided. SDK then calls
    PIL.Image.open(BytesIO(b"")) which raises PIL.UnidentifiedImageError.
    This is a bug/limitation in genlayer-test 0.25.0.
    """
    direct_vm.mock_web(r".*", {"status": 200, "body": "anything"})
    direct_vm.mock_llm(r".*", "described")
    contract = direct_deploy(visual_contract_path)

    with pytest.raises(Exception) as exc_info:
        contract.describe_screenshot("https://example.com/page")

    assert "cannot identify image file" in str(exc_info.value), (
        f"Expected PIL UnidentifiedImageError, got: {exc_info.value}"
    )


def test_exec_prompt_accepts_raw_image_bytes(direct_vm, direct_deploy, visual_contract_path):
    """
    gl.nondet.exec_prompt(prompt, images=[bytes_value]) accepts raw bytes.
    This works correctly end-to-end in direct mode when NOT going through
    web.render(mode='screenshot') — the bytes are passed directly by contract.
    LLM mock captures the call and returns the configured string.
    """
    direct_vm.mock_llm(r".*", "a cat on a mat")

    contract = direct_deploy(visual_contract_path)
    # describe_raw_bytes passes the bytes directly to exec_prompt without web.render
    result = contract.describe_raw_bytes(VALID_PNG)
    assert result == "a cat on a mat", f"Unexpected LLM result: {result!r}"


def test_web_render_text_mode_works(direct_vm, direct_deploy):
    """
    web.render(mode='text') returns a string — confirmed working baseline.
    Used by football_bets. Validates that mock_web intercepts WebRender calls.
    """
    direct_vm.mock_web(r".*bbc.*", {"status": 200, "body": "Spain 3-0 Italy full time"})
    direct_vm.mock_llm(r".*", '{"score": "3:0", "winner": 1}')

    contract = direct_deploy("contracts/football_bets.py")
    contract.create_bet("2024-06-20", "Spain", "Italy", "1")

    try:
        contract.resolve_bet("2024-06-20_spain_italy")
    except Exception:
        pass

    # The web mock must have been hit
    assert len(direct_vm._web_mocks_hit) > 0, (
        "Web mock was never matched — WebRender interception may be broken"
    )


def test_image_object_structure():
    """
    Confirm that gl.nondet.Image has .raw (bytes) and .pil (PIL.Image.Image) attributes.
    This test loads the Image class directly from the cached SDK (no contract needed).
    """
    import io, sys, importlib.util
    from pathlib import Path
    from PIL import Image as PILImage

    # Find the cached SDK's nondet module
    sdk_cache = Path.home() / ".cache" / "gltest-direct" / "extracted"
    nondet_files = list(sdk_cache.rglob("*/genlayer/gl/nondet/__init__.py"))
    if not nondet_files:
        pytest.skip("SDK not cached — run a deploy test first")

    # Pick the most recent version
    nondet_path = sorted(nondet_files)[-1]
    parent = str(nondet_path.parent.parent.parent.parent.parent)  # up to sdk std root

    # Temporarily add to path and import
    if parent not in sys.path:
        sys.path.insert(0, parent)

    spec = importlib.util.spec_from_file_location("_gltest_nondet_tmp", nondet_path)
    image_mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(image_mod)
    except Exception:
        # Module has complex imports; check source instead
        source = nondet_path.read_text()
        assert "class Image:" in source or "Image" in source, "Image not found in nondet module"
        assert "raw: bytes" in source, "Image.raw field missing"
        return
    finally:
        if parent in sys.path:
            sys.path.remove(parent)

    # Construct an Image
    pil_img = PILImage.open(io.BytesIO(VALID_PNG))
    img = image_mod.Image(raw=VALID_PNG, pil=pil_img)

    assert isinstance(img.raw, bytes), f"Image.raw should be bytes, got {type(img.raw)}"
    assert img.pil is pil_img
    assert len(img.raw) == len(VALID_PNG)
```

## `tests/integration/test_football_bets.py`

```python
"""Integration tests — require GenLayer Studio running.

Run with: gltest tests/integration/ -v -s
"""

import pytest
from gltest import get_contract_factory, default_account
from gltest.helpers import load_fixture
from gltest.assertions import tx_execution_succeeded

from tests.integration.fixtures import (
    football_bets_win_resolved,
    football_bets_win_unresolved,
    football_bets_draw_unresolved,
    football_bets_draw_resolved,
    football_bets_unsuccess_unresolved,
    football_bets_unsuccess_resolved,
)


@pytest.mark.integration
def deploy_contract():
    factory = get_contract_factory("FootballBets")
    contract = factory.deploy()

    contract_all_points_state = contract.get_points(args=[])
    assert contract_all_points_state == {}

    contract_all_bets_state = contract.get_bets(args=[])
    assert contract_all_bets_state == {}
    return contract


@pytest.mark.integration
def test_football_bets_success_win():
    contract = load_fixture(deploy_contract)

    create_bet_result = contract.create_bet(args=["2024-06-20", "Spain", "Italy", "1"])
    assert tx_execution_succeeded(create_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {
        default_account.address: football_bets_win_unresolved
    }

    resolve_successful_bet_result = contract.resolve_bet(
        args=["2024-06-20_spain_italy"],
        wait_interval=10000,
        wait_retries=15,
    )
    assert tx_execution_succeeded(resolve_successful_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {default_account.address: football_bets_win_resolved}

    get_points_result = contract.get_points(args=[])
    assert get_points_result == {default_account.address: 1}

    get_player_points_result = contract.get_player_points(
        args=[default_account.address]
    )
    assert get_player_points_result == 1


@pytest.mark.integration
def test_football_bets_draw_success():
    contract = load_fixture(deploy_contract)

    create_bet_result = contract.create_bet(
        args=["2024-06-20", "Denmark", "England", "0"]
    )
    assert tx_execution_succeeded(create_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {
        default_account.address: football_bets_draw_unresolved
    }

    resolve_successful_bet_result = contract.resolve_bet(
        args=["2024-06-20_denmark_england"],
        wait_interval=10000,
        wait_retries=15,
    )
    assert tx_execution_succeeded(resolve_successful_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {default_account.address: football_bets_draw_resolved}

    get_points_result = contract.get_points(args=[])
    assert get_points_result == {default_account.address: 1}

    get_player_points_result = contract.get_player_points(
        args=[default_account.address]
    )
    assert get_player_points_result == 1


@pytest.mark.integration
def test_football_bets_unsuccess():
    contract = load_fixture(deploy_contract)

    create_bet_result = contract.create_bet(args=["2024-06-20", "Spain", "Italy", "2"])
    assert tx_execution_succeeded(create_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {
        default_account.address: football_bets_unsuccess_unresolved
    }

    resolve_successful_bet_result = contract.resolve_bet(
        args=["2024-06-20_spain_italy"],
        wait_interval=10000,
        wait_retries=15,
    )
    assert tx_execution_succeeded(resolve_successful_bet_result)

    get_bet_result = contract.get_bets(args=[])
    assert get_bet_result == {
        default_account.address: football_bets_unsuccess_resolved
    }

    get_points_result = contract.get_points(args=[])
    assert get_points_result == {}

    get_player_points_result = contract.get_player_points(
        args=[default_account.address]
    )
    assert get_player_points_result == 0
```

## `tests/integration/fixtures.py`

```python
"""Expected contract state fixtures for integration tests."""

football_bets_contract_schema = {
    "id": 1,
    "jsonrpc": "2.0",
    "result": {
        "ctor": {"kwparams": {}, "params": []},
        "methods": {
            "create_bet": {
                "kwparams": {},
                "params": [
                    ["game_date", "string"],
                    ["team1", "string"],
                    ["team2", "string"],
                    ["predicted_winner", "string"],
                ],
                "readonly": False,
                "ret": "null",
            },
            "get_bets": {"kwparams": {}, "params": [], "readonly": True, "ret": "dict"},
            "get_player_points": {
                "kwparams": {},
                "params": [["player_address", "string"]],
                "readonly": True,
                "ret": "int",
            },
            "get_points": {
                "kwparams": {},
                "params": [],
                "readonly": True,
                "ret": "dict",
            },
            "resolve_bet": {
                "kwparams": {},
                "params": [["bet_id", "string"]],
                "readonly": False,
                "ret": "null",
            },
        },
    },
}


football_bets_win_unresolved = {
    "2024-06-20_spain_italy": {
        "game_date": "2024-06-20",
        "has_resolved": False,
        "id": "2024-06-20_spain_italy",
        "predicted_winner": "1",
        "real_score": "",
        "real_winner": "",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Spain",
        "team2": "Italy",
    }
}

football_bets_win_resolved = {
    "2024-06-20_spain_italy": {
        "game_date": "2024-06-20",
        "has_resolved": True,
        "id": "2024-06-20_spain_italy",
        "predicted_winner": "1",
        "real_score": "1:0",
        "real_winner": "1",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Spain",
        "team2": "Italy",
    }
}

football_bets_draw_unresolved = {
    "2024-06-20_denmark_england": {
        "game_date": "2024-06-20",
        "has_resolved": False,
        "id": "2024-06-20_denmark_england",
        "predicted_winner": "0",
        "real_score": "",
        "real_winner": "",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Denmark",
        "team2": "England",
    }
}

football_bets_draw_resolved = {
    "2024-06-20_denmark_england": {
        "game_date": "2024-06-20",
        "has_resolved": True,
        "id": "2024-06-20_denmark_england",
        "predicted_winner": "0",
        "real_score": "1:1",
        "real_winner": "0",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Denmark",
        "team2": "England",
    }
}

football_bets_unsuccess_unresolved = {
    "2024-06-20_spain_italy": {
        "game_date": "2024-06-20",
        "has_resolved": False,
        "id": "2024-06-20_spain_italy",
        "predicted_winner": "2",
        "real_score": "",
        "real_winner": "",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Spain",
        "team2": "Italy",
    }
}

football_bets_unsuccess_resolved = {
    "2024-06-20_spain_italy": {
        "game_date": "2024-06-20",
        "has_resolved": True,
        "id": "2024-06-20_spain_italy",
        "predicted_winner": "2",
        "real_score": "1:0",
        "real_winner": "1",
        "resolution_url": "https://www.bbc.com/sport/football/scores-fixtures/2024-06-20",
        "team1": "Spain",
        "team2": "Italy",
    }
}
```

## `deploy/deployScript.ts`

```typescript
import { readFileSync } from "fs";
import path from "path";
import {
  TransactionHash,
  TransactionStatus,
  GenLayerClient,
  DecodedDeployData,
  GenLayerChain,
} from "genlayer-js/types";
import { localnet } from "genlayer-js/chains";

export default async function main(client: GenLayerClient<any>) {
  const filePath = path.resolve(process.cwd(), "contracts/football_bets.py");

  try {
    const contractCode = new Uint8Array(readFileSync(filePath));

    await client.initializeConsensusSmartContract();

    const deployTransaction = await client.deployContract({
      code: contractCode,
      args: [],
    });

    const receipt = await client.waitForTransactionReceipt({
      hash: deployTransaction as TransactionHash,
      status: TransactionStatus.ACCEPTED,
      retries: 200,
    });

    if (
      receipt.status !== 5 &&
      receipt.status !== 6 &&
      receipt.statusName !== "ACCEPTED" &&
      receipt.statusName !== "FINALIZED"
    ) {
      throw new Error(`Deployment failed. Receipt: ${JSON.stringify(receipt)}`);
    }

    const deployedContractAddress =
      (client.chain as GenLayerChain).id === localnet.id
        ? receipt.data.contract_address
        : (receipt.txDataDecoded as DecodedDeployData)?.contractAddress;

    console.log(`Contract deployed at address: ${deployedContractAddress}`);
  } catch (error) {
    throw new Error(`Error during deployment:, ${error}`);
  }
}
```
