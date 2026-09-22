# Bevor frontend

This workspace manages Bevor Protocol agreements on GenLayer.
Clients fund audits in native GEN and submit claims with public evidence.
Auditors accept terms, withdraw vested payments, and respond to claims.
The governor evaluates evidence and audit terms to decide liability.

## Start the workspace

From the repository root, install the JavaScript dependencies:

```sh
npm ci
```

Copy the frontend environment example:

```sh
cp frontend/.env.example frontend/.env.local
```

Set `NEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS` to your deployed protocol address.
Set `NEXT_PUBLIC_GENLAYER_NETWORK` to `studionet`, `localnet`, or `testnetBradbury`.
If you use a different RPC server, set `NEXT_PUBLIC_GENLAYER_RPC_URL`.
RPC means the server interface that reads and submits blockchain transactions.

Start the frontend:

```sh
npm run dev
```

Open the local URL printed by Next.js.
You can also set the deployment through the network button in the header.
The browser saves this configuration locally.
A custom RPC server must allow requests from the frontend origin.

Use the current `BevorProtocol` contract, which includes `list_audits`.
The frontend reads the immutable governor address from the protocol.
An older deployment without this method cannot populate the agreement list.

## Agreement workflow

Connect the client wallet.
Select New agreement.
Enter the auditor address, GEN payment, schedule, and all audit terms.
Review the fixed terms before signing.
The contract holds the full payment until the auditor accepts or the client cancels.

Connect the auditor wallet to accept the agreement.
Acceptance starts the vesting schedule.
Vesting releases a payment over time.
A cliff delays the first withdrawal until a specified time.
After the cliff, the auditor can withdraw all value vested since acceptance.

The workspace shows vested value, unvested escrow, recorded withdrawals, and recorded refunds.
It shows cumulative totals because the contract does not expose individual payment events.
Live estimates use the browser clock.
The withdrawal amount comes from the last finalized contract state.
Finalized state means that the network appeal period is complete.
The contract calculates the actual payment when the withdrawal executes.

## Claim workflow

The client can submit one claim before the vesting schedule ends.
A claim pauses vesting and withdrawals.
The auditor gets 24 hours to submit one response.
Statements and evidence become public and cannot be edited.
Claims require one to five public HTTPS evidence URLs.
Responses allow up to five URLs.

After the response deadline, any connected wallet can request a governor review.
The governor assesses whether a hack occurred, whether it falls within scope, and whether the auditor is liable.
The workspace shows the rationale and cited evidence.
An inconclusive decision leaves the claim open for another review.

A liable decision ends vesting at the claim time and refunds the unvested balance.
A not-liable decision resumes the original vesting schedule.
After seven days, any wallet can close an unresolved claim and resume vesting.
The client cannot open another claim on that agreement.

## Transactions

The wallet network and RPC network must match the selected deployment before signing.
The app waits for finalization and a successful execution result.
Finalization alone does not prove that an action succeeded.

A pending transaction blocks further submissions in that browser tab.
The browser saves its hash for recovery after a reload.
If receipt polling times out, select Get transaction result.
Do not submit the same payment again while its result is unknown.

Governor decisions and payment transfers can settle in later transactions.
A recorded decision does not prove that the protocol applied it.
If a conclusive decision remains unsettled, select Resend settlement before the claim deadline.
Inspect the recipient wallet for actual payment delivery.

## Tests

Run these commands from the repository root:

```sh
npm run lint
npm run test:frontend
npx playwright install chromium
npm run test:browser
npm run build
```

Browser tests use simulated RPC responses and an injected test wallet on desktop and mobile.
They cover funding, acceptance failures, claims, responses, governor requests, role changes, and network errors.
They do not prove live consensus, wallet extension behavior, or delivery of real GEN.
