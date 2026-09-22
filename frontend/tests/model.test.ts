import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actions,
  auditFrom,
  evidence,
  execution,
  money,
  parseAmount,
  vestedAt,
  type Audit,
} from "../lib/bevor/model";
const client = `0x${"11".repeat(20)}`,
  auditor = `0x${"22".repeat(20)}`;
const base = {
  client,
  auditor,
  amount: 1000n,
  start: 1000,
  duration_seconds: 1000,
  cliff_seconds: 100,
  state: "active",
  claim_id: "",
  claim: null,
  response: null,
  withdrawable: 100n,
  claim_opened: 1400,
  response_deadline: 1500,
  claim_deadline: 2000,
} as Audit;
test("GEN parsing preserves every wei without floating point", () => {
  assert.equal(
    parseAmount("1000000000000000000.000000000000000001"),
    10n ** 36n + 1n,
  );
  assert.equal(parseAmount("0.000000000000000001"), 1n);
  assert.equal(money(1n), "<0.000001");
  for (const value of [
    "1e6",
    "-1",
    "0",
    "0.0000000000000000001",
    "Infinity",
    "1.",
  ])
    assert.throws(() => parseAmount(value));
});
test("vesting respects cliff, integer rounding, freeze and release", () => {
  assert.equal(vestedAt(base, 1099), 0n);
  assert.equal(vestedAt(base, 1100), 100n);
  assert.equal(vestedAt({ ...base, amount: 7n }, 1333), 2n);
  assert.equal(vestedAt({ ...base, state: "disputed" }, 1800), 400n);
  assert.equal(vestedAt({ ...base, state: "terminated" }, 9999), 400n);
  assert.equal(vestedAt(base, 1800), 800n);
  assert.equal(vestedAt(base, 9999), 1000n);
  assert.equal(vestedAt({ ...base, state: "cancelled" }, 9999), 0n);
});
test("actions enforce wallet roles and exact deadline boundaries", () => {
  assert.equal(
    actions({ ...base, state: "proposed" }, auditor, 1100).accept,
    true,
  );
  assert.equal(
    actions({ ...base, state: "proposed" }, client, 1100).accept,
    false,
  );
  assert.equal(actions(base, client, 1999).claim, true);
  assert.equal(actions(base, client, 2000).claim, false);
  assert.equal(
    actions({ ...base, claim_id: "prior" }, client, 1500).claim,
    false,
  );
  const disputed = { ...base, state: "disputed" as const };
  assert.equal(actions(disputed, auditor, 1499).respond, true);
  assert.equal(actions(disputed, auditor, 1500).respond, false);
  assert.equal(actions(disputed, auditor, 1499).adjudicate, false);
  assert.equal(actions(disputed, client, 1500).adjudicate, true);
  assert.equal(actions(disputed, client, 2000).adjudicate, false);
  assert.equal(actions(disputed, client, 2000).expire, true);
  assert.equal(actions(disputed, auditor, 1400).withdraw, false);
  assert.equal(actions(disputed, null, 1500).adjudicate, false);
});
test("evidence rejects unsafe, duplicate and excessive URLs", () => {
  assert.deepEqual(
    evidence("https://example.com/report\nhttps://example.com/tx", true),
    ["https://example.com/report", "https://example.com/tx"],
  );
  assert.deepEqual(evidence("", false), []);
  for (const value of [
    "",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/#fragment",
    "https://example.com\nhttps://example.com",
    Array(6)
      .fill(0)
      .map((_, i) => `https://example.com/${i}`)
      .join("\n"),
  ])
    assert.throws(() => evidence(value, true));
});
test("finalization alone does not prove successful execution", () => {
  assert.equal(execution({ status: "FINALIZED" }), "unknown");
  assert.equal(execution({ statusName: "CANCELED" }), "failed");
  assert.equal(
    execution({ txExecutionResultName: "FINISHED_WITH_RETURN" }),
    "success",
  );
  assert.equal(execution({ txExecutionResult: 2 }), "failed");
  assert.equal(
    execution({
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    }),
    "success",
  );
  assert.equal(
    execution({
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    }),
    "failed",
  );
});
test("SDK maps preserve large monetary values and reject imprecise numbers", () => {
  const raw = {
    ...base,
    amount: 10n ** 30n,
    withdrawn: 0n,
    refunded: 0n,
    vested: 0n,
  };
  assert.equal(auditFrom(new Map(Object.entries(raw))).amount, 10n ** 30n);
  assert.throws(() => auditFrom({ ...raw, amount: 1e30 }), /imprecise/);
});
