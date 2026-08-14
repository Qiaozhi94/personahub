import { defineConfig } from "vitest/config";

// Worker count is bounded by subprocess contention, not by CPU cores. Many
// integration tests shell out synchronously (`git init`, the fake CLI adapters
// under tests/helpers/fake-*.mjs); with one worker per core (22 here) those
// child processes starve and single calls stretch past 9s. 8 workers keeps the
// suite green and stable at ~59s vs ~266s fully serial. CI runners have 2-4
// cores, so the local optimum would be a pessimization there.
const maxWorkers = process.env.CI ? 2 : 8;

export default defineConfig({
  test: {
    // Was false: parallel runs used to fail, but the cause was the subprocess
    // starvation above (timeouts), not cross-test data bleed — every test owns
    // its own temp dir + DB via tests/helpers.ts `createTempDir()`.
    fileParallelism: true,
    maxWorkers,
    // 5s (the default) is under the worst-case time of a contended `git init`
    // on Windows. Raised so a slow machine reports real failures rather than
    // scheduling noise.
    testTimeout: 20_000,
    // Same reason, for setup that builds a real DB and binds a socket
    // (tests/integration/api-client-contract.test.ts): the 10s default is
    // tight once workers compete.
    hookTimeout: 20_000,
  },
});
