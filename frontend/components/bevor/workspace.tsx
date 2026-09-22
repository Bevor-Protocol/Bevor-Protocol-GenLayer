"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  Plus,
  Settings2,
  X,
  RefreshCw,
  ArrowLeft,
  Wallet,
  ChevronRight,
} from "lucide-react";
import type { CalldataEncodable } from "genlayer-js/types";
import {
  finalReceipt,
  defaults,
  getAudit,
  getDecision,
  list,
  networks,
  send,
  validateDeployment,
  type Deployment,
} from "@/lib/bevor/client";
import {
  actions,
  address,
  date,
  durationLabel,
  evidence,
  exactMoney,
  execution,
  money,
  parseAmount,
  percent,
  sameAddress,
  short,
  TERM_KEYS,
  vestedAt,
  type Audit,
  type Decision,
  type Terms,
} from "@/lib/bevor/model";

type Action = {
  title: string;
  detail: string;
  method: string;
  args: CalldataEncodable[];
  value?: bigint;
  target?: string;
};
type Pending = { hash: `0x${string}`; title: string; deployment: Deployment };
const labels: Record<string, string> = {
  project: "Project name",
  chain: "Client chain",
  deployment: "Audited deployment",
  audited_commit: "Audited commit",
  scope: "Audit scope",
  exclusions: "Scope exclusions",
  report: "Audit report",
  liability: "Liability terms",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function Modal({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="icon close" aria-label="Close dialog">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Field({
  label,
  name,
  multiline = false,
  ...props
}: {
  label: string;
  name: string;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  maxLength?: number;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea name={name} rows={3} {...props} />
      ) : (
        <input name={name} {...props} />
      )}
    </label>
  );
}
function Links({ urls }: { urls: string[] }) {
  return (
    <div className="sources">
      {urls.map((url) => (
        <a
          key={url}
          href={url.startsWith("https://") ? url : undefined}
          target="_blank"
          rel="noreferrer"
        >
          {url}
          <ArrowUpRight size={14} />
        </a>
      ))}
    </div>
  );
}
function State({ audit }: { audit: Audit }) {
  return (
    <span className={`state ${audit.state}`}>
      {audit.state === "active" && audit.vested === audit.amount
        ? "Fully vested"
        : audit.state === "proposed"
          ? "Awaiting acceptance"
          : audit.state}
    </span>
  );
}

export default function Workspace({
  initialDeployment,
  initialAudit = "",
  readOnlyDemo = false,
}: {
  initialDeployment?: Deployment;
  initialAudit?: string;
  readOnlyDemo?: boolean;
} = {}) {
  const cache = useQueryClient();
  const [deployment, setDeployment] = useState<Deployment>(
    initialDeployment || defaults,
  );
  const [scheduleUnit, setScheduleUnit] = useState("days");
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState(0);
  const [selected, setSelected] = useState(initialAudit);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState(readOnlyDemo ? "claim" : "vesting");
  const [modal, setModal] = useState<
    "" | "deployment" | "create" | "claim" | "response"
  >("");
  const [review, setReview] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    try {
      const stored =
        initialDeployment || process.env.NEXT_PUBLIC_BEVOR_LOCAL_MODE === "1"
          ? null
          : localStorage.getItem("bevor.deployment");
      if (stored) setDeployment(validateDeployment(JSON.parse(stored)));
      const transaction = readOnlyDemo
        ? null
        : localStorage.getItem("bevor.pending");
      if (transaction) setPending(JSON.parse(transaction));
    } catch {
      setError("Saved configuration is invalid. Set the deployment again.");
    }
    setReady(true);
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (readOnlyDemo) return;
    const provider = window.ethereum;
    if (!provider) return;
    let active = true;
    const sync = async () => {
      try {
        const [accounts, chain] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (active) {
          setAccount(
            localStorage.getItem("bevor.disconnected")
              ? null
              : (accounts as string[])[0] || null,
          );
          setChainId(Number(chain));
        }
      } catch {
        if (active) setAccount(null);
      }
    };
    const disconnected = () => setAccount(null);
    void sync();
    provider.on?.("accountsChanged", sync);
    provider.on?.("chainChanged", sync);
    provider.on?.("disconnect", disconnected);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", sync);
      provider.removeListener?.("chainChanged", sync);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, []);
  useEffect(() => {
    setReview(null);
    setModal("");
  }, [account, chainId, deployment]);
  const configured =
    ready &&
    /^0x[\da-f]{40}$/i.test(deployment.protocol) &&
    !!networks[deployment.network];
  const query = useQuery({
    queryKey: ["audits", deployment, cursor],
    queryFn: () => list(deployment, cursor),
    enabled: configured,
    refetchInterval: 30000,
  });
  const detail = useQuery({
    queryKey: ["audit", deployment, selected],
    queryFn: () => getAudit(deployment, selected),
    enabled: configured && !!selected,
    refetchInterval: 15000,
  });
  const audit = detail.data;
  const decision = useQuery({
    queryKey: [
      "decision",
      deployment,
      audit?.governor,
      selected,
      audit?.claim_id,
    ],
    queryFn: () =>
      getDecision(deployment, audit!.governor, selected, audit!.claim_id),
    enabled: configured && !!audit?.claim_id,
    refetchInterval: 30000,
  });
  const correctChain =
    !!networks[deployment.network] &&
    chainId === networks[deployment.network].id;
  const canWrite =
    !readOnlyDemo &&
    configured &&
    !!account &&
    correctChain &&
    !busy &&
    !pending;
  const available = audit ? actions(audit, account, now) : null;
  const open = (value: typeof modal) => {
    setFormError("");
    setModal(value);
  };
  async function connect() {
    setError("");
    try {
      const provider = window.ethereum;
      if (!provider)
        throw new Error("Install an Ethereum wallet extension to connect.");
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      localStorage.removeItem("bevor.disconnected");
      setAccount(accounts[0] || null);
      const chain = networks[deployment.network];
      const id = `0x${chain.id.toString(16)}`;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: id }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: id,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [deployment.rpc || chain.rpcUrls.default.http[0]],
            },
          ],
        });
      }
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function monitor(transaction: Pending) {
    setBusy(true);
    setError("");
    setNotice("Transaction submitted. Waiting for finalization.");
    try {
      const receipt = await finalReceipt(
        transaction.deployment,
        transaction.hash,
      );
      const result = execution(receipt);
      if (result === "unknown") {
        setNotice(
          "The transaction finalized, but its execution result is unavailable. Inspect the transaction and refresh before submitting again.",
        );
        return;
      }
      localStorage.removeItem("bevor.pending");
      setPending(null);
      if (result === "failed") {
        setError(
          `${transaction.title} failed during execution or was canceled. The contract did not complete this action.`,
        );
        setNotice("");
        return;
      }
      setNotice(
        `${transaction.title} finalized. Refreshing contract state. Governor settlement and payments can arrive in later transactions.`,
      );
      await cache.invalidateQueries();
    } catch (e) {
      setError(errorText(e));
      setNotice(
        "The transaction hash remains available until its execution result is known.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!review || !account || !canWrite) return;
    const action = review;
    setBusy(true);
    setError("");
    setReview(null);
    setNotice("Approve the transaction in your wallet.");
    try {
      const hash = await send(
        deployment,
        account,
        action.method,
        action.args,
        action.value,
        action.target,
      );
      const transaction = { hash, title: action.title, deployment };
      setPending(transaction);
      localStorage.setItem("bevor.pending", JSON.stringify(transaction));
      await monitor(transaction);
    } catch (e) {
      setError(errorText(e));
      setNotice("");
    } finally {
      setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      const data = new FormData(event.currentTarget);
      const auditor = address(String(data.get("auditor")).trim());
      if (sameAddress(account, auditor))
        throw new Error("The client and auditor must use different wallets.");
      const amount = parseAmount(String(data.get("amount")).trim());
      const unit = data.get("schedule_unit") === "minutes" ? 60 : 86400;
      const duration = Number(data.get("duration")) * unit,
        cliff = Number(data.get("cliff")) * unit;
      if (
        !Number.isSafeInteger(duration) ||
        duration < 1 ||
        duration > 315360000 ||
        !Number.isSafeInteger(cliff) ||
        cliff < 0 ||
        cliff > duration
      )
        throw new Error(
          "Enter a duration up to 3,650 days and a cliff within that duration.",
        );
      const terms = Object.fromEntries(
        TERM_KEYS.map((key) => [key, String(data.get(key) || "").trim()]),
      ) as Terms;
      if (
        TERM_KEYS.some(
          (key) => !terms[key] || [...terms[key]].length > 20000,
        ) ||
        [...JSON.stringify(terms)].length > 48000
      )
        throw new Error(
          "Complete every term. Keep each term below 20,000 characters and all terms below 48,000 characters.",
        );
      setReview({
        title: "Fund agreement",
        detail: `Deposit ${exactMoney(amount)} GEN for ${terms.project}. Auditor: ${auditor}. Duration: ${durationLabel(duration)}. Cliff: ${durationLabel(cliff)}. Vesting starts when the auditor accepts. Terms are immutable. Network fees are additional.\n\n${TERM_KEYS.map((key) => `${labels[key]}: ${terms[key]}`).join("\n\n")}`,
        method: "create_audit",
        args: [auditor, duration, cliff, JSON.stringify(terms)],
        value: amount,
      });
      setModal("");
    } catch (e) {
      setFormError(errorText(e));
    }
  }
  function submitStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!audit) return;
    try {
      const data = new FormData(event.currentTarget),
        statement = String(data.get("statement") || "").trim();
      if (!statement || [...statement].length > 12000)
        throw new Error("Enter a statement with at most 12,000 characters.");
      const isClaim = modal === "claim",
        urls = evidence(String(data.get("urls") || ""), isClaim);
      setReview({
        title: isClaim ? "Submit claim" : "Submit response",
        detail: `${isClaim ? "This freezes vesting and opens a 24-hour response window. Only one claim is allowed per agreement." : "You can submit only one response. It cannot be edited."} Your statement and evidence become public.\n\n${statement}\n\n${urls.join("\n")}`,
        method: isClaim ? "open_claim" : "submit_response",
        args: [audit.audit_id, statement, urls],
      });
      setModal("");
    } catch (e) {
      setFormError(errorText(e));
    }
  }
  const select = (id: string) => {
    setSelected(id);
    setTab("vesting");
  };
  const rows = (query.data?.audits || []).filter(
    (a) =>
      filter === "all" ||
      (filter === "mine"
        ? sameAddress(account, a.client) || sameAddress(account, a.auditor)
        : a.state === filter),
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bevor home">
          <img
            className="brand-logo"
            src="/bevor-logo.png"
            alt=""
            width={44}
            height={44}
          />
          bevor
          <span className="brand-sub">PROTOCOL</span>
        </a>
        <div className="header-actions">
          <button
            className="network-button"
            disabled={readOnlyDemo || busy || !!pending}
            onClick={() => open("deployment")}
          >
            <span className={`connection-dot ${configured ? "online" : ""}`} />
            {networks[deployment.network]?.name || "Set network"}
            <Settings2 size={14} />
          </button>
          <button
            className="wallet-button"
            disabled={readOnlyDemo}
            onClick={() =>
              account && correctChain
                ? (localStorage.setItem("bevor.disconnected", "1"),
                  setAccount(null))
                : void connect()
            }
          >
            <Wallet size={16} />
            {readOnlyDemo
              ? "Read-only demo"
              : account
                ? correctChain
                  ? `${short(account)} · Disconnect`
                  : "Switch network"
                : "Connect wallet"}
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {readOnlyDemo
                ? "LOCAL DEMO / REAL GENLAYER INFERENCE"
                : "AUDIT PAYMENTS / WORKSPACE"}
            </p>
            <h1>{readOnlyDemo ? "Governance replay" : "Agreements"}</h1>
            <p className="muted">
              Track vesting. Exchange evidence. Resolve liability.
            </p>
          </div>
          <button
            className="primary"
            disabled={!canWrite}
            onClick={() => open("create")}
          >
            <Plus size={17} />
            New agreement
          </button>
        </div>
        {!configured && ready && (
          <div className="setup">
            <div>
              <h2>Connect a Bevor deployment</h2>
              <p>
                Set the protocol address to load agreements. Payments use native
                GEN.
              </p>
            </div>
            <button className="secondary" onClick={() => open("deployment")}>
              Set deployment
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
        {readOnlyDemo && (
          <p className="hint">
            Historical Euler exploit with hypothetical audit terms and local
            GEN. Acceptance is backdated to March 1, 2023; the response window
            is one minute. Both wallets are operated by the demo script. The
            governor fetches public evidence and validators run real inference.
            Select Vesting to inspect settlement. This is not a finding against
            any real auditing firm.
          </p>
        )}
        {configured && !account && !readOnlyDemo && (
          <p className="hint">
            You are viewing public agreements. Connect a wallet to fund an
            agreement or take part.
          </p>
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
            <button
              className="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {pending && (
          <div className="transaction">
            <span>
              {pending.title} · {pending.deployment.network}
              <code>{pending.hash}</code>
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void monitor(pending)}
            >
              {busy ? "Waiting…" : "Get transaction result"}
            </button>
          </div>
        )}
        <div className={`workspace ${selected ? "has-selection" : ""}`}>
          <aside className="register">
            <div className="register-heading">
              <h2>
                All agreements <span>{query.data?.total ?? "—"}</span>
              </h2>
              <button
                className="icon"
                disabled={!configured || query.isFetching}
                aria-label="Refresh agreements"
                onClick={() => void cache.invalidateQueries()}
              >
                <RefreshCw
                  size={15}
                  className={query.isFetching ? "spinning" : ""}
                />
              </button>
            </div>
            <div className="filters" aria-label="Filter agreements">
              {["all", "mine", "active", "disputed"].map((f) => (
                <button
                  key={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "mine" ? "My agreements" : f}
                </button>
              ))}
            </div>
            <form
              className="id-search"
              onSubmit={(e) => {
                e.preventDefault();
                const id = String(
                  new FormData(e.currentTarget).get("id") || "",
                ).trim();
                if (/^[1-9]\d*$/.test(id)) select(id);
              }}
            >
              <input
                name="id"
                aria-label="Find agreement by ID"
                placeholder="Go to agreement ID"
                pattern="[1-9][0-9]*"
                required
              />
              <button
                className="icon"
                aria-label="Find agreement"
                disabled={!configured}
              >
                <ArrowUpRight size={16} />
              </button>
            </form>
            {query.isError ? (
              <div className="empty small">
                <h3>Agreements unavailable</h3>
                <p>{errorText(query.error)}</p>
                <p>Use a protocol deployment that includes list_audits.</p>
                <button
                  className="text-button"
                  onClick={() => void query.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : query.isLoading ? (
              <p className="empty small" role="status">
                Loading agreements…
              </p>
            ) : rows.length ? (
              <div className="agreement-list">
                {rows.map((a) => (
                  <button
                    key={a.audit_id}
                    className={`agreement-row ${selected === a.audit_id ? "selected" : ""}`}
                    onClick={() => select(a.audit_id)}
                  >
                    <div className="row-meta">
                      <span>#{a.audit_id.padStart(3, "0")}</span>
                      <State audit={a} />
                    </div>
                    <h3>{a.project}</h3>
                    <div className="row-bottom">
                      <span>
                        {money(a.amount)} <small>GEN</small>
                      </span>
                      <ChevronRight size={17} />
                    </div>
                    <div className="mini-progress">
                      <span
                        style={{ width: `${percent(a.vested, a.amount)}%` }}
                      />
                    </div>
                    <p>
                      {percent(a.vested, a.amount).toFixed(1)}% vested ·{" "}
                      {sameAddress(account, a.client)
                        ? "You are the client"
                        : sameAddress(account, a.auditor)
                          ? "You are the auditor"
                          : short(a.auditor)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty small">
                <span className="empty-number">01</span>
                <h3>
                  {configured
                    ? "No agreements on this page"
                    : "Your agreements live here"}
                </h3>
                <p>
                  {configured
                    ? "Change the filter or create an agreement."
                    : "Fund an audit, agree on the terms, and follow each payment as it vests."}
                </p>
              </div>
            )}
            {!!query.data?.total && (
              <div className="pagination">
                <span>Filters apply to this page</span>
                {cursor > 0 && (
                  <button onClick={() => setCursor(0)}>Newest</button>
                )}
                {!!query.data.next_cursor && (
                  <button onClick={() => setCursor(query.data!.next_cursor)}>
                    Older →
                  </button>
                )}
              </div>
            )}
          </aside>
          <section className="inspector" aria-label="Agreement details">
            <button
              className="back text-button"
              onClick={() => setSelected("")}
            >
              <ArrowLeft size={16} />
              All agreements
            </button>
            {!selected ? (
              <div className="empty detail-empty">
                <div className="empty-diagram" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p className="eyebrow">PAYMENTS WITH ACCOUNTABILITY</p>
                <h2>
                  Every audit.
                  <br />
                  Every vested payment.
                </h2>
                <p>
                  Select an agreement to view its schedule,
                  <br />
                  payment history, and claim record.
                </p>
                <div className="steps">
                  <span>01 Fund</span>
                  <span>02 Vest</span>
                  <span>03 Resolve</span>
                </div>
              </div>
            ) : detail.isError ? (
              <div className="empty">
                <h2>Agreement unavailable</h2>
                <p>{errorText(detail.error)}</p>
                <button
                  className="secondary"
                  onClick={() => void detail.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : !audit ? (
              <div className="empty" role="status">
                Loading agreement…
              </div>
            ) : (
              <>
                <div className="detail-heading">
                  <div className="detail-meta">
                    <span>AGREEMENT #{audit.audit_id.padStart(3, "0")}</span>
                    <State audit={audit} />
                  </div>
                  <h2>{audit.terms.project}</h2>
                  <div className="parties">
                    <span title={audit.client}>
                      Client <code>{short(audit.client)}</code>
                      {sameAddress(account, audit.client) && " (you)"}
                    </span>
                    <span title={audit.auditor}>
                      Auditor <code>{short(audit.auditor)}</code>
                      {sameAddress(account, audit.auditor) && " (you)"}
                    </span>
                  </div>
                </div>
                <nav className="tabs" aria-label="Agreement sections">
                  {["vesting", "claim", "terms"].map((t) => (
                    <button
                      key={t}
                      aria-current={tab === t ? "page" : undefined}
                      onClick={() => setTab(t)}
                    >
                      {t === "claim"
                        ? "Claim & response"
                        : t === "terms"
                          ? "Audit terms"
                          : "Vesting"}
                      {t === "claim" && audit.claim && (
                        <span className="tab-dot" />
                      )}
                    </button>
                  ))}
                </nav>
                <div className="detail-body" key={`${selected}-${tab}`}>
                  {tab === "vesting" && <Vesting audit={audit} now={now} />}
                  {tab === "terms" && (
                    <>
                      <p className="muted">
                        Both parties accept these fixed terms. The governor uses
                        them to assess liability.
                      </p>
                      <dl className="terms">
                        {TERM_KEYS.map((key) => (
                          <div key={key}>
                            <dt>{labels[key]}</dt>
                            <dd>{audit.terms[key]}</dd>
                          </div>
                        ))}
                        <div>
                          <dt>Client wallet</dt>
                          <dd>
                            <code>{audit.client}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Auditor wallet</dt>
                          <dd>
                            <code>{audit.auditor}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Governor</dt>
                          <dd>
                            <code>{audit.governor}</code>
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {tab === "claim" && (
                    <Claim
                      audit={audit}
                      decision={decision.data}
                      decisionError={
                        decision.isError ? errorText(decision.error) : ""
                      }
                      now={now}
                    />
                  )}
                  <div className="action-area">
                    {audit.state === "proposed" && (
                      <p>
                        The auditor must accept these terms before vesting
                        starts.
                      </p>
                    )}
                    {audit.state === "disputed" && (
                      <p>
                        Vesting and withdrawals are paused while this claim is
                        open.
                      </p>
                    )}
                    {audit.state === "terminated" && (
                      <p>
                        Vesting ended at the claim time. The auditor can
                        withdraw the remaining vested amount.
                      </p>
                    )}
                    <div className="action-buttons">
                      {available?.accept && (
                        <button
                          className="primary"
                          disabled={!canWrite}
                          onClick={() =>
                            setReview({
                              title: "Accept agreement",
                              detail: `Accept the fixed terms for ${audit.terms.project} and start vesting ${exactMoney(audit.amount)} GEN over ${durationLabel(audit.duration_seconds)}. Read the Audit terms tab before signing.`,
                              method: "accept_audit",
                              args: [audit.audit_id],
                            })
                          }
                        >
                          Accept & start vesting
                        </button>
                      )}
                      {available?.cancel && (
                        <button
                          className="secondary"
                          disabled={!canWrite}
                          onClick={() =>
                            setReview({
                              title: "Cancel agreement",
                              detail: `Cancel this unaccepted agreement and request the return of ${exactMoney(audit.amount)} GEN to the client.`,
                              method: "cancel_audit",
                              args: [audit.audit_id],
                            })
                          }
                        >
                          Cancel & return funds
                        </button>
                      )}
                      {available?.withdraw && (
                        <button
                          className="primary"
                          disabled={!canWrite || detail.isError}
                          onClick={() =>
                            setReview({
                              title: "Withdraw vested payment",
                              detail: `${exactMoney(audit.withdrawable)} GEN is available at the last refresh. The contract calculates the final amount when it executes.`,
                              method: "withdraw",
                              args: [audit.audit_id],
                            })
                          }
                        >
                          Withdraw {money(audit.withdrawable)} GEN
                        </button>
                      )}
                      {available?.claim && (
                        <button
                          className="secondary"
                          disabled={!canWrite}
                          onClick={() => open("claim")}
                        >
                          Open a claim
                        </button>
                      )}
                      {available?.respond && (
                        <button
                          className="primary"
                          disabled={!canWrite}
                          onClick={() => open("response")}
                        >
                          Submit auditor response
                        </button>
                      )}
                      {available?.adjudicate && (
                        <button
                          className="primary"
                          disabled={!canWrite}
                          onClick={() =>
                            setReview({
                              title: "Request governor decision",
                              detail:
                                "The governor assesses the hack, audit scope, and auditor liability from both statements and their evidence. A conclusive decision queues settlement. An inconclusive decision keeps the claim open.",
                              method: "adjudicate",
                              target: audit.governor,
                              args: [deployment.protocol, audit.audit_id],
                            })
                          }
                        >
                          {decision.data &&
                          decision.data.verdict !== "inconclusive"
                            ? "Resend settlement"
                            : decision.data
                              ? "Retry governor review"
                              : "Request governor review"}
                        </button>
                      )}
                      {available?.expire && (
                        <button
                          className="primary"
                          disabled={!canWrite}
                          onClick={() =>
                            setReview({
                              title: "Close expired claim",
                              detail:
                                "The seven-day decision window ended. Close this claim and resume the original vesting schedule. No second claim is allowed.",
                              method: "expire_claim",
                              args: [audit.audit_id],
                            })
                          }
                        >
                          Close expired claim
                        </button>
                      )}
                    </div>
                    {!account && !readOnlyDemo && (
                      <p className="muted">
                        Connect your wallet to see the actions available to you.
                      </p>
                    )}
                  </div>
                </div>
                <footer className="detail-footer">
                  Finalized contract state · Updated{" "}
                  {detail.dataUpdatedAt
                    ? new Date(detail.dataUpdatedAt).toLocaleTimeString()
                    : "—"}
                  <button
                    className="text-button"
                    disabled={detail.isFetching}
                    onClick={() => void cache.invalidateQueries()}
                  >
                    Refresh
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
        <footer className="page-footer">
          <span>BEVOR / GENLAYER</span>
          <span>Native GEN payments · All times UTC</span>
        </footer>
      </main>
      {modal === "deployment" && (
        <Modal
          title="Deployment"
          description="Use the address of a deployed Bevor Protocol contract."
          close={() => setModal("")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const data = new FormData(e.currentTarget);
                const d = validateDeployment({
                  network: String(data.get("network")) as Deployment["network"],
                  protocol: String(data.get("protocol")).trim(),
                  rpc: String(data.get("rpc")).trim(),
                });
                localStorage.setItem("bevor.deployment", JSON.stringify(d));
                setDeployment(d);
                setSelected("");
                setCursor(0);
                setModal("");
              } catch (e) {
                setFormError(errorText(e));
              }
            }}
          >
            <label className="field">
              <span>Network</span>
              <select name="network" defaultValue={deployment.network}>
                {Object.entries(networks).map(([key, chain]) => (
                  <option key={key} value={key}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Protocol address"
              name="protocol"
              required
              defaultValue={deployment.protocol}
              placeholder="0x…"
            />
            <Field
              label="Custom RPC URL (optional)"
              name="rpc"
              defaultValue={deployment.rpc}
              placeholder="Use the network default"
            />
            <p className="muted">
              The protocol supplies its governor address. This configuration
              stays in this browser.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary">Load agreements</button>
          </form>
        </Modal>
      )}
      {modal === "create" && (
        <Modal
          title="New agreement"
          description="Fund the full payment in GEN. The auditor accepts before vesting starts."
          close={() => setModal("")}
        >
          <form onSubmit={create}>
            <Field
              label="Auditor wallet"
              name="auditor"
              required
              placeholder="0x…"
            />
            <label className="field">
              <span>Schedule unit</span>
              <select
                name="schedule_unit"
                value={scheduleUnit}
                onChange={(event) => setScheduleUnit(event.target.value)}
              >
                <option value="days">Days</option>
                <option value="minutes">Minutes</option>
              </select>
            </label>
            <div className="form-grid">
              <Field
                label="Payment (GEN)"
                name="amount"
                required
                placeholder="1.0"
              />
              <Field
                label={`Duration (${scheduleUnit})`}
                key={scheduleUnit}
                name="duration"
                type="number"
                min="1"
                max={scheduleUnit === "days" ? "3650" : "5256000"}
                step="1"
                defaultValue={scheduleUnit === "days" ? "180" : "5"}
                required
              />
              <Field
                label={`Cliff (${scheduleUnit})`}
                name="cliff"
                type="number"
                min="0"
                max={scheduleUnit === "days" ? "3650" : "5256000"}
                step="1"
                defaultValue="0"
                required
              />
            </div>
            <p className="muted">
              The cliff delays the first withdrawal. Once it passes, all value
              vested since acceptance becomes available.
            </p>
            {TERM_KEYS.map((key) => (
              <Field
                key={key}
                label={labels[key]}
                name={key}
                required
                multiline={
                  ![
                    "project",
                    "chain",
                    "deployment",
                    "audited_commit",
                  ].includes(key)
                }
                maxLength={20000}
              />
            ))}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary" disabled={!canWrite}>
              Review agreement
              <ArrowUpRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {(modal === "claim" || modal === "response") && (
        <Modal
          title={modal === "claim" ? "Open a claim" : "Auditor response"}
          description={
            modal === "claim"
              ? "Explain the hack and its connection to the audit scope. Vesting pauses when the claim opens."
              : "Respond to the client claim within 24 hours of its opening."
          }
          close={() => setModal("")}
        >
          <form onSubmit={submitStatement}>
            <Field
              label={modal === "claim" ? "Allegation" : "Response"}
              name="statement"
              multiline
              required
              maxLength={12000}
            />
            <Field
              label={`Evidence URLs, one per line (${modal === "claim" ? "1–5 required" : "up to 5, optional"})`}
              name="urls"
              multiline
              required={modal === "claim"}
              placeholder="https://…"
            />
            <p className="muted">
              Use public, readable sources. Statements and evidence become
              public and cannot be edited.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary" disabled={!canWrite}>
              Review submission
            </button>
          </form>
        </Modal>
      )}
      {review && (
        <Modal
          title={review.title}
          description="Review the action before signing in your wallet."
          close={() => setReview(null)}
        >
          <div className="review-details">{review.detail}</div>
          <dl className="review-target">
            <dt>Network</dt>
            <dd>{networks[deployment.network].name}</dd>
            <dt>Contract</dt>
            <dd>
              <code>{review.target || deployment.protocol}</code>
            </dd>
            <dt>Signing wallet</dt>
            <dd>
              <code>{account}</code>
            </dd>
          </dl>
          <button
            className="primary"
            disabled={!canWrite}
            onClick={() => void execute()}
          >
            Confirm in wallet
            <ArrowUpRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}

function Vesting({ audit: a, now }: { audit: Audit; now: number }) {
  const vested = vestedAt(a, now),
    remaining = a.amount - vested - a.refunded;
  const progress = percent(vested, a.amount),
    cliff = (a.cliff_seconds / a.duration_seconds) * 100;
  const active = a.state === "active";
  return (
    <>
      <div className="balance">
        <p className="eyebrow">TOTAL AUDIT PAYMENT</p>
        <h3 title={`${exactMoney(a.amount)} GEN`}>
          {money(a.amount)} <span>GEN</span>
        </h3>
        <span className="muted">
          {durationLabel(a.duration_seconds)} schedule
          {a.cliff_seconds > 0 && ` · ${durationLabel(a.cliff_seconds)} cliff`}
        </span>
      </div>
      <div className="vesting-chart">
        <div className="chart-caption">
          <span>
            {progress.toFixed(2)}% vested{active ? " · live estimate" : ""}
          </span>
          <span>
            {a.state === "disputed"
              ? "Paused at claim"
              : a.state === "terminated"
                ? "Ended at claim"
                : a.state === "cancelled"
                  ? "Cancelled"
                  : a.start
                    ? "Linear vesting"
                    : "Starts on acceptance"}
          </span>
        </div>
        <div
          className="vesting-track"
          role="progressbar"
          aria-label="Payment vested"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="vesting-fill" style={{ width: `${progress}%` }} />
          {cliff > 0 && (
            <span
              className="cliff-marker"
              style={{ left: `${cliff}%` }}
              title={`Cliff: ${durationLabel(a.cliff_seconds)}`}
            />
          )}
        </div>
        <div className="schedule">
          <div>
            <span>START</span>
            <p>{date(a.start)}</p>
          </div>
          <div>
            <span>
              {a.state === "terminated" ? "STOPPED" : "SCHEDULED END"}
            </span>
            <p>
              {date(
                a.start
                  ? a.state === "terminated"
                    ? a.claim_opened
                    : a.start + a.duration_seconds
                  : 0,
              )}
            </p>
          </div>
        </div>
      </div>
      <dl className="amounts">
        <div>
          <dt>Vested{active ? " (estimate)" : ""}</dt>
          <dd title={exactMoney(vested)}>
            {money(vested)} <span>GEN</span>
          </dd>
        </div>
        <div>
          <dt>Unvested in escrow</dt>
          <dd title={exactMoney(remaining > 0n ? remaining : 0n)}>
            {money(remaining > 0n ? remaining : 0n)} <span>GEN</span>
          </dd>
        </div>
        <div>
          <dt>Withdrawals recorded</dt>
          <dd title={exactMoney(a.withdrawn)}>
            {money(a.withdrawn)} <span>GEN</span>
          </dd>
        </div>
        <div>
          <dt>Refunds recorded</dt>
          <dd title={exactMoney(a.refunded)}>
            {money(a.refunded)} <span>GEN</span>
          </dd>
        </div>
      </dl>
      <div className="withdrawable">
        <span>Available to withdraw at last refresh</span>
        <strong>{money(a.withdrawable)} GEN</strong>
      </div>
      <p className="fine-print">
        Recorded transfers can settle in later transactions. Inspect the
        recipient wallet for delivery.{" "}
        {a.cliff_seconds > 0 &&
          `Cliff date: ${a.start ? date(a.start + a.cliff_seconds) : "set on acceptance"}.`}
      </p>
    </>
  );
}
function Claim({
  audit: a,
  decision,
  decisionError,
  now,
}: {
  audit: Audit;
  decision?: Decision | null;
  decisionError: string;
  now: number;
}) {
  if (!a.claim)
    return (
      <div className="no-claim">
        <p className="eyebrow">CLAIM RECORD</p>
        <h3>No claim submitted</h3>
        <p>
          The client can open one claim before vesting ends. The auditor gets 24
          hours to respond. The governor then assesses liability.
        </p>
      </div>
    );
  return (
    <>
      <div className="claim-status">
        <h3>
          {a.outcome === "liable"
            ? "Auditor liable · vesting ended"
            : a.outcome === "not_liable"
              ? "Auditor not liable · vesting resumed"
              : a.outcome === "expired"
                ? "Claim expired · vesting resumed"
                : now < a.response_deadline
                  ? "Waiting for the auditor response"
                  : now >= a.claim_deadline
                    ? "Decision window expired"
                    : decision && decision.verdict !== "inconclusive"
                      ? "Decision recorded · settlement pending"
                      : "Ready for governor review"}
        </h3>
        <p>
          Response due {date(a.response_deadline)}
          <br />
          Decision due {date(a.claim_deadline)}
        </p>
      </div>
      <div className="timeline">
        <article>
          <span className="timeline-dot" />
          <div className="timeline-label">
            CLIENT CLAIM <time>{date(a.claim_opened)}</time>
          </div>
          <p className="statement">{a.claim.allegation}</p>
          <Links urls={a.claim.evidence_urls} />
        </article>
        <article>
          <span className={`timeline-dot ${!a.response ? "hollow" : ""}`} />
          <div className="timeline-label">AUDITOR RESPONSE</div>
          {a.response ? (
            <>
              <p className="statement">{a.response.statement}</p>
              <Links urls={a.response.evidence_urls} />
            </>
          ) : (
            <p className="muted">
              {now < a.response_deadline
                ? "The auditor can submit one response with supporting evidence."
                : "No response was submitted."}
            </p>
          )}
        </article>
        <article>
          <span className={`timeline-dot ${!decision ? "hollow" : ""}`} />
          <div className="timeline-label">
            GOVERNOR DECISION
            {decision && <time>{date(Number(decision.decided_at))}</time>}
          </div>
          {decisionError ? (
            <p className="form-error" role="alert">
              Decision unavailable: {decisionError}
            </p>
          ) : decision ? (
            <>
              <h3>{decision.verdict.replaceAll("_", " ")}</h3>
              <dl className="decision-flags">
                <div>
                  <dt>Hack occurred</dt>
                  <dd>{decision.hack_occurred}</dd>
                </div>
                <div>
                  <dt>Within scope</dt>
                  <dd>{decision.within_scope}</dd>
                </div>
                <div>
                  <dt>Auditor liable</dt>
                  <dd>{decision.auditor_liable}</dd>
                </div>
              </dl>
              <p className="statement">{decision.rationale}</p>
              {decision.citations.map((citation, i) => (
                <blockquote key={i}>
                  {citation.quote}
                  <Links urls={[citation.url]} />
                </blockquote>
              ))}
              {decision.evidence_hashes?.some((e) => e.error) && (
                <p className="muted">
                  Some evidence was unavailable to the governor. Read its
                  rationale before requesting another review.
                </p>
              )}
              {decision.verdict === "inconclusive" && (
                <p className="muted">
                  The claim stays open. Anyone can retry the review before the
                  decision deadline.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Anyone can request a decision after the response window closes.
              The governor compares the evidence with the agreed audit scope.
            </p>
          )}
        </article>
      </div>
    </>
  );
}
