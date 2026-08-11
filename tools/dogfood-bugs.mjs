// tools/dogfood-bugs.mjs
// Parser + summarizer for the dogfooding bug log (docs/reviews/dogfooding-bugs.md).
// Zero runtime dependencies — only node built-ins.
// Exports pure functions for testing; CLI reads the real doc and sets exit code.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUG_DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'reviews', 'dogfooding-bugs.md');

const LEGAL_STATUSES = ['fixed', 'open'];
const EMPTY = '—';
const SEPARATOR_CELL = /^:?-+:?$/;

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

/**
 * Extract the first markdown table (lines starting/ending with `|`) from text.
 * Returns the raw table lines including header + separator.
 */
export function extractTable(markdown) {
  const lines = markdown.split('\n');
  const table = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isRow = trimmed.startsWith('|') && trimmed.endsWith('|');
    if (isRow) {
      started = true;
      table.push(trimmed);
    } else if (started) {
      break;
    }
  }
  return table;
}

function splitRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Parse a bug log document into { header, issues }.
 * The master table is the single source of truth: first row = header,
 * second row = separator, remaining rows = issues.
 */
export function parseBugLog(markdown) {
  const table = extractTable(markdown);
  if (table.length < 2) return { header: [], issues: [] };
  const header = splitRow(table[0]);
  const rows = table
    .slice(1)
    .filter((line) => !splitRow(line).every((cell) => SEPARATOR_CELL.test(cell)))
    .map(splitRow)
    .filter((row) => row[0]?.startsWith('BUG-'));
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const col = (name) => {
    const key = header.find((h) => h === name || h.startsWith(name));
    return key !== undefined ? idx[key] : undefined;
  };
  const issues = rows.map((row) => ({
    id: row[col('ID')],
    status: row[col('状态')],
    severity: row[col('严重度')],
    problem: row[col('问题')],
    fixCommit: row[col('修复 commit')] ?? EMPTY,
  }));
  return { header, issues };
}

// ---------------------------------------------------------------------------
// Validation + summary (pure)
// ---------------------------------------------------------------------------

export function validateBugs(issues) {
  const errors = [];
  const seen = new Set();
  for (const issue of issues) {
    if (!issue.id) {
      errors.push('row without BUG-xxx ID');
      continue;
    }
    if (seen.has(issue.id)) errors.push(`duplicate ID: ${issue.id}`);
    seen.add(issue.id);
    if (!LEGAL_STATUSES.includes(issue.status)) {
      errors.push(`${issue.id}: invalid status "${issue.status}" (legal: ${LEGAL_STATUSES.join('/')})`);
    }
    if (issue.status === 'open' && issue.fixCommit && issue.fixCommit !== EMPTY) {
      errors.push(`${issue.id}: status is open but has fix commit "${issue.fixCommit}"`);
    }
  }
  return errors;
}

export function summarizeBugs(issues) {
  const byStatus = {};
  const bySeverity = {};
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }
  return {
    total: issues.length,
    byStatus,
    bySeverity,
    open: issues.filter((i) => i.status === 'open'),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const markdown = readFileSync(BUG_DOC, 'utf8');
  const { issues } = parseBugLog(markdown);
  const errors = validateBugs(issues);
  const summary = summarizeBugs(issues);

  console.log('PersonaHub dogfooding bug log');
  console.log(`total: ${summary.total}`);
  console.log(`by status: ${JSON.stringify(summary.byStatus)}`);
  console.log(`by severity: ${JSON.stringify(summary.bySeverity)}`);
  if (summary.open.length > 0) {
    console.log('open:');
    for (const issue of summary.open) {
      console.log(`  - ${issue.id} [${issue.severity}] ${issue.problem}`);
    }
  } else {
    console.log('open: none');
  }

  if (errors.length > 0) {
    console.error('validation errors:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
