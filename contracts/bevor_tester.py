# { "Depends": "py-genlayer:11rhn002yfajawsz7fai6mykznbxkxs6l91iskj5cm82c92qhy3v" }
from dataclasses import dataclass

from genlayer import *

MIN_REWARD = 1_000
JUDGE_FEE_BPS = 200
BPS = 10_000
MAX_SUBMISSIONS = 20
ZERO = "0x" + "00" * 20


def _require(ok: bool, message: str) -> None:
    if not ok:
        raise gl.vm.UserError(message)


def _fee(amount: int) -> int:
    return amount * JUDGE_FEE_BPS // BPS


@gl.contract_interface
class RewardToken:
    class View:
        def balance_of(self, owner: Address) -> u256: ...

    class Write:
        def mint(self, to: Address, amount: u256) -> None: ...


class BountyPaid(gl.Event):
    def __init__(self, bounty_id: str, /, **blob): ...


@allow_storage
@dataclass
class Bounty:
    sponsor: Address
    title: str
    criteria: str
    reward: u256
    state: str
    winner: Address


@allow_storage
@dataclass
class Submission:
    bounty_id: str
    hunter: Address
    url: str
    verdict: str


class BountyBoard(gl.Contract):
    owner: Address
    token: Address
    next_id: u256
    treasury: u256
    bounties: TreeMap[str, Bounty]
    submissions: DynArray[Submission]
    reputation: TreeMap[Address, u256]

    def __init__(self, token: str):
        self.owner = gl.message.sender_address
        self.token = Address(token)
        self.next_id = u256(0)
        self.treasury = u256(0)

    def __receive__(self) -> None:
        # plain value transfers are tips
        self.treasury = u256(int(self.treasury) + int(gl.message.value))

    # ------------------------------------------------------------------ storage helpers

    def _bounty(self, bounty_id: str) -> Bounty:
        _require(bounty_id in self.bounties, "Unknown bounty")
        return self.bounties[bounty_id]

    def _open(self, bounty_id: str) -> Bounty:
        bounty = self._bounty(bounty_id)
        _require(bounty.state == "open", "Bounty is not open")
        return bounty

    def _settle(self, bounty: Bounty, winner: Address) -> int:
        fee = _fee(int(bounty.reward))
        bounty.state = "paid"
        bounty.winner = winner
        self.treasury = u256(int(self.treasury) + fee)
        self.reputation[winner] = u256(int(self.reputation.get(winner, u256(0))) + 1)
        return int(bounty.reward) - fee

    def _pay(self, to: Address, amount: int) -> None:
        if amount > 0:
            gl.get_contract_at(to).emit_transfer(value=u256(amount))

    # ------------------------------------------------------------------ judging

    def _judge(self, criteria: str, url: str) -> bool:
        def evaluate() -> str:
            page = gl.nondet.web.render(url, mode="text")
            answer = gl.nondet.exec_prompt(
                "Does this submission satisfy the bounty criteria? Answer yes or no.\n"
                f"Criteria: {criteria}\n"
                f"Submission: {page}"
            )
            return "yes" if "yes" in answer.lower() else "no"

        return gl.eq_principle.strict_eq(evaluate) == "yes"

    # ------------------------------------------------------------------ entrypoints

    @gl.public.write.payable
    def post(self, title: str, criteria: str) -> str:
        reward = int(gl.message.value)
        _require(reward >= MIN_REWARD, "Reward too small")
        _require(0 < len(title) <= 200, "Title must be 1-200 characters")
        bounty_id = str(self.next_id)
        self.next_id = u256(int(self.next_id) + 1)
        self.bounties[bounty_id] = Bounty(
            gl.message.sender_address,
            title,
            criteria,
            u256(reward),
            "open",
            Address(ZERO),
        )
        return bounty_id

    @gl.public.write
    def submit(self, bounty_id: str, url: str) -> int:
        self._open(bounty_id)
        count = 0
        for submission in self.submissions:
            if submission.bounty_id == bounty_id:
                _require(submission.hunter != gl.message.sender_address, "Already submitted")
                count += 1
        _require(count < MAX_SUBMISSIONS, "Too many submissions")
        self.submissions.append(Submission(bounty_id, gl.message.sender_address, url, "pending"))
        return len(self.submissions) - 1

    @gl.public.write
    def judge(self, index: int) -> bool:
        submission = self.submissions[index]
        _require(submission.verdict == "pending", "Already judged")
        bounty = self._open(submission.bounty_id)
        accepted = self._judge(bounty.criteria, submission.url)
        submission.verdict = "accepted" if accepted else "rejected"
        if accepted:
            payout = self._settle(bounty, submission.hunter)
            self._pay(submission.hunter, payout)
            RewardToken(self.token).emit().mint(submission.hunter, u256(10))
            BountyPaid(submission.bounty_id, winner=submission.hunter.as_hex).emit()
        return accepted

    @gl.public.write
    def cancel(self, bounty_id: str) -> None:
        bounty = self._open(bounty_id)
        _require(bounty.sponsor == gl.message.sender_address, "Only the sponsor can cancel")
        for submission in self.submissions:
            if submission.bounty_id == bounty_id and submission.verdict == "pending":
                submission.verdict = "cancelled"
        bounty.state = "cancelled"
        self._pay(bounty.sponsor, int(bounty.reward))

    @gl.public.write
    def withdraw_fees(self, to: str) -> None:
        amount = int(self.treasury)
        self.treasury = u256(0)
        self._pay(Address(to), amount)

    @gl.public.view
    def get_bounty(self, bounty_id: str) -> dict:
        bounty = self._bounty(bounty_id)
        return {
            "title": bounty.title,
            "state": bounty.state,
            "reward": int(bounty.reward),
            "winner": bounty.winner.as_hex,
        }

    @gl.public.view
    def reputation_of(self, hunter: str) -> int:
        return int(self.reputation.get(Address(hunter), u256(0)))
