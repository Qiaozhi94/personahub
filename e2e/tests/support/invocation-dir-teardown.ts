import { rmSync } from "node:fs";
import { invocationDir } from "./invocation-dir.js";

// Cleanup of the one directory this invocation created (review R3-017) —
// safe because invocation-dir.ts guarantees it's a freshly mkdtemp'd path
// nothing else could be using, unlike the old fixed/shared path this
// replaced. globalTeardown only ever runs in the orchestrator process, which
// is always the directory's owner (see invocation-dir.ts's worker-process
// note), so there is exactly one directory here to remove.
export default function cleanupInvocationDir(): void {
  rmSync(invocationDir(), { recursive: true, force: true });
}
