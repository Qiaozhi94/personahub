// tools/check-doc-ownership.mjs
// Checks machine-provable ownership violations in the repo docs.
// Zero runtime dependencies - only node built-ins.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-use shared logic from check-feature-gates for consistency.
import {
  parseFrontmatter,
  normalizeLineEndings,
  stripCodeBlocks,
  hasBlockquoteStatus,
  discoverFeatures,
  parseBacklogRows,
  checkBacklogConsistency,
  checkFeatureBase,
} from './check-feature-gates.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Authoritative entry paths that must exist (relative to repo root).
// These are the "unique owner" documents from the ownership matrix.
const AUTHORITATIVE_DOCS = [
  'docs/personahub-prd.md',
  'docs/personahub-architecture.md',
  'docs/personahub-system-design.md',
  'docs/decisions',
  'docs/SOP.md',
  'docs/README.md',
  'BACKLOG.md',
  'CLAUDE.md',
  'docs/reviews/RETROSPECTIVE.md',
];

// Files that must NOT be declared as current product/status/implementation
// truth source (they are historical records).
const RELEASE_PATTERNS = [/releases\//];
const RETROSPECTIVE_PATTERN = /RETROSPECTIVE\.md/;

// ---------------------------------------------------------------------------
// Pure text utilities
// ---------------------------------------------------------------------------

/**
 * Find all frontmatter `status` declarations in a markdown file's frontmatter.
 * Returns array of { field, value } or empty if none.
 */
export function findFrontmatterStatus(text) {
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter) return [];
  const result = [];
  if (frontmatter.status !== undefined) {
    result.push({ field: 'status', value: frontmatter.status });
  }
  return result;
}

/**
 * Find a "Status:" declaration in blockquote lines.
 * Returns array of { line: number, text: string }.
 */
