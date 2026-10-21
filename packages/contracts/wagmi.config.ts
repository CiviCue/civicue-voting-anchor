import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// Generates the viem-typed (`as const`) AnchorRegistry ABI from `forge build` output.
export default defineConfig({
  out: "ts/generated.ts",
  plugins: [
    foundry({
      project: ".",
      include: ["AnchorRegistry.sol/**"],
      forge: { build: false },
    }),
  ],
});
