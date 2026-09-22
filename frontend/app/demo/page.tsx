import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { notFound } from "next/navigation";
import Workspace from "@/components/bevor/workspace";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  if (process.env.NEXT_PUBLIC_BEVOR_LOCAL_MODE !== "1") notFound();
  let record: { protocol?: string; auditId?: string; rpcUrl: string };
  try {
    record = JSON.parse(
      await readFile(
        resolve(process.cwd(), "../.localnet/governance-demo.json"),
        "utf8",
      ),
    );
  } catch {
    return (
      <main>
        <h1>Governance demo</h1>
        <p>
          Run <code>npm run local:governance</code> from the repository root,
          then refresh this page.
        </p>
      </main>
    );
  }
  if (!record.protocol || !record.auditId) {
    return (
      <main>
        <h1>Preparing the governance replay</h1>
        <p>
          The demo is deploying and funding its agreement. Refresh this page
          shortly.
        </p>
      </main>
    );
  }
  return (
    <Workspace
      initialDeployment={{
        network: "localnet",
        protocol: record.protocol,
        rpc: record.rpcUrl,
      }}
      initialAudit={record.auditId}
      readOnlyDemo
    />
  );
}
