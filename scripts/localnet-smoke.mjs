import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wallets, sdkFor, read, finalized } from "./localnet-lib.mjs";

export async function smoke({ rpc, rpcUrl, manifest, stateDir }) {
  const client = sdkFor(rpcUrl, wallets[1]),
    auditor = sdkFor(rpcUrl, wallets[2]);
  const protocol = manifest.protocol.address;
  const terms = JSON.stringify({
    project: "Local vesting smoke test",
    chain: "GenLayer Localnet",
    deployment: protocol,
    audited_commit: "local-demo",
    scope: "Local transfer and vesting test",
    exclusions: "No real audit coverage",
    report: "Local development fixture",
    liability: "Development test only",
  });
  const amount = 10n ** 18n;
  async function write(sdk, method, args, value = 0n) {
    const hash = await sdk.writeContract({
      address: protocol,
      functionName: method,
      args,
      value,
    });
    return finalized(rpc, hash);
  }
  console.log("\nTesting a real 60-second vesting agreement with 1 local GEN.");
  await write(
    client,
    "create_audit",
    [wallets[2].address, 60, 0, terms],
    amount,
  );
  const listing = await read(client, protocol, "list_audits", [0, 1]);
  const id = listing.audits[0].audit_id;
  let audit = await read(client, protocol, "get_audit", [id]);
  assert.equal(audit.state, "proposed");
  assert.equal(BigInt(audit.amount), amount);
  await write(auditor, "accept_audit", [id]);
  audit = await read(client, protocol, "get_audit", [id]);
  assert.equal(audit.state, "active");
  const deadline = Date.now() + 120000;
  while (BigInt(audit.vested) < amount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    audit = await read(client, protocol, "get_audit", [id]);
  }
  assert.equal(BigInt(audit.vested), amount);
  const before = BigInt(
    await rpc("eth_getBalance", [wallets[2].address, "latest"]),
  );
  await write(auditor, "withdraw", [id]);
  audit = await read(client, protocol, "get_audit", [id]);
  assert.equal(BigInt(audit.withdrawn), amount);
  assert.equal(BigInt(audit.withdrawable), 0n);
  let after = before;
  const transferDeadline = Date.now() + 120000;
  while (after < before + amount && Date.now() < transferDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    after = BigInt(await rpc("eth_getBalance", [wallets[2].address, "latest"]));
  }
  assert.ok(
    after >= before + amount,
    "The auditor did not receive the GEN transfer.",
  );
  await writeFile(
    join(stateDir, "smoke.json"),
    JSON.stringify(
      {
        protocol,
        auditId: id,
        testedAt: new Date().toISOString(),
        amountWei: amount.toString(),
        auditorBalanceBefore: before.toString(),
        auditorBalanceAfter: after.toString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Localnet smoke test passed. Agreement #${id}: funded, accepted, fully vested, withdrawn, and GEN delivered.`,
  );
}
