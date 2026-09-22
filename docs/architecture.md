# Bevor contract design

Bevor Protocol holds audit payments in escrow, a contract balance reserved for the parties.
Bevor Governor decides whether exploit evidence establishes auditor liability under the agreed terms.
The protocol calculates every payment with integer arithmetic.
The inference result never supplies a recipient or payment amount.

## Agreement

The client creates one agreement per auditor and sends its full payment as GEN.
The agreement fixes the auditor, duration, cliff, and audit terms.
A cliff is the minimum waiting period before any payment becomes withdrawable.
The auditor accepts the agreement after reviewing its terms and report.
Acceptance starts vesting.

The terms contain eight nonempty strings: `project`, `chain`, `deployment`, `audited_commit`, `scope`, `exclusions`, `report`, and `liability`.
These fields identify the audited deployment and revision, define covered work, preserve findings, and state the agreed responsibility standard.
Store the actual report text in `report`, not a mutable link alone.
Use `none` for an agreed empty exclusion list.
The parties cannot edit accepted terms through either contract.

The client can cancel before acceptance and receive a full refund.
After acceptance, the client cannot cancel unilaterally.
The protocol has no administrator withdrawal or governor replacement method.
Before acceptance, the auditor must make sure that the governor address identifies the expected contract code.

## Vesting

Before the cliff, vested payment is zero.
After the cliff, vesting includes time since acceptance.
The vested amount equals `amount * min(elapsed_seconds, duration_seconds) // duration_seconds`.
Multiplication precedes division to avoid losing small payments through early rounding.
Only the auditor can withdraw vested payment.

Each agreement tracks paid withdrawals and refunds separately.
For every agreement, withdrawals plus refunds cannot exceed its original payment.
Payments use wei: one GEN equals `10^18` wei.
The current contracts do not support ERC-20 deposits or USDC.

## Claims

Only the client can open a claim, and only before the vesting period ends.
Opening a claim freezes withdrawals immediately and records the vesting cutoff.
The client submits an allegation and one to five distinct HTTPS evidence URLs.
The auditor gets 24 hours to submit one response with up to five supporting URLs.
Inference starts after that response window closes.

Each agreement permits one claim to limit repeated withdrawal freezes.
That limit also applies after rejection or timeout.
The claim expires seven days after filing if settlement does not arrive.
Anyone can call `expire_claim` after the deadline to restore the original schedule.
Time does not submit transactions automatically.
A caller must submit expiry, inference, and withdrawal transactions.

## Governor decisions

Anyone can call `adjudicate` for an open claim after the response window.
The governor reads finalized protocol state before inference.
It fetches the client and auditor sources, then compares them against the fixed agreement.
Each source must return HTTP 200 and contain at most 64,000 bytes of UTF-8 text.
Use stable text or JSON evidence pages. PDF and image evidence are not supported.

The model returns three findings with `yes`, `no`, or `unknown` values.

- `hack_occurred` establishes an actual exploit against the agreed deployment during the covered period.
- `within_scope` links the exploited root cause to the audited revision and scope.
- `auditor_liable` applies the agreed liability standard, exclusions, and disclosed findings.

The contract derives `liable` only when all three findings are `yes`.
Any `no` produces `not_liable`.
Other combinations produce `inconclusive`.
A conclusive result requires cited quotations that match fetched evidence.
The model selects numbered source lines instead of writing quotations from memory.
The contract extracts each selected line and stores its exact text with the source URL.
Invalid line references, short quotations, and invented free-text quotations cannot settle a claim.

Validators fetch the evidence and repeat the analysis independently.
They must agree on all three findings, the derived verdict, and the source hashes.
A source hash is a fingerprint of its fetched bytes.
Changing pages or disagreeing findings prevent agreement.
Reasoning text can differ between validators.

The prompt treats source text and party submissions as untrusted evidence.
It requires provenance, causal reasoning, and corroboration rather than accepting a client allegation as proof.
Quoted instructions cannot change the settlement recipient, amount, or authorization rules.
Prompt instructions and matching citations do not guarantee factual truth.
The design still depends on evidence quality and the network inference process.

Malformed model output or a complete lack of readable evidence leaves the claim pending.
The governor marks individual failed sources and evaluates the remaining evidence.
A broken defense URL cannot automatically block an otherwise supported claim.
Missing material facts still require an unknown finding.
An inconclusive decision also leaves it pending and permits another inference attempt before expiry.
The governor stores findings, reasoning, citations, source hashes, and the decision time for inspection.

## Settlement

After a conclusive decision finalizes, the governor sends `apply_decision` to the protocol.
The protocol authenticates the immediate sender against its permanent governor address.
It also requires the matching claim identifier and an unexpired dispute.
The settlement method is idempotent, which means that duplicate delivery cannot pay twice.

