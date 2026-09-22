import { createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import {
  TransactionHashVariant,
  transactionsStatusNumberToName,
  type Hash,
  type CalldataEncodable,
} from "genlayer-js/types";
import { address, auditFrom, normalize, type Decision } from "./model";
export const networks = { studionet, localnet, testnetBradbury };
export type Deployment = {
  network: keyof typeof networks;
  protocol: string;
  rpc: string;
};
export type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export const defaults: Deployment = {
  network: (process.env.NEXT_PUBLIC_GENLAYER_NETWORK ||
    "studionet") as Deployment["network"],
  protocol: process.env.NEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS || "",
  rpc: process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "",
};
export function validateDeployment(d: Deployment): Deployment {
  if (!(d.network in networks))
    throw new Error("Select a supported GenLayer network.");
  address(d.protocol);
  if (d.rpc) {
    const url = new URL(d.rpc);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Use an HTTP or HTTPS RPC URL without credentials.");
  }
  return d;
}
export function client(d: Deployment, account?: string, provider?: Provider) {
  const base = networks[d.network];
  if (!base) throw new Error("Select a supported GenLayer network.");
  const chain = {
    ...base,
    rpcUrls: {
      ...base.rpcUrls,
      default: {
        ...base.rpcUrls.default,
        http: [...base.rpcUrls.default.http],
      },
    },
  };
  return createClient({
    chain,
    ...(d.rpc ? { endpoint: d.rpc } : {}),
    ...(account ? { account: address(account) } : {}),
    ...(provider ? { provider } : {}),
  });
}
export async function read(
  d: Deployment,
  method: string,
  args: CalldataEncodable[] = [],
  target = d.protocol,
) {
  return normalize(
    await client(d).readContract({
      address: address(target),
      functionName: method,
      args,
      jsonSafeReturn: false,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  );
}
export async function list(d: Deployment, cursor = 0) {
  const result = (await read(d, "list_audits", [cursor, 20])) as {
    audits: unknown[];
    next_cursor: number;
    total: number;
    governor: string;
  };
  return {
    audits: result.audits.map(auditFrom),
    next_cursor: Number(result.next_cursor),
    total: Number(result.total),
    governor: result.governor,
  };
}
export const getAudit = async (d: Deployment, id: string) =>
  auditFrom(await read(d, "get_audit", [id]));
export async function getDecision(
  d: Deployment,
  governor: string,
  id: string,
  claim: string,
) {
  try {
    return (await read(
      d,
      "get_decision",
      [d.protocol, id, claim],
      governor,
    )) as Decision;
  } catch (error) {
    if (String(error).includes("Decision not found")) return null;
    throw error;
  }
}
export async function send(
  d: Deployment,
  account: string,
  method: string,
  args: CalldataEncodable[],
  value = 0n,
  target = d.protocol,
) {
  const provider = window.ethereum;
  if (!provider)
    throw new Error(
      "Install an Ethereum wallet extension to sign transactions.",
    );
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];
  if (accounts[0]?.toLowerCase() !== account.toLowerCase())
    throw new Error("The wallet account changed. Review the action again.");
  const chainId = await provider.request({ method: "eth_chainId" });
  if (Number(chainId) !== networks[d.network].id)
    throw new Error("Switch your wallet to the selected GenLayer network.");
  const rpc = d.rpc || networks[d.network].rpcUrls.default.http[0];
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
  });
  const remote = await response.json();
  if (Number(remote.result) !== networks[d.network].id)
    throw new Error("The RPC server does not match the selected network.");
  const hash: unknown = await client(d, account, provider).writeContract({
    address: address(target),
    functionName: method,
    args,
    value,
  });
  if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash))
    throw new Error(
      "The wallet returned no transaction hash. Inspect wallet activity before retrying.",
    );
  return hash as `0x${string}`;
}

export async function finalReceipt(d: Deployment, hash: `0x${string}`) {
  const reader = client(d);
  for (let attempt = 0; attempt < 25; attempt++) {
    const transaction = await reader.getTransaction({ hash: hash as Hash });
    const status =
      transaction.statusName ||
      transactionsStatusNumberToName[String(transaction.status) as keyof typeof transactionsStatusNumberToName] ||
      String(transaction.status);
    if (status === "FINALIZED" || status === "CANCELED")
      return { ...transaction, statusName: status };
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    "The transaction is still pending. Get its result again before submitting another action.",
  );
}
