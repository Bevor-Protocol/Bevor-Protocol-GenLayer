import { test, expect, type Page } from "@playwright/test";
import { abi } from "genlayer-js";
import { fromRlp, hexToBytes } from "viem";
import { normalize, type Audit } from "../../lib/bevor/model";
const protocol = `0x${"33".repeat(20)}`,
  governor = `0x${"44".repeat(20)}`;
const client = `0x${"11".repeat(20)}`,
  auditor = `0x${"22".repeat(20)}`;
const now = Math.floor(Date.now() / 1000);
const audit = {
  audit_id: "1",
  governor,
  client,
  auditor,
  amount: 100n * 10n ** 18n,
  withdrawn: 10n * 10n ** 18n,
  refunded: 0n,
  vested: 40n * 10n ** 18n,
  withdrawable: 30n * 10n ** 18n,
  duration_seconds: 864000,
  cliff_seconds: 86400,
  start: now - 345600,
  state: "active",
  terms: {
    project: "Meridian Finance",
    chain: "Ethereum",
    deployment: protocol,
    audited_commit: "abc123",
    scope: "Vault withdrawals and access control",
    exclusions: "External oracle failures",
    report: "https://example.com/audit",
    liability: "Undisclosed critical defects in the audited commit",
  },
  claim: null,
  response: null,
  claim_id: "",
  claim_opened: 0,
  response_deadline: 0,
  claim_deadline: 0,
  outcome: "",
} satisfies Audit;
async function setup(
  page: Page,
  data: Audit = audit,
  wallet = client,
  options: { failExecution?: boolean; rpcFail?: boolean } = {},
) {
  const methods: string[] = [];
  await page.addInitScript(
    ({ protocol, wallet }) => {
      localStorage.setItem(
        "bevor.deployment",
        JSON.stringify({
          network: "localnet",
          protocol,
          rpc: "http://127.0.0.1:4000/api",
        }),
      );
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      let selected = wallet;
      Object.assign(window, {
        testWallet: (value: string) => {
          selected = value;
          listeners.accountsChanged?.forEach((fn) => fn([value]));
        },
      });
      window.ethereum = {
        request: async ({ method, params }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [selected];
          if (method === "eth_chainId") return "0xeec7";
          if (method === "eth_sendTransaction") {
            Object.assign(window, { lastTransaction: params?.[0] });
            return `0x${"aa".repeat(32)}`;
          }
          if (method === "wallet_switchEthereumChain") return null;
          throw new Error(`Unhandled wallet method: ${method}`);
        },
        on: (name, fn) => {
          listeners[name] ||= [];
          listeners[name].push(fn);
        },
        removeListener: (name, fn) => {
          listeners[name] = (listeners[name] || []).filter((v) => v !== fn);
        },
      };
    },
    { protocol, wallet },
  );
  await page.route("http://127.0.0.1:4000/api", async (route) => {
    const request = route.request().postDataJSON();
    methods.push(request.method);
    let result: unknown;
    if (request.method === "gen_call") {
      if (options.rpcFail)
        return route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32000, message: "RPC unavailable" },
          },
        });
      const encoded = fromRlp(request.params[0].data, "hex") as `0x${string}`[];
      const call = normalize(abi.calldata.decode(hexToBytes(encoded[0]))) as {
        method: string;
      };
      expect(request.params[0].transaction_hash_variant).toBe("latest-final");
      if (call.method === "list_audits")
        result = {
          audits: [{ ...data, project: data.terms.project }],
          next_cursor: 0,
          total: 1,
          governor,
        };
      else if (call.method === "get_audit") result = data;
      else if (call.method === "get_decision")
        return route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: request.id,
            result: { status: { code: 1, message: "Decision not found" } },
          },
        });
      else throw new Error(`Unexpected contract method ${call.method}`);
      result = Buffer.from(abi.calldata.encode(result as never)).toString(
        "hex",
      );
    } else if (request.method === "eth_chainId") result = "0xeec7";
    else if (request.method === "eth_getTransactionCount") result = "0x0";
    else if (request.method === "eth_estimateGas") result = "0x30d40";
    else if (request.method === "eth_gasPrice") result = "0x1";
    else if (request.method === "eth_getTransactionByHash")
      result = {
        hash: `0x${"aa".repeat(32)}`,
        status: "FINALIZED",
        consensus_data: {
          leader_receipt: [
            { execution_result: options.failExecution ? "ERROR" : "SUCCESS" },
          ],
        },
      };
    else throw new Error(`Unexpected RPC method ${request.method}`);
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/");
  return methods;
}
test("tracks vesting, shows fixed terms, and switches wallet roles", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole("button", { name: /Meridian Finance/ }).click();
  await expect(
    page.getByRole("heading", { name: "Meridian Finance", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("Available to withdraw at last refresh"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open a claim" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Withdraw 30/ })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `test-results/vesting-${testInfo.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Audit terms", exact: true }).click();
  await expect(
    page.getByText("Vault withdrawals and access control"),
  ).toBeVisible();
  await page.evaluate(
    (a) =>
      (window as unknown as { testWallet: (a: string) => void }).testWallet(a),
    auditor,
  );
  await expect(page.getByRole("button", { name: /Withdraw 30/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a claim" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("client submits a claim with reviewed evidence", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: /Meridian Finance/ }).click();
  await page.getByRole("button", { name: "Open a claim" }).click();
  await page
    .getByLabel("Allegation")
    .fill("The audited withdrawal function was exploited.");
  await page.getByLabel(/Evidence URLs/).fill("https://example.com/incident");
  await page.getByRole("button", { name: "Review submission" }).click();
  await expect(page.getByText(/Only one claim is allowed/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Submit claim finalized",
  );
  const tx = await page.evaluate(
    () =>
      (window as unknown as { lastTransaction: { value: string } })
        .lastTransaction,
  );
  expect(tx.value).toBe("0x0");
});
test("auditor can respond before the deadline and sees both statements", async ({
  page,
}) => {
  const disputed: Audit = {
    ...audit,
    state: "disputed",
    withdrawable: 0n,
    claim_id: "claim-1",
    claim_opened: now - 100,
    response_deadline: now + 86300,
    claim_deadline: now + 604700,
    claim: {
      allegation: "Vault exploit",
      evidence_urls: ["https://example.com/incident"],
    },
  };
  await setup(page, disputed, auditor);
  await page.getByRole("button", { name: /Meridian Finance/ }).click();
  await page.getByRole("button", { name: "Claim & response" }).click();
  await expect(page.getByText("Vault exploit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit auditor response" }).click();
  await page
    .getByLabel("Response", { exact: true })
    .fill("This deployment differs from the audited commit.");
  await page.getByRole("button", { name: "Review submission" }).click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Submit response finalized",
  );
});
test("governor review targets the immutable governor after the response window", async ({
  page,
}) => {
  await setup(
    page,
    {
      ...audit,
      state: "disputed",
      claim_id: "claim-1",
      claim_opened: now - 90000,
      response_deadline: now - 3600,
      claim_deadline: now + 500000,
      claim: {
        allegation: "Vault exploit",
        evidence_urls: ["https://example.com/incident"],
      },
      response: { statement: "The issue was excluded.", evidence_urls: [] },
    },
    auditor,
  );
  await page.getByRole("button", { name: /Meridian Finance/ }).click();
  await page.getByRole("button", { name: "Claim & response" }).click();
  await expect(page.getByText("The issue was excluded.")).toBeVisible();
  await page.getByRole("button", { name: "Request governor review" }).click();
  await expect(page.getByRole("dialog")).toContainText(governor);
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Request governor decision finalized",
  );
});
test("a finalized execution failure is not shown as success", async ({
  page,
}) => {
  await setup(
    page,
    { ...audit, state: "proposed", vested: 0n, withdrawable: 0n, start: 0 },
    auditor,
    { failExecution: true },
  );
  await page.getByRole("button", { name: /Meridian Finance/ }).click();
  await page.getByRole("button", { name: "Accept & start vesting" }).click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "failed during execution" }),
  ).toBeVisible();
  await expect(page.getByText("Accept agreement finalized.")).toHaveCount(0);
});
test("funding reviews the exact payment and sends it in GEN", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New agreement" }).click();
  await page.getByLabel("Auditor wallet").fill(auditor);
  await page.getByLabel("Payment (GEN)").fill("1.000000000000000001");
  await page.getByLabel("Schedule unit").selectOption("minutes");
  await page.getByLabel("Duration (minutes)").fill("5");
  for (const [label, value] of Object.entries({
    "Project name": "New audit",
    "Client chain": "Ethereum",
    "Audited deployment": protocol,
    "Audited commit": "abcdef",
    "Audit scope": "Vault",
    "Scope exclusions": "None",
    "Audit report": "https://example.com/report",
    "Liability terms": "Critical findings",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Review agreement" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "1.000000000000000001 GEN",
  );
  await expect(page.getByRole("dialog")).toContainText("Duration: 5 minutes");
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Fund agreement finalized",
  );
  const tx = await page.evaluate(
    () =>
      (window as unknown as { lastTransaction: { value: string } })
        .lastTransaction,
  );
  expect(BigInt(tx.value)).toBe(10n ** 18n + 1n);
});
test("RPC errors show a recoverable empty state", async ({ page }) => {
  await setup(page, audit, client, { rpcFail: true });
  await expect(
    page.getByRole("heading", { name: "Agreements unavailable" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