export function findBlockquoteStatusDeclarations(text) {
  const normalized = normalizeLineEndings(text);
  const lines = normalized.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^>\s*(?:\*?\*?Status\*?\*?)\s*[：:]\s*(.+)/i);
    if (m) {
      result.push({ line: i + 1, text: m[1].trim() });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ownership checks
// ---------------------------------------------------------------------------

/**
 * Check that `status` only appears in Feature spec.md frontmatter.
 * design.md and tasks.md must not declare independent Status.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkStatusOwnership(featuresRoot, repoRoot) {
  const errors = [];
  const warnings = [];
  const features = discoverFeatures(featuresRoot, repoRoot);

  for (const f of features) {
    const relDir = relative(repoRoot, f.dir).replace(/\\/g, '/');

    // Check design.md
    const designPath = join(f.dir, 'design.md');
    if (existsSync(designPath)) {
      const text = readFileSync(designPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(text);
      if (frontmatter && frontmatter.status !== undefined) {
        errors.push(`${relDir}/design.md: must not declare status in frontmatter (spec.md is the single source)`);
      }
      const bqStatus = findBlockquoteStatusDeclarations(text);
      if (bqStatus.length > 0) {
        errors.push(`${relDir}/design.md: must not declare Status in blockquote (spec.md is the single source)`);
      }
    }

    // Check tasks.md
    const tasksPath = join(f.dir, 'tasks.md');
    if (existsSync(tasksPath)) {
      const text = readFileSync(tasksPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(text);
      if (frontmatter && frontmatter.status !== undefined) {
        errors.push(`${relDir}/tasks.md: must not declare status in frontmatter (spec.md is the single source)`);
      }
      const bqStatus = findBlockquoteStatusDeclarations(text);
      if (bqStatus.length > 0) {
        errors.push(`${relDir}/tasks.md: must not declare Status in blockquote (spec.md is the single source)`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check BACKLOG bidirectional set comparison with non-done Features.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkBacklogOwnership(featuresRoot, repoRoot) {
  const errors = [];
  const warnings = [];

  const backlogPath = join(repoRoot, 'BACKLOG.md');
  let backlogText;
  try {
    backlogText = readFileSync(backlogPath, 'utf-8');
  } catch {
    errors.push('BACKLOG.md: missing or unreadable');
    return { errors, warnings };
  }

  const features = discoverFeatures(featuresRoot, repoRoot);
  const featureObjects = [];

  for (const f of features) {
    const result = checkFeatureBase(f.dir, repoRoot);
    if (result.feature) {
      featureObjects.push(result.feature);
    }
  }

  const result = checkBacklogConsistency(featureObjects, backlogText, repoRoot);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  return { errors, warnings };
}

/**
 * Check that authoritative entry documents exist and are unique.
 * "Exist" = the file or directory is present in the repo.
 * "Unique" = no duplicate truth-source declarations.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkAuthoritativeEntries(repoRoot) {
  const errors = [];
  const warnings = [];

  for (const doc of AUTHORITATIVE_DOCS) {
    const full = join(repoRoot, doc);
    if (!existsSync(full)) {
      errors.push(`Authoritative entry missing: ${doc}`);
    }
  }

  // Check docs/README.md has the ownership matrix
  const docsReadmePath = join(repoRoot, 'docs', 'README.md');
  if (existsSync(docsReadmePath)) {
    const text = readFileSync(docsReadmePath, 'utf-8');
    if (!text.includes('所有权') && !text.includes('ownership')) {
      warnings.push('docs/README.md: ownership matrix heading not found');
    }
  }

  return { errors, warnings };
}

/**
 * Check that releases/ and RETROSPECTIVE.md are not declared as current
 * product, status, or implementation truth source.
 * This checks for problematic declarations in docs/README.md and CLAUDE.md.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkReleaseNotTruthSource(repoRoot) {
  const errors = [];
  const warnings = [];

  // We check CLAUDE.md and docs/README.md for problematic truth-source
  // declarations pointing to releases/ or RETROSPECTIVE.md.
  const checkFiles = [
    join(repoRoot, 'CLAUDE.md'),
    join(repoRoot, 'docs', 'README.md'),
  ];

  const truthKeywords = [
    '真相源',
    '单一真源',
    'single source of truth',
    'source of truth',
    'truth source',
  ];

  for (const filePath of checkFiles) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, 'utf-8');
    const relFile = relative(repoRoot, filePath).replace(/\\/g, '/');
    const lines = normalizeLineEndings(text).split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      const hasTruthKeyword = truthKeywords.some((kw) =>
        lower.toLowerCase().includes(kw.toLowerCase()),
      );
      if (!hasTruthKeyword) continue;

      // Check if this truth-source line references releases/ or RETROSPECTIVE.md
      const referencesRelease = RELEASE_PATTERNS.some((p) => p.test(line));
      const referencesRetrospective = RETROSPECTIVE_PATTERN.test(line);

      if (referencesRelease) {
        errors.push(
          `${relFile}:${i + 1}: releases/ must not be declared as truth source`,
        );
      }
      if (referencesRetrospective) {
        errors.push(
          `${relFile}:${i + 1}: RETROSPECTIVE.md must not be declared as current truth source`,
        );
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Top-level check
// ---------------------------------------------------------------------------

/**
 * Run all ownership checks.
 * @param {string} repoRoot - absolute path to repo root
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkAllOwnership(repoRoot) {
  const allErrors = [];
  const allWarnings = [];
  const featuresRoot = join(repoRoot, 'docs', 'features');

  const statusResult = checkStatusOwnership(featuresRoot, repoRoot);
  allErrors.push(...statusResult.errors);
  allWarnings.push(...statusResult.warnings);

  const backlogResult = checkBacklogOwnership(featuresRoot, repoRoot);
  allErrors.push(...backlogResult.errors);
  allWarnings.push(...backlogResult.warnings);

  const authResult = checkAuthoritativeEntries(repoRoot);
  allErrors.push(...authResult.errors);
  allWarnings.push(...authResult.warnings);

  const releaseResult = checkReleaseNotTruthSource(repoRoot);
  allErrors.push(...releaseResult.errors);
  allWarnings.push(...releaseResult.warnings);

  return { errors: allErrors, warnings: allWarnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli() {
  const repoRoot = resolve(process.cwd());
  const { errors, warnings } = checkAllOwnership(repoRoot);

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`  WARN  ${w}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\nDoc ownership check FAILED - ${errors.length} error(s):\n`);
    for (const e of errors) {
      console.error(`  FAIL  ${e}`);
    }
    process.exit(1);
  }

  console.error('Doc ownership check PASSED - all ownership rules OK.');
  process.exit(0);
}

const isMain = (() => {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  runCli();
}
