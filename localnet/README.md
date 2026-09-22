# Local development

The startup command runs an isolated GenLayer Studio stack in Docker.
It deploys Bevor Governor first, then Bevor Protocol with that governor address.
It funds three public test wallets with at least 1,000 local GEN each.
It writes the protocol address to `frontend/.env.local` and starts the frontend.

## Start

Install Node.js 22 or later.
Start Docker Desktop.
From the repository root, install dependencies:

```sh
npm ci
```

Start Bevor:

```sh
npm run local
```

Open [Bevor](http://localhost:3010).
The first start downloads Docker images and compiles GenVM for your computer.
Later starts reuse the containers, database, wallets, and matching contract deployments.
Changed contract source creates a new deployment without deleting older agreements.

The local RPC server runs at `http://127.0.0.1:4010/api`.
RPC means the server interface for blockchain requests.
The stack uses chain ID `61127` and currency symbol `GEN`.
Only the RPC port is exposed, and it binds to the loopback address.
The local database does not use your system PostgreSQL port.

The startup command forces the frontend to use this local deployment.
Saved browser configuration does not override it during `npm run local`.
Other keys in `frontend/.env.local` remain intact.

## Import the wallets

Print the local wallet addresses and private keys:

```sh
npm run local:wallets
```

Import the client private key into MetaMask or another Ethereum wallet extension.
Import the auditor private key as a second account.
Open Bevor and select Connect wallet.
Approve the GenLayer Localnet network when the wallet asks.
If that network already exists, set its RPC URL to `http://127.0.0.1:4010/api` in the wallet network configuration.

Use these public keys only on this localnet. Anyone can access these wallets on other networks.
They come from the standard development mnemonic and contain no private production credentials.
The startup command saves a copy in `.localnet/wallets.json`.
Git ignores this directory.

Connect the client account to fund an agreement.
For a quick trial, choose Minutes as the schedule unit and set a five-minute duration.
Switch to the auditor account to accept the agreement and start vesting.
Withdrawals become available according to the agreed schedule.
Switch back to the client account to submit a claim.
The auditor can then submit its response with evidence.

Wallet balances represent local test GEN, not real funds.
The script explicitly funds the wallets because new accounts do not automatically hold GEN.
Restarting setup tops up balances below 1,000 GEN.

## Governor inference

Run a complete governance replay without a wallet extension:

```sh
npm run local:governance
```

Set `OPENAIKEY` first and keep the frontend running with `npm run local`.
The replay deploys a separate local protocol, funds 10 GEN, submits a client claim, and submits the auditor response.
It then calls the real governor, waits for settlement, and checks delivery of any refund.
Open [the governance replay](http://localhost:3010/demo) to inspect the statements, evidence, verdict, and vesting without a wallet.

The scenario uses the historical Euler exploit and hypothetical audit terms with the local auditor wallet.
It does not assess any real auditing firm's liability.
Public evidence comes from Euler's recovery record, a pinned exploit reproduction, and the pinned Euler source.
The separate protocol backdates acceptance to March 1, 2023 and uses a one-minute response window.
The normal protocol retains its standard deadlines.
The replay governor uses the current governor source without changing its liability or validator rules.
The replay retains real validator consensus and uses the configured model provider account.
The verdict is not fixed by the script.

The command saves progress and transaction hashes in `.localnet/governance-demo.json`.
Run it again to resume a pending step or view an existing completed result.
The demo page is available only when the frontend runs in local mode.

Create a partially vested agreement for a manual governance test:

```sh
npm run local:seed
```

Each run funds a new agreement with 10 local GEN and accepts it with the auditor wallet.
The schedule lasts two hours and has no cliff.
The command waits until at least 1% is vested, then leaves the agreement active without withdrawals or a claim.
It prints the agreement ID and saves the details in `.localnet/governance-smoke.json`.

Open the agreement in the frontend with the client wallet.
Under Claim & response, submit an allegation and supporting HTTPS evidence URLs before the two-hour schedule ends.
Filing the claim freezes vesting and withdrawals.
Switch to the auditor wallet to submit a response.
Governor review becomes available 24 hours after filing, even if the auditor responds earlier.
Submit the review before the claim expires seven days after filing.

The agreement uses synthetic audit terms for the deployed Bevor Protocol source.
It does not assert that an exploit occurred or guarantee a liability verdict.
Use readable text or JSON evidence that supports the allegation.
The governor cannot establish liability from an unsupported test allegation.
This command does not shorten contract deadlines or submit an inference request.

Vesting and transfers work without an AI key.
Governor decisions use OpenAI `gpt-4o` through five local validators by default.

Set `OPENAIKEY` in the ignored `localnet/.env` file.
Restart `npm run local` to pass the key to the containers.
The governor sends public claim evidence to the configured model provider.
Inference uses that provider account and can incur charges.

The normal contract deadlines still apply.
The auditor gets 24 hours to respond, and the decision window lasts seven days.
The startup script does not shorten these rules or simulate a governor verdict.

## Other commands

Stop the frontend with Ctrl+C.
Stop the localnet without deleting its database:

```sh
npm run local:stop
```

Deploy and configure without starting the frontend:

```sh
npm run local:setup
```

Inspect container logs:

```sh
npm run local:logs
```

Run a real local vesting test:

```sh
npm run local:smoke
```

The test funds a new agreement with 1 local GEN and a 60-second schedule.
It accepts the agreement, waits for vesting, withdraws, and confirms the auditor wallet receives GEN.
The test leaves its agreement in the local database.
It saves its result in `.localnet/smoke.json`.
It does not request an AI decision.

## Configuration and recovery

The first run copies `.env.example` to `localnet/.env`.
Set `BEVOR_RPC_PORT` or `BEVOR_FRONTEND_PORT` there to change the default ports.
Restart the startup command after a change.

Deployment receipts must report successful execution and finalization.
Finalization means that the network appeal period is complete.
If receipt polling times out, restart setup to continue from the saved transaction hash.
The script stores deployment records in `.localnet/deployment.json`.
It never resets the Docker database automatically.

The stack pins GenLayer Studio `v0.121.6` and the webdriver image `0.0.9`.
The local Studio images include a compatibility patch for finalized reads between contracts.
Upstream `v0.121.6` rejects these reads despite storing finalized snapshots.
The patch reads the finalized snapshot without falling back to accepted state.
Its two regression tests run when Docker builds the local images.
The composition follows the [Studio release](https://github.com/genlayerlabs/genlayer-studio/tree/v0.121.6).
See the [GenLayer development guide](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup) for the upstream setup.
