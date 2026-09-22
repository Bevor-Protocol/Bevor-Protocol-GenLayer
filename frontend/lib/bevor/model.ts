export const TERM_KEYS = [
  "project",
  "chain",
  "deployment",
  "audited_commit",
  "scope",
  "exclusions",
  "report",
  "liability",
] as const;
export type Terms = Record<(typeof TERM_KEYS)[number], string>;
export type Audit = {
  audit_id: string;
  governor: string;
  client: string;
  auditor: string;
  amount: bigint;
  withdrawn: bigint;
  refunded: bigint;
  vested: bigint;
  withdrawable: bigint;
  duration_seconds: number;
  cliff_seconds: number;
  start: number;
  state: "proposed" | "active" | "disputed" | "terminated" | "cancelled";
  terms: Terms;
  project?: string;
  claim: null | { allegation: string; evidence_urls: string[] };
  response: null | { statement: string; evidence_urls: string[] };
  claim_id: string;
  claim_opened: number;
  response_deadline: number;
  claim_deadline: number;
  outcome: "" | "liable" | "not_liable" | "expired";
};
export type Decision = {
  hack_occurred: string;
  within_scope: string;
  auditor_liable: string;
  verdict: "liable" | "not_liable" | "inconclusive";
  rationale: string;
  citations: { url: string; quote: string }[];
  evidence_hashes: { url: string; sha256: string; error: string }[];
  decided_at: number;
};
export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export function address(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value))
    throw new Error("Enter a nonzero address with 40 hexadecimal characters.");
  return value as `0x${string}`;
}
export function parseAmount(input: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(input))
    throw new Error("Enter a GEN amount with at most 18 decimal places.");
  const [whole, fraction = ""] = input.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (amount <= 0n) throw new Error("The payment must be greater than zero.");
  return amount;
}
export function money(value: bigint, digits = 6): string {
  const unit = 10n ** 18n;
  const fraction = (value % unit)
    .toString()
    .padStart(18, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  if (value > 0n && value < unit / 10n ** BigInt(digits))
    return `<0.${"0".repeat(digits - 1)}1`;
  return `${(value / unit).toLocaleString("en-US")}${fraction ? "." + fraction : ""}`;
}
export const exactMoney = (value: bigint) => money(value, 18);
export const percent = (part: bigint, total: bigint) =>
  total > 0n ? Number((part * 10000n) / total) / 100 : 0;
export const short = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-4)}`;
export const date = (seconds: number) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "Not started";
export function vestedAt(a: Audit, now: number): bigint {
  if (!a.start || a.state === "proposed" || a.state === "cancelled") return 0n;
  const stop =
    a.state === "disputed" || a.state === "terminated"
      ? Math.min(now, a.claim_opened)
      : now;
  const elapsed = Math.max(
    0,
    Math.min(a.duration_seconds, Math.floor(stop - a.start)),
  );
  return elapsed < a.cliff_seconds
    ? 0n
    : (a.amount * BigInt(elapsed)) / BigInt(a.duration_seconds);
}
export function actions(a: Audit, account: string | null, now: number) {
  const client = sameAddress(account, a.client),
    auditor = sameAddress(account, a.auditor);
  return {
    accept: auditor && a.state === "proposed",
    cancel: client && a.state === "proposed",
    withdraw:
      auditor &&
      ["active", "terminated"].includes(a.state) &&
      a.withdrawable > 0n,
    claim:
      client &&
      a.state === "active" &&
      !a.claim_id &&
      now < a.start + a.duration_seconds,
    respond:
      auditor &&
      a.state === "disputed" &&
      !a.response &&
      now < a.response_deadline,
    adjudicate:
      !!account &&
      a.state === "disputed" &&
      now >= a.response_deadline &&
      now < a.claim_deadline,
    expire: !!account && a.state === "disputed" && now >= a.claim_deadline,
  };
}
export function evidence(input: string, required: boolean): string[] {
  const urls = input
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length > 5 || (required && !urls.length))
    throw new Error(
      "Provide one to five evidence URLs for a claim, or up to five for a response.",
    );
  if (new Set(urls).size !== urls.length)
    throw new Error("Each evidence URL must be unique.");
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Enter a complete HTTPS evidence URL.");
    }
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      url.length > 2048
    )
      throw new Error(
        "Use HTTPS URLs without credentials or fragments, at most 2,048 characters each.",
      );
  }
  return urls;
}
export function normalize(value: unknown): unknown {
  if (value instanceof Map)
    return Object.fromEntries(
      [...value].map(([k, v]) => [String(k), normalize(v)]),
    );
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
export function auditFrom(value: unknown): Audit {
  const a = normalize(value) as Record<string, unknown>;
  if (
    !a ||
    !["proposed", "active", "disputed", "terminated", "cancelled"].includes(
      String(a.state),
    )
  )
    throw new Error("The deployment returned an invalid agreement.");
  for (const key of [
    "amount",
    "withdrawn",
    "refunded",
    "vested",
    "withdrawable",
  ]) {
    if (typeof a[key] === "number" && !Number.isSafeInteger(a[key]))
      throw new Error("The server returned an imprecise payment amount.");
    a[key] = BigInt(a[key] as string | bigint | number);
  }
  for (const key of [
    "duration_seconds",
    "cliff_seconds",
    "start",
    "claim_opened",
    "response_deadline",
    "claim_deadline",
  ])
    a[key] = Number(a[key]);
  a.audit_id = String(a.audit_id);
  return a as unknown as Audit;
}
export function execution(receipt: unknown): "success" | "failed" | "unknown" {
  const r = receipt as {
    statusName?: string;
    txExecutionResultName?: string;
    txExecutionResult?: number;
    consensus_data?: { leader_receipt?: { execution_result?: string }[] };
  };
  if (r.statusName === "CANCELED") return "failed";
  const studio = r.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (
    r.txExecutionResultName === "FINISHED_WITH_ERROR" ||
    r.txExecutionResult === 2 ||
    (studio && studio !== "SUCCESS")
  )
    return "failed";
  if (
    r.txExecutionResultName === "FINISHED_WITH_RETURN" ||
    r.txExecutionResult === 1 ||
    studio === "SUCCESS"
  )
    return "success";
  return "unknown";
}

export function durationLabel(seconds: number): string {
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ] as const) {
    if (seconds % size === 0) {
      const value = seconds / size;
      return `${value} ${unit}${value === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}
