import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { formatEther } from "viem";
import {
  wallets,
  sdkFor,
  read,
  finalized,
  deploymentAddress,
} from "./localnet-lib.mjs";

export const evidence = {
  incident: "https://forum.euler.finance/raw/947",
  reproduction:
    "https://raw.githubusercontent.com/SunWeb3Sec/DeFiHackLabs/2baf1a43c44d6cb3ce17a678701784fbe7edabad/src/test/2023-03/Euler_exp.sol",
  code: "https://raw.githubusercontent.com/euler-legacy-xyz/euler-contracts/b1ee3265853628d5a529081d7908c38404201b4e/contracts/modules/EToken.sol",
};

export function demoProtocol(source) {
  const start = "audit.start = u256(_now())";
  const deadline = "int(audit.claim_opened) + 86400";
  assert.equal(source.split(start).length - 1, 1, "Unexpected acceptance code");
  assert.equal(
    source.split(deadline).length - 1,
    3,
    "Unexpected response deadline code",
  );
  // Isolated historical replay only. Keep the actual governor unchanged.
  return source
    .replace(
      start,
      "audit.start = u256(1677628800)  # DEMO: March 1, 2023 replay",
    )
    .replaceAll(deadline, "int(audit.claim_opened) + 60");
}

export async function governance({ rpc, rpcUrl, manifest, stateDir, root }) {
  const client = sdkFor(rpcUrl, wallets[1]);
  const auditor = sdkFor(rpcUrl, wallets[2]);
  const deployer = sdkFor(rpcUrl);
  const code = demoProtocol(
    await readFile(join(root, "contracts/bevor_protocol.py"), "utf8"),
  );
  const governorCode = await readFile(
    join(root, "contracts/bevor_governor.py"),
    "utf8",
  );
  await writeFile(join(stateDir, "bevor_protocol_demo.py"), code);
  const fingerprint = createHash("sha256")
    .update(code)
    .update(governorCode)
    .digest("hex");
  const path = join(stateDir, "governance-demo.json");
  let record = {
    fingerprint,
    rpcUrl,
    governor: manifest.governor.address,
    transactions: {},
    scenario: "Euler historical replay · hypothetical audit terms",
    responseWindowSeconds: 60,
    replayStart: "2023-03-01T00:00:00Z",
    evidence,
  };
  try {
    const previous = JSON.parse(await readFile(path, "utf8"));
    if (previous.fingerprint === fingerprint && previous.rpcUrl === rpcUrl)
      record = previous;
    else
      await writeFile(
        join(stateDir, `governance-demo-${previous.fingerprint}.json`),
        JSON.stringify(previous, null, 2) + "\n",
        { mode: 0o600 },
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (record.completedAt) {
    console.log(
      `Existing demo completed: ${record.decision.verdict}. Open http://localhost:3010/demo.`,
    );
    return;
  }
  async function save() {
    await writeFile(
      path + ".tmp",
      JSON.stringify(
        record,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await rename(path + ".tmp", path);
  }
  async function tx(label, submit) {
    let step = record.transactions[label];
    if (!step || step.failed) {
      console.log(`\n${label}`);
      step = record.transactions[label] = { hash: await submit() };
      await save();
    }
    try {
      const receipt = await finalized(rpc, step.hash, 600000);
      step.finalized = true;
      await save();
      return receipt;
    } catch (error) {
      if (error.terminal) {
        step.failed = true;
        await save();
      }
      throw error;
    }
  }
  const send =
    (sdk, address, functionName, args, value = 0n) =>
    () =>
      sdk.writeContract({ address, functionName, args, value });
  console.log(
    "\nLOCAL HISTORICAL REPLAY: synthetic audit agreement, real public evidence and real governor inference.",
  );
  console.log(
    "The demo protocol backdates acceptance to March 1, 2023 and allows a 60-second response. The standard protocol keeps its normal deadlines.",
  );
  for (const url of Object.values(evidence)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const bytes = await response.arrayBuffer();
    assert.ok(
      response.ok && bytes.byteLength > 0 && bytes.byteLength <= 64000,
      `Unreadable evidence: ${url}`,
    );
  }
  const governorReceipt = await tx("Deploy replay governor", () =>
    deployer.deployContract({ code: governorCode, args: [] }),
  );
  record.governor = deploymentAddress(governorReceipt);
  await save();
  const receipt = await tx("Deploy replay protocol", () =>
    deployer.deployContract({ code, args: [record.governor] }),
  );
  record.protocol = deploymentAddress(receipt);
  await save();
  const terms = JSON.stringify({
    project: "Euler historical replay (local demo)",
    chain: "Ethereum mainnet, chain ID 1",
    deployment:
      "Euler V1 core 0x27182842E098f60e3D576794A5bFFb0777E025d3; eDAI 0xe025E3ca2bE02316033184551D4d3Aa22024D9DC",
    audited_commit:
      "euler-legacy-xyz/euler-contracts b1ee3265853628d5a529081d7908c38404201b4e, contracts/modules/EToken.sol",
    scope:
      "Hypothetical full-scope audit covering the Euler V1 eDAI deposit, mint, donateToReserves, account health checks, and their interaction with liquidation in the specified revision.",
    exclusions:
      "Stolen admin keys and unrelated contracts only. Flash-loan financing and self-liquidation do not exclude defects in the covered Euler code. Later recovery of stolen funds does not erase responsibility for an exploit.",
    report:
      "LOCAL DEMO: this is a hypothetical agreement with the local auditor wallet, not a claim about any real auditing firm. The hypothetical auditor reported no findings in the covered code and did not disclose or obtain acceptance of a missing health check in donateToReserves.",
    liability:
      "Under this hypothetical agreement, the local auditor accepts responsibility for an undisclosed missing account-health check in covered code if independent evidence shows that this defect enabled an actual exploit of the named deployment after the replay acceptance date. The exploit must be established from evidence, not assumed from the allegation.",
  });
  const amount = 10n * 10n ** 18n;
  await tx(
    "Client funds 10 GEN",
    send(
      client,
      record.protocol,
      "create_audit",
      [wallets[2].address, 10 * 365 * 86400, 0, terms],
      amount,
    ),
  );
  record.auditId = "1"; // The freshly deployed replay protocol has one agreement.
  await save();
  await tx(
    "Auditor accepts replay terms",
    send(auditor, record.protocol, "accept_audit", [record.auditId]),
  );
  let audit = await read(client, record.protocol, "get_audit", [
    record.auditId,
  ]);
  if (!audit.claim_id) {
    assert.ok(BigInt(audit.vested) > 0n && BigInt(audit.vested) < amount);
    console.log(
      `Partially vested: ${formatEther(BigInt(audit.vested))} of 10 GEN.`,
    );
  }
  await tx(
    "Client submits allegation and three sources",
    send(client, record.protocol, "open_claim", [
      record.auditId,
      "The March 13, 2023 Euler V1 exploit used donateToReserves to remove collateral without an account-health check, followed by profitable self-liquidation. I allege this was an undisclosed defect in the covered revision and request return of the unvested audit payment under our hypothetical agreement. See the Euler recovery record, independent exploit reproduction with the attack transaction, and the pinned EToken source.",
      [evidence.incident, evidence.reproduction, evidence.code],
    ]),
  );
  await tx(
    "Auditor responds with defense and evidence",
    send(auditor, record.protocol, "submit_response", [
      record.auditId,
      "I dispute liability. The attack used an external Aave flash loan and deliberate self-liquidation rather than normal use. The recovery record also says that much of the stolen assets was recovered. I argue these facts should remove responsibility, although I acknowledge our hypothetical scope includes donateToReserves and the report disclosed no missing health check. Please weigh my defense against the exact exclusions and liability standard.",
      [evidence.reproduction, evidence.incident],
    ]),
  );
  audit = await read(client, record.protocol, "get_audit", [record.auditId]);
  record.claimId = audit.claim_id;
  record.audit = audit;
  record.clientBalanceBeforeReview ??= await rpc("eth_getBalance", [
    wallets[1].address,
    "latest",
  ]);
  await save();
  while (Date.now() / 1000 <= Number(audit.response_deadline) + 2) {
    console.log("Waiting for the demo response window to close…");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await tx(
    "Governor fetches evidence and validators independently infer",
    send(client, record.governor, "adjudicate", [
      record.protocol,
      record.auditId,
    ]),
  );
  record.decision = await read(client, record.governor, "get_decision", [
    record.protocol,
    record.auditId,
    record.claimId,
  ]);
  await save();
  console.log(
    `\nGovernor verdict: ${record.decision.verdict}\n${record.decision.rationale}`,
  );
  if (record.decision.verdict !== "inconclusive") {
    const until = Date.now() + 180000;
    do {
      audit = await read(client, record.protocol, "get_audit", [
        record.auditId,
      ]);
      if (audit.outcome === record.decision.verdict) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } while (Date.now() < until);
    assert.equal(
      audit.outcome,
      record.decision.verdict,
      "Governor settlement did not arrive.",
    );
    if (record.decision.verdict === "liable") {
      const target =
        BigInt(record.clientBalanceBeforeReview) + BigInt(audit.refunded);
      const until = Date.now() + 120000;
      do {
        record.clientBalanceAfterReview = await rpc("eth_getBalance", [
          wallets[1].address,
          "latest",
        ]);
        if (BigInt(record.clientBalanceAfterReview) >= target) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } while (Date.now() < until);
      assert.ok(
        BigInt(record.clientBalanceAfterReview) >= target,
        "The client refund was not delivered.",
      );
      assert.equal(BigInt(audit.refunded), amount - BigInt(audit.vested));
      console.log(
        `Refund delivered: ${formatEther(BigInt(audit.refunded))} local GEN. Auditor vested entitlement: ${formatEther(BigInt(audit.vested))} GEN.`,
      );
    }
  }
  record.audit = audit;
  record.completedAt = new Date().toISOString();
  await save();
  console.log(
    "Open http://localhost:3010/demo to inspect both statements, evidence, and the governor result without a wallet.",
  );
}