For `liable`, vesting stops at the claim filing time.
The protocol returns the unvested amount to the client automatically through a GEN transfer message.
The auditor can still withdraw vested payment that remains unpaid.
Previously paid amounts are not clawed back.
For `not_liable`, the original vesting schedule resumes and includes elapsed dispute time.
Expiry uses the same schedule restoration rule.

For example, a 1,000-unit payment over ten days vests 200 units after two days without a cliff.
A claim filed then fixes the liability cutoff at 200 units.
If the governor later confirms liability, the client receives 800 units.
The auditor keeps entitlement to 200 units, less any previous withdrawals.

Cross-contract writes and wallet transfers use separate messages.
A stored governor verdict does not prove that the protocol received its settlement message.
Call `adjudicate` again before expiry to resend an existing conclusive decision without another inference call.
Read the protocol state to make sure that settlement applied.
If delivery arrives after expiry, the protocol rejects it.

Wallet transfers use the EVM transfer interface and execute at finalization.
Recipients must be wallets that can receive GEN on the target chain.
A failed external delivery cannot safely be retried from contract accounting alone.
The current version has no receipt-based payment recovery path.
Do not treat a local ledger test as proof of real wallet delivery.

## Contract interface

`BevorProtocol(governor)` stores the permanent governor address.

- `create_audit(auditor, duration_seconds, cliff_seconds, terms_json)` receives the full GEN payment and returns an audit ID.
- `accept_audit(audit_id)` starts vesting when the auditor accepts.
- `cancel_audit(audit_id)` refunds an agreement that the auditor did not accept.
- `withdraw(audit_id)` pays the auditor its available vested amount.
- `open_claim(audit_id, allegation, evidence_urls)` freezes withdrawals and returns a claim ID.
- `submit_response(audit_id, response, evidence_urls)` records the auditor defense during its response window.
- `apply_decision(audit_id, claim_id, verdict)` accepts settlement only from the governor.
- `expire_claim(audit_id)` restores vesting after an unresolved claim expires.
- `get_audit(audit_id)` returns terms, payment accounting, state, deadlines, and claim records.

`BevorGovernor()` has no constructor arguments or administrator role.

`adjudicate(protocol, audit_id)` evaluates an eligible claim or resends its existing conclusive decision.
`get_decision(protocol, audit_id, claim_id)` returns the stored decision.

## Changes from Solidity v1

The original design used ERC-20 payments, auditor schedules, an audit NFT, token voting, and a timelock.
This version uses one auditor per agreement and replaces voting with an inference decision.
It omits the NFT and governance token.
Create separate agreements for multiple auditors.

The reference implementation redirected remaining withdrawals after invalidation.
This version immediately schedules the unvested refund and preserves the auditor entitlement at the filing cutoff.
It also removes mutable governance authority and makes all agreement terms explicit.

USDC needs a separate payment design that authenticates actual token deposits on a specified chain.
An ERC-20 approval or emitted call alone does not prove successful funding.
A future implementation must handle token transfer receipts, failed delivery, token decimals, and any required bridge.

## Validation limits

Local tests deploy both contracts in the GenLayer Python simulator.
A test adapter models balances, transaction rollback, and delayed finalized messages.
It also invokes the captured validator function with separate mocked inference results.
These tests exercise accounting and authorization without real network fees or funds.

The local Docker replay exercised live inference, validator consensus, finalized settlement, and GEN delivery to both wallets.
It uses hypothetical audit terms and accelerated deadlines in a separate replay protocol.
A funded public release still needs network-specific validation for runtime compatibility, fees, finality, and payment delivery.
The frontend supports agreements, vesting, claims, auditor responses, and governor decisions.

## Sources

- [Bevor v1 source](https://github.com/Bevor-Protocol/bevor-v1/tree/f5d76d36a00ba86315cc0f52298610660685a81e)
- [GenLayer contract interactions](https://docs.genlayer.com/developers/intelligent-contracts/features/interacting-with-intelligent-contracts)
- [GenLayer value transfers](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers)
- [GenLayer transaction context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)

## Agreement discovery

`list_audits(cursor=0, limit=20)` returns summaries from newest to oldest.
Use zero to start at the newest agreement.
Pass `next_cursor` for the next page.
A returned zero means that there are no older agreements.
The maximum page size is 50.
Summaries include payment totals, state, project name, deadlines, and party addresses.
Use `get_audit` for the fixed terms, claim, and response.

The frontend reads finalized state and polls selected agreements every 15 seconds.
It polls the list and governor record every 30 seconds.
Money calculations use whole wei, including the live vesting estimate.
The browser clock affects estimates and action visibility.
Contract time controls actual execution.
