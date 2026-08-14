// tools/check-e2e-fixme.mjs
// Enforces self-test-system-plan.md §7.3 "fixme 不过夜".
// Zero runtime dependencies — only node built-ins.
// Exports pure functions for testing; CLI reads the real files and sets exit code.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_TESTS_DIR = join(REPO_ROOT, 'e2e', 'tests');
const PLAN_DOC = join(REPO_ROOT, 'docs', 'reviews', 'self-test-system-plan.md');

// Unconditional parking markers only. Playwright's runtime form
// `test.skip(condition, reason)` — and vitest's `describe.skipIf(...)` — are
// deliberately NOT matched: those encode "this environment cannot run it"
// (real-CLI tests, platform guards), which SOP's 真实环境测试纪律 already
// governs. What §7.3 targets is a spec parked with no owner.
const PARK_PATTERNS = [
  /\btest\.fixme\s*\(/,
  /\btest\.describe\.fixme\s*\(/,
  /\btest\.skip\s*\(\s*["'`]/,
  /\btest\.describe\.skip\s*\(/,
];

const UNCHECKED_TASK = /^\s*-\s*\[ \]/;

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** Line numbers in `text` carrying an unconditional park marker. */
export function findParkedLines(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !line.trim().startsWith('//') && PARK_PATTERNS.some((re) => re.test(line)))
    .map(({ no }) => no);
}

/** Unchecked task lines from the plan's task list. */
export function extractUncheckedTasks(planText) {
  return planText.split('\n').filter((line) => UNCHECKED_TASK.test(line));
}

/**
 * A parked spec needs an unchecked task naming its file. Matching on the
 * basename keeps the contract mechanical: rename the spec and the gate goes
 * red until the task is updated too, which is the point — an orphaned fixme
 * is indistinguishable from real coverage when you only read the test list.
 */
export function checkParkedSpecs(specs, uncheckedTasks) {
  const errors = [];
  for (const { file, parkedLines } of specs) {
    if (parkedLines.length === 0) continue;
    const name = basename(file);
    const owned = uncheckedTasks.some((task) => task.includes(name));
    if (!owned) {
      errors.push(
        `${file}: parked at line(s) ${parkedLines.join(', ')} but no unchecked task in ` +
          `docs/reviews/self-test-system-plan.md mentions "${name}"`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

function collectSpecFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSpecFiles(full));
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function main() {
  const specs = collectSpecFiles(E2E_TESTS_DIR).map((full) => ({
    file: full.slice(REPO_ROOT.length + 1).replaceAll('\\', '/'),
    parkedLines: findParkedLines(readFileSync(full, 'utf8')),
  }));
  const uncheckedTasks = extractUncheckedTasks(readFileSync(PLAN_DOC, 'utf8'));
  const errors = checkParkedSpecs(specs, uncheckedTasks);
  const parked = specs.filter((s) => s.parkedLines.length > 0);

  console.log('PersonaHub E2E fixme check (self-test-system-plan.md §7.3)');
  console.log(`specs: ${specs.length}, parked: ${parked.length}`);
  for (const { file, parkedLines } of parked) {
    console.log(`  - ${file}: line(s) ${parkedLines.join(', ')}`);
  }

  if (errors.length > 0) {
    console.error('orphaned parked specs:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('E2E fixme check PASSED - every parked spec has an owner task.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
