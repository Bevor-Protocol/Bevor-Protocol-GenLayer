import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatEther } from "viem";
import { wallets, sdkFor, read, finalized } from "./localnet-lib.mjs";

// Leave an active agreement for manual claim submission. Never call adjudicate
// or withdraw here: the user needs an unspent balance and an unused claim.
export async function seed({ rpc, rpcUrl, manifest, stateDir }) {
  const client = sdkFor(rpcUrl, wallets[1]);
  const auditor = sdkFor(rpcUrl, wallets[2]);
  const protocol = manifest.protocol.address;
  const fixtureId = randomUUID();
  const project = `Governance smoke test (${fixtureId.slice(0, 8)})`;
  const amount = 10n * 10n ** 18n;
  const duration = 2 * 60 * 60;
  const terms = JSON.stringify({
    project,
    chain: "GenLayer Localnet",
    deployment: protocol,
    audited_commit: manifest.protocol.sourceHash,
    scope:
      "BevorProtocol payment escrow, vesting calculations, withdrawal authorization, claim freezing, and governor-only settlement at the identified source revision.",
    exclusions:
      "Compromised wallet keys, changes after the identified revision, and bugs in external providers are excluded.",
    report:
      "Synthetic local test agreement. For this fixture, assume the auditor reported no findings in the covered code. This is not an actual audit report and does not assert that an exploit occurred.",
    liability:
      "For this test agreement, the auditor is liable if evidence establishes an actual exploit of this deployment during its vesting period caused by an undisclosed defect within the agreed scope at the audited revision. Missing evidence is not proof of liability.",
  });
  async function write(sdk, functionName, args, value = 0n) {
    const hash = await sdk.writeContract({
      address: protocol,
      functionName,
      args,
      value,
    });
    await finalized(rpc, hash);
    return hash;
  }
  console.log(`\nCreating ${project}: 10 local GEN, two hours, no cliff.`);
  const createHash = await write(
    client,
    "create_audit",
    [wallets[2].address, duration, 0, terms],
    amount,
  );
  const listing = await read(client, protocol, "list_audits", [0, 50]);
  const summary = listing.audits.find((audit) => audit.project === project);
  assert.ok(summary, "The new agreement is not present in finalized state.");
  const id = summary.audit_id;
  let audit = await read(client, protocol, "get_audit", [id]);
  assert.equal(audit.terms.project, project);
  assert.equal(audit.client.toLowerCase(), wallets[1].address.toLowerCase());
  assert.equal(audit.auditor.toLowerCase(), wallets[2].address.toLowerCase());
  assert.equal(BigInt(audit.amount), amount);
  assert.equal(audit.state, "proposed");
  const record = {
    protocol,
    governor: manifest.governor.address,
    auditId: id,
    project,
    createHash,
    amountWei: amount.toString(),
    durationSeconds: duration,
  };
  const save = () =>
    writeFile(
      join(stateDir, "governance-smoke.json"),
      JSON.stringify(record, null, 2) + "\n",
      { mode: 0o600 },
    );
  await save();
  record.acceptHash = await write(auditor, "accept_audit", [id]);
  await save();
  console.log(
    `Agreement #${id} accepted. Waiting until at least 1% is vested (about 72 seconds after acceptance).`,
  );
  const deadline = Date.now() + 180000;
  do {
    audit = await read(client, protocol, "get_audit", [id]);
    if (BigInt(audit.vested) >= amount / 100n) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (Date.now() < deadline);
  const vested = BigInt(audit.vested);
  assert.equal(audit.state, "active");
  assert.ok(
    vested >= amount / 100n && vested < amount,
    "Expected partial vesting.",
  );
  assert.equal(BigInt(audit.withdrawn), 0n);
  assert.equal(BigInt(audit.refunded), 0n);
  assert.equal(audit.claim_id, "");
  Object.assign(record, {
    checkedAt: new Date().toISOString(),
    vestedWei: vested.toString(),
    unvestedWei: (amount - vested).toString(),
    client: audit.client,
    auditor: audit.auditor,
    claimMustOpenBefore: new Date(
      (Number(audit.start) + duration) * 1000,
    ).toISOString(),
  });
  await save();
  console.log(
    `Ready: agreement #${id}. ${formatEther(vested)} GEN vested; ${formatEther(amount - vested)} GEN unvested.`,
  );
  console.log(
    `Connect the client wallet and open Claim & response before ${record.claimMustOpenBefore}. Filing freezes vesting.`,
  );
  console.log(
    "Governor review requires evidence and starts 24 hours after filing, even if the auditor responds earlier. This command does not run inference or guarantee a verdict.",
  );
}
