import { rmSync } from "node:fs";
import { invocationDir } from "./invocation-dir.js";

// Best-effort cleanup of the one directory this invocation created (review
// R3-017) — safe because invocation-dir.ts guarantees it's a freshly
// mkdtemp'd path nothing else could be using, unlike the old fixed/shared
// path this replaced.
export default function cleanupInvocationDir(): void {
  rmSync(invocationDir(), { recursive: true, force: true });
}
