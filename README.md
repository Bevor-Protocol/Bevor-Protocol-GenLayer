# Bevor-Protocol-GenLayer

Bevor holds audit payments and releases them to an auditor over time.
A client can report an exploit during that vesting period.
The governor uses independently repeated inference to determine whether the auditor is liable under the agreed audit terms.
A confirmed claim stops vesting and returns the unvested balance to the client.

## Contracts

[`BevorProtocol`](contracts/bevor_protocol.py) holds GEN payments and manages agreements, vesting, claims, withdrawals, and refunds.
Each agreement covers one client and one auditor.
The auditor must accept the fixed terms before vesting starts.

[`BevorGovernor`](contracts/bevor_governor.py) evaluates exploit evidence against the audit scope, report, exclusions, and liability terms.
It sends a settlement message only after a conclusive decision reaches finalization.
Finalization means that the network appeal period is complete.

Payments use native GEN in wei, the smallest payment unit.
USDC payments are not implemented.

Read [the architecture and contract interface](docs/architecture.md) for the lifecycle, assumptions, and limits.
The `frontend/` workspace supports agreement funding, acceptance, vesting, claims, auditor responses, and governor review.

## Local setup

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), a Python dependency manager.
From the repository root, install the locked dependencies:

```sh
uv sync --locked
```

Lint both contracts:

```sh
uv run --locked genvm-lint check contracts/bevor_protocol.py
uv run --locked genvm-lint check contracts/bevor_governor.py
```

Run the local tests:

```sh
uv run --locked pytest tests/direct/ -v
```

The tests simulate GEN transfers and queued messages between both contracts.
They also call the governor validator function with independent mocked responses.
They do not use real network consensus, live inference, or actual GEN transfers.

`pyproject.toml` defines dependencies and development tools.
`uv.lock` records exact versions and Git revisions.
Use `uv add <package>` or `uv add --dev <package>` to change dependencies.
Commit both files after dependency changes.

## Localnet startup

Start Docker Desktop, then run these commands from the repository root:

```sh
npm ci
npm run local
```

Open http://localhost:3010.
The script deploys both contracts and connects the frontend to the local protocol.
It funds three local test wallets with at least 1,000 GEN each.
Use `npm run local:wallets` to print keys for import into your wallet extension.
Read [the localnet guide](localnet/README.md) for wallet setup, AI configuration, and shutdown commands.

For a wallet-free governance replay, set `OPENAIKEY` in `localnet/.env`, then run `npm run local:governance`.
Open http://localhost:3010/demo to inspect both parties' statements, fetched evidence, the governor decision, and settlement.
The replay uses hypothetical audit terms for the historical Euler exploit and local test GEN.

## Frontend

Install dependencies and start the workspace from the repository root:

```sh
npm ci
npm run dev
```

Set the deployed protocol address through the network button in the frontend.
The frontend supports the current contract version, including its `list_audits` method.
Read [the frontend guide](frontend/README.md) for wallet, vesting, claim, and test instructions.

## Deployment

Install and configure the [GenLayer CLI](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-cli).
Select the target network with `genlayer network set`.
Deploy the governor first:

```sh
npm run deploy:governor
```

Make sure that the receipt reports successful execution and finalization.
Copy the deployed governor address from the receipt.
Deploy the protocol with that address:

```sh
npm run deploy:protocol -- --args 0xYOUR_GOVERNOR_ADDRESS
```

The protocol governor address is permanent.
Make sure that both deployments execute successfully before creating any agreement.
Local Docker tests exercised funding, vesting, live governor inference, settlement, refunds, and auditor withdrawals through the SDK.
Public network deployment through these CLI commands remains untested.
Test network consensus, message delivery, fees, and refunds before using real funds.

## References

[Bevor v1 Solidity reference](docs/reference/bevor-v1-solidity.md) preserves the original contracts at revision `f5d76d36a00ba86315cc0f52298610660685a81e`.
[GenLayer boilerplate reference](docs/reference/genlayer-boilerplate.md) preserves the imported example contracts, tests, and deployment script.

The boilerplate came from [GenLayer](https://github.com/genlayerlabs/genlayer-project-boilerplate/tree/e685f1f12c4c357787d48390692a654baf576f03).
[LICENSE](LICENSE) covers Bevor Protocol code.
[LICENSE.genlayer](LICENSE.genlayer) preserves the upstream boilerplate license.
