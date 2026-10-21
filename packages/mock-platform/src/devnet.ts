// Starts a local chain and the mock platform, runs every scenario through close → producer →
// worker, and keeps the verification API up so the verifier CLI can be pointed at it.
// Usage: pnpm --filter @civicue/voting-anchor-mock-platform devnet [--rpc-port 8545] [--api-port 8787]
import { parseArgs } from "node:util";
import { serveApi } from "./api.ts";
import { localChainUnavailable, startLocalChain } from "./chain.ts";
import { Store } from "./platform.ts";
import { computePending } from "./producer.ts";
import { SCENARIOS, seedScenario } from "./scenarios.ts";
import { runAnchorBatch } from "./worker.ts";

const { values } = parseArgs({
  options: {
    "rpc-port": { type: "string", default: "8545" },
    "api-port": { type: "string", default: "8787" },
  },
});
const unavailable = localChainUnavailable();
if (unavailable) {
  console.error(`devnet ${unavailable}`);
  process.exit(1);
}

const chain = await startLocalChain(Number(values["rpc-port"]));
process.on("SIGINT", () => (chain.stop(), process.exit(0)));
process.on("SIGTERM", () => (chain.stop(), process.exit(0)));

const store = new Store();
const ids = SCENARIOS.map((scenario) => seedScenario(store, scenario));
computePending(store);
const batch = await runAnchorBatch(store, chain);
const { url } = await serveApi(store, Number(values["api-port"]));

const width = Math.max(...SCENARIOS.map((scenario) => scenario.name.length));
console.log(`mock platform ready

  rpc        ${chain.rpcUrl}  (chain 84532, posing as base-sepolia)
  registry   ${chain.registry}
  platform   ${url}
  anchored   ${batch.anchored.length} sessions${batch.failed.length ? `, ${batch.failed.length} failed` : ""}

  sessions
${SCENARIOS.map((scenario, i) => `    ${ids[i]}  ${scenario.name.padEnd(width)}  ${store.session(ids[i]!).anchorStatus}`).join("\n")}

  verify one:
    node packages/verifier/dist/cli.js verify --network base-sepolia --rpc-url ${chain.rpcUrl} --platform ${url} --session ${ids[0]}
`);
