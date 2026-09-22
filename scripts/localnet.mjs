import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  access,
  open,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { join } from "node:path";
import {
  wallets,
  localRpcUrl,
  rpcFor,
  sdkFor,
  read,
  finalized,
  deploymentAddress,
  updateEnv,
} from "./localnet-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = join(root, ".localnet");
const command = process.argv[2] || "start";
if (
  ![
    "start",
    "setup",
    "stop",
    "logs",
    "wallets",
    "smoke",
    "seed",
    "governance",
  ].includes(command)
)
  throw new Error(
    "Use start, setup, stop, logs, wallets, smoke, seed, or governance.",
  );
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const envPath = join(root, "localnet/.env");
try {
  await access(envPath);
} catch {
  await writeFile(
    envPath,
    await readFile(join(root, "localnet/.env.example")),
    { mode: 0o600 },
  );
}
const localEnv = parseEnv(await readFile(envPath, "utf8"));
const env = { ...process.env, ...localEnv };
const rpcUrl = localRpcUrl(env.BEVOR_RPC_PORT || "4010");
const frontendPort = env.BEVOR_FRONTEND_PORT || "3010";
localRpcUrl(frontendPort);
const composeArgs = [
  "compose",
  "--env-file",
  envPath,
  "-f",
  join(root, "localnet/compose.yaml"),
];
let interrupted = false;
function run(bin, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("error", reject);
    const stop = () => {
      interrupted = true;
      child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.on("exit", (code, signal) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with code ${code}`));
    });
  });
}
async function save(path, value) {
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(path + ".tmp", path);
}
if (command === "stop") {
  await run("docker", [...composeArgs, "stop"]);
  process.exit(0);
}
if (command === "logs") {
  await run("docker", [...composeArgs, "logs", "--tail", "100", "-f"]);
  process.exit(0);
}
if (command === "wallets") {
  console.log(
    "PUBLIC LOCAL TEST KEYS. Never send real funds to these wallets.",
  );
  for (const { role, address, privateKey } of wallets)
    console.log(`\n${role}\nAddress: ${address}\nPrivate key: ${privateKey}`);
  console.log(
    `\nWallet network: GenLayer Localnet\nRPC: ${rpcUrl}\nChain ID: 61127\nCurrency: GEN`,
  );
  process.exit(0);
}
const lockPath = join(stateDir, "setup.lock");
let lock;
async function releaseLock() {
  if (lock) {
    await lock.close();
    lock = null;
    await unlink(lockPath).catch(() => {});
  }
}
try {
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    let alive = true;
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
    }
    if (alive)
      throw new Error("Another local setup is running. Wait for it to finish.");
    await unlink(lockPath);
    lock = await open(lockPath, "wx", 0o600);
  }
  await lock.writeFile(String(process.pid));
  console.log(
    "Starting the isolated Bevor localnet. The first start downloads GenVM images.",
  );
  await run(
    "docker",
    [...composeArgs, "up", "--build", "-d", "--wait", "--wait-timeout", "600"],
    { COMPOSE_PROGRESS: "plain" },
  );
  const rpc = rpcFor(rpcUrl),
    sdk = sdkFor(rpcUrl);
  if (Number(await rpc("eth_chainId")) !== 61127)
    throw new Error(
      "The RPC does not report GenLayer Localnet chain ID 61127.",
    );
  const count = await rpc("sim_countValidators");
  if (Number(count) < 5)
    throw new Error(
      "Localnet needs five validators. Read npm run local:logs for startup errors.",
    );
  const resumingGovernance =
    command === "governance" &&
    (await access(join(stateDir, "governance-demo.json")).then(
      () => true,
      () => false,
    ));
  for (const wallet of wallets) {
    const balance = BigInt(
      await rpc("eth_getBalance", [wallet.address, "latest"]),
    );
    const target = 1000n * 10n ** 18n;
    if (balance < target && !resumingGovernance)
      await rpc("sim_fundAccount", [wallet.address, target - balance]);
    const funded = BigInt(
      await rpc("eth_getBalance", [wallet.address, "latest"]),
    );
    if (funded < target && !resumingGovernance)
      throw new Error(`Funding failed for the ${wallet.role} wallet.`);
    console.log(
      `Funded ${wallet.role}: ${wallet.address} (${funded / 10n ** 18n} GEN)`,
    );
  }
  await save(
    join(stateDir, "wallets.json"),
    wallets.map(({ role, address, privateKey }) => ({
      role,
      address,
      privateKey,
    })),
  );
  const manifestPath = join(stateDir, "deployment.json");
  let manifest = { rpcUrl };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {}
  if (manifest.rpcUrl !== rpcUrl) manifest = { rpcUrl };
  for (const name of ["governor", "protocol"]) {
    const code = await readFile(
      join(root, `contracts/bevor_${name}.py`),
      "utf8",
    );
    const sourceHash = createHash("sha256")
      .update(code)
      .update(name === "protocol" ? manifest.governor.address : "")
      .digest("hex");
    let entry = manifest[name];
    if (entry?.sourceHash === sourceHash && entry.address) {
      try {
        const liveCode = await sdk.getContractCode(entry.address);
        if (liveCode !== code) throw new Error("Contract code differs");
        console.log(`Reusing ${name}: ${entry.address}`);
        continue;
      } catch {
        entry = null;
      }
    }
    if (
      !entry ||
      entry.failed ||
      entry.sourceHash !== sourceHash ||
      entry.address
    ) {
      console.log(`Deploying Bevor ${name}…`);
      const hash = await sdk.deployContract({
        code,
        args: name === "protocol" ? [manifest.governor.address] : [],
      });
      entry = { sourceHash, hash };
      manifest[name] = entry;
      await save(manifestPath, manifest);
    }
    let receipt;
    try {
      receipt = await finalized(rpc, entry.hash);
    } catch (error) {
      if (error.terminal) {
        entry.failed = true;
        await save(manifestPath, manifest);
      }
      throw error;
    }
    entry.address = deploymentAddress(receipt);
    manifest[name] = entry;
    await save(manifestPath, manifest);
    console.log(`Deployed ${name}: ${entry.address}`);
  }
  const listing = await read(
    sdk,
    manifest.protocol.address,
    "list_audits",
    [0, 1],
  );
  if (
    listing.governor.toLowerCase() !== manifest.governor.address.toLowerCase()
  )
    throw new Error("The protocol points to the wrong governor.");
  const frontendEnv = {
    NEXT_PUBLIC_BEVOR_PROTOCOL_ADDRESS: manifest.protocol.address,
    NEXT_PUBLIC_GENLAYER_NETWORK: "localnet",
    NEXT_PUBLIC_GENLAYER_RPC_URL: rpcUrl,
  };
  const frontendEnvPath = join(root, "frontend/.env.local");
  let existing = "";
  try {
    existing = await readFile(frontendEnvPath, "utf8");
  } catch {}
  await writeFile(frontendEnvPath, updateEnv(existing, frontendEnv));
  console.log(
    `\nBevor frontend: http://localhost:${frontendPort}\nProtocol: ${manifest.protocol.address}\nGovernor: ${manifest.governor.address}\nWallet keys: npm run local:wallets`,
  );
  if (!env.OPENAIKEY)
    console.log(
      "\nVesting is ready without an AI key. For governor inference, set OPENAIKEY in localnet/.env and restart.",
    );
  if (command === "smoke") {
    const { smoke } = await import("./localnet-smoke.mjs");
    await smoke({ rpc, sdk, rpcUrl, manifest, stateDir });
  } else if (command === "seed") {
    const { seed } = await import("./localnet-seed.mjs");
    await seed({ rpc, rpcUrl, manifest, stateDir });
  } else if (command === "governance") {
    if (!env.OPENAIKEY)
      throw new Error(
        "Set OPENAIKEY in localnet/.env to run governor inference.",
      );
    const { governance } = await import("./localnet-governance.mjs");
    await governance({ rpc, rpcUrl, manifest, stateDir, root });
  } else if (command === "start") {
    await releaseLock();
    console.log(
      "\nCtrl+C stops the frontend. npm run local:stop stops the localnet and preserves its data.",
    );
    await run(
      "npm",
      [
        "run",
        "dev",
        "--workspace=frontend",
        "--",
        "--hostname",
        "127.0.0.1",
        "--port",
        frontendPort,
      ],
      {
        ...frontendEnv,
        NEXT_PUBLIC_BEVOR_LOCAL_MODE: "1",
        BEVOR_NEXT_DIST_DIR: ".next-local",
      },
    );
  }
} catch (error) {
  if (!interrupted)
    console.error(
      `\nLocal startup failed: ${error.message}\nRead npm run local:logs for container details. Existing localnet data remains intact.`,
    );
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await releaseLock();
}
