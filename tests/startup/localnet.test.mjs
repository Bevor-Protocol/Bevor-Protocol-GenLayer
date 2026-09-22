import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localRpcUrl,
  rpcFor,
  wallets,
  updateEnv,
  deploymentAddress,
  finalized,
} from "../../scripts/localnet-lib.mjs";
test("funding and signing are restricted to loopback and valid ports", () => {
  assert.equal(localRpcUrl("4010"), "http://127.0.0.1:4010/api");
  for (const port of ["443", "65536", "4010;rm", "1.5"])
    assert.throws(() => localRpcUrl(port));
  assert.throws(() => rpcFor("https://studio.genlayer.com/api"));
  assert.throws(() => rpcFor("http://127.0.0.1.example.com/api"));
  assert.equal(new Set(wallets.map((w) => w.address)).size, 3);
});
test("frontend env changes preserve unrelated settings and remove duplicate deployment values", () => {
  const result = updateEnv(
    "# local\nKEEP=value\nNEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS=old\nexport NEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS=duplicate\n",
    { NEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS: "new" },
  );
  assert.equal(
    result,
    "# local\nKEEP=value\nNEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS=new\n",
  );
});
test("deployment requires a real address and successful finalized execution", async () => {
  assert.throws(() => deploymentAddress({ data: {} }));
  assert.equal(
    deploymentAddress({ data: { contract_address: wallets[0].address } }),
    wallets[0].address,
  );
  await assert.rejects(
    () =>
      finalized(
        async () => ({
          status: "FINALIZED",
          consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
        }),
        "0x123",
      ),
    /execution failed/,
  );
  await assert.rejects(
    () => finalized(async () => ({ status: "CANCELED" }), "0x123"),
    /canceled/,
  );
  const good = {
    status: "FINALIZED",
    consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
  };
  assert.equal(await finalized(async () => good, "0x123"), good);
  await assert.rejects(
    () =>
      finalized(
        async () => ({
          status: "FINALIZED",
          consensus_data: {
            leader_receipt: [
              {
                execution_result: "ERROR",
                genvm_result: { stderr: "" },
                result: Buffer.concat([
                  Buffer.from([1]),
                  Buffer.from(
                    "[LLM_ERROR] Citation does not match fetched evidence",
                  ),
                ]).toString("base64"),
              },
            ],
          },
        }),
        "0x123",
      ),
    /Citation does not match fetched evidence/,
  );
});

test("faucet amounts use exact JSON integers", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    body = init.body;
    return { ok: true, json: async () => ({ result: "funded" }) };
  });
  assert.equal(
    await rpcFor("http://127.0.0.1:4010/api")("sim_fundAccount", [
      wallets[0].address,
      10n ** 21n + 1n,
    ]),
    "funded",
  );
  assert.ok(body.includes(",1000000000000000000001]"));
});
