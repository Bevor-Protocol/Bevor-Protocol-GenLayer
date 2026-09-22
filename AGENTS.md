# Development

This repository implements Bevor audit payment vesting and inference-based liability decisions.
Keep Python dependencies in `pyproject.toml` and exact versions in `uv.lock`.
Use uv from the repository root.

```sh
uv sync --locked
uv run --locked genvm-lint check contracts/bevor_protocol.py
uv run --locked genvm-lint check contracts/bevor_governor.py
uv run --locked pytest tests/direct/ -v
```

The local tests simulate GEN transfers and queued messages between both contracts.
They exercise the governor validator function with independent mocked responses.
They do not prove network consensus or real payment delivery.
Run network integration tests before any funded deployment.

The npm workspace includes the Bevor frontend in `frontend/`.
The frontend reads finalized agreement state and uses native GEN for payments.
Install JavaScript dependencies with `npm ci` from the repository root.
Start the frontend with `npm run dev`.
Run `npm run lint`, `npm run test:frontend`, and `npm run test:browser` after frontend changes.
Run `npm run build` before handing off frontend work.
Browser tests simulate RPC and wallet behavior. They do not use real funds.

Keep the existing Git remote and both license files.
Read `docs/architecture.md` before changing contract behavior.
Keep money calculations deterministic and integer-based.
Only the immutable governor can settle a claim.
Preserve independently repeated inference and finalized settlement messages.
Keep archived contracts in `docs/reference/` outside the active test suite.

Use `npm run local` for the isolated Docker localnet and frontend.
Keep local wallets and deployment records in ignored `.localnet/`.
Run `npm run test:startup` after startup script changes.
Use `npm run local:smoke` to test real local vesting and GEN delivery.
Never reset shared Docker state or use local test keys on a public network.
