import { createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { mnemonicToAccount } from "viem/accounts";
import { bytesToHex } from "viem";

// Public development mnemonic. These wallets must never hold real funds.
export const mnemonic =
  "test test test test test test test test test test test junk";
export const wallets = ["deployer", "client", "auditor"].map(
  (role, addressIndex) => {
    const account = mnemonicToAccount(mnemonic, { addressIndex });
    return {
      role,
      address: account.address,
      privateKey: bytesToHex(account.getHdKey().privateKey),
      account,
    };
  },
);
export function localRpcUrl(port) {
  if (
    !/^\d+$/.test(String(port)) ||
    Number(port) < 1024 ||
    Number(port) > 65535
  )
    throw new Error("Use a local RPC port between 1024 and 65535.");
  return `http://127.0.0.1:${port}/api`;
}
export function rpcFor(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:")
    throw new Error("Local wallet operations require the loopback RPC server.");
  return async function rpc(method, params = []) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        { jsonrpc: "2.0", id: 1, method, params },
        (_key, value) =>
          typeof value === "bigint" ? JSON.rawJSON(value.toString()) : value,
      ),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`RPC HTTP ${response.status} for ${method}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
    return payload.result;
  };
}
export function sdkFor(url, wallet = wallets[0]) {
  const rpc = rpcFor(url);
  const provider = {
    request: async ({ method, params }) => {
      if (method !== "eth_sendTransaction") return rpc(method, params);
      const tx = params[0];
      if (
        Number(tx.chainId) !== localnet.id ||
        tx.from.toLowerCase() !== wallet.address.toLowerCase()
      )
        throw new Error(
          "Refusing to sign outside the local wallet and network.",
        );
      const serialized = await wallet.account.signTransaction({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || 0),
        gas: BigInt(tx.gas),
        gasPrice: BigInt(tx.gasPrice || 0),
        nonce: Number(tx.nonce),
        chainId: localnet.id,
        type: "legacy",
      });
      return rpc("eth_sendRawTransaction", [serialized]);
    },
  };
  return createClient({
    chain: { ...localnet, rpcUrls: { default: { http: [url] } } },
    account: wallet.address,
    provider,
  });
}
export function normalize(value) {
  if (value instanceof Map)
    return Object.fromEntries(
      [...value].map(([key, v]) => [String(key), normalize(v)]),
    );
  if (Array.isArray(value)) return value.map(normalize);
  return value;
}
export async function read(sdk, address, functionName, args = []) {
  return normalize(
    await sdk.readContract({
      address,
      functionName,
      args,
      jsonSafeReturn: false,
      transactionHashVariant: "latest-final",
    }),
  );
}
export async function finalized(rpc, hash, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionByHash", [hash]);
    const status = receipt?.status;
    if (status && status !== lastStatus) {
      console.log(`  ${hash.slice(0, 12)}… ${status}`);
      lastStatus = status;
    }
    if (status === "CANCELED")
      throw Object.assign(new Error(`Transaction canceled: ${hash}`), {
        terminal: true,
      });
    if (status === "FINALIZED") {
      const leaders = receipt.consensus_data?.leader_receipt;
      const leader = Array.isArray(leaders) ? leaders[0] : leaders;
      const encodedResult =
        typeof leader?.result === "string"
          ? Buffer.from(leader.result, "base64")
          : null;
      const executionError =
        encodedResult?.[0] === 1
          ? encodedResult.subarray(1).toString("utf8")
          : "";
      if (leader?.execution_result !== "SUCCESS")
        throw Object.assign(
          new Error(
            `Contract execution failed: ${hash}\n${executionError || JSON.stringify(leader?.genvm_result || leader?.result || receipt)}`,
          ),
          { terminal: true },
        );
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Transaction still pending: ${hash}. Restart setup to resume polling.`,
  );
}
export function deploymentAddress(receipt) {
  const value = receipt.data?.contract_address || receipt.contract_address;
  if (typeof value !== "string" || !/^0x[\da-f]{40}$/i.test(value))
    throw new Error("Deployment receipt has no contract address.");
  return value;
}
export function updateEnv(text, entries) {
  const lines = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        !Object.keys(entries).some((key) =>
          new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line),
        ),
    );
  return (
    lines.join("\n").trimEnd() +
    "\n" +
    Object.entries(entries)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") +
    "\n"
  );
}
