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

const REVIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'reviews');
const BUG_DOC = join(REVIEWS_DIR, 'dogfooding-bugs.md');
const NOTE_DOC = join(REVIEWS_DIR, 'dogfooding-notes.md');

// `wontfix` exists so that "looked at it, deliberately not fixing" has somewhere
// to go other than staying `open` forever or quietly disappearing. Borrowed from
// clowder-ai's `suppressed_with_reason` being a first-class lifecycle state
// (F266) — see docs/reviews/clowder-governance-borrowing.md §4.3.
const LEGAL_STATUSES = ['fixed', 'open', 'wontfix'];
/** Marker a wontfix detail block must carry. Bold so it is visible when reading, not just when parsing. */
const WONTFIX_REASON_MARKER = '不修理由';
const LEGAL_SEVERITIES = ['高', '中', '低'];
// Which layer should have caught this. Drives where the regression case goes —
// see self-test-system-plan.md §7.1.
const LEGAL_ESCAPE_LAYERS = ['任务级', '需求级', '发布级'];
// A journey step that shows up twice has a coverage hole, not bad luck (§7.2).
const REPEAT_THRESHOLD = 2;
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
    escapeLayer: row[col('逃逸层级')],
    journeyStep: row[col('旅程步骤')],
    problem: row[col('问题')],
    regressionTest: row[col('回归测试')] ?? EMPTY,
    fixCommit: row[col('修复 commit')] ?? EMPTY,
  }));
  return { header, issues };
}

/**
 * Map of BUG id -> its `### BUG-xxx…` detail block body.
 * Used only to check that a `wontfix` states why; everything else is table-driven.
 */
export function parseDetailSections(markdown) {
  const sections = new Map();
  const lines = markdown.split('\n');
  let currentId = null;
  let buffer = [];
  const flush = () => {
    if (currentId) sections.set(currentId, buffer.join('\n'));
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^###\s+(BUG-\d+)/);
    if (heading) {
      flush();
      currentId = heading[1];
      continue;
    }
    if (currentId) buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * Parse the notes doc's master table. Notes carry no severity or fix commit —
 * the only field this tool needs from them is the journey step, because §7.2
 * counts repeats across both docs, not per-doc.
 */
export function parseNoteLog(markdown) {
  const table = extractTable(markdown);
  if (table.length < 2) return { notes: [] };
  const header = splitRow(table[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const col = (name) => {
    const key = header.find((h) => h === name || h.startsWith(name));
    return key !== undefined ? idx[key] : undefined;
  };
  const notes = table
    .slice(1)
    .filter((line) => !splitRow(line).every((cell) => SEPARATOR_CELL.test(cell)))
    .map(splitRow)
    .filter((row) => row[0]?.startsWith('NOTE-'))
    .map((row) => ({
      id: row[col('ID')],
      journeyStep: row[col('旅程步骤')],
      problem: row[col('问题')],
    }));
  return { notes };
}

/**
 * Journey steps recorded 2+ times across bugs and notes. Each one means the
 * step lacks requirement-level coverage — the fix is a spec, not another
 * one-off patch (§7.2 "重复即升级"). `EMPTY` is excluded: it means "P0
 * journeys not yet defined", not "the same step again".
 */
export function findRepeatedSteps(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const step = entry.journeyStep;
    if (!step || step === EMPTY) continue;
    if (!counts.has(step)) counts.set(step, []);
    counts.get(step).push(entry.id);
  }
  return [...counts.entries()]
    .filter(([, ids]) => ids.length >= REPEAT_THRESHOLD)
    .map(([step, ids]) => ({ step, ids }));
}

// ---------------------------------------------------------------------------
// Validation + summary (pure)
// ---------------------------------------------------------------------------

export function validateBugs(issues, details = new Map()) {
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
    if (!LEGAL_SEVERITIES.includes(issue.severity)) {
      errors.push(`${issue.id}: invalid severity "${issue.severity}" (legal: ${LEGAL_SEVERITIES.join('/')})`);
    }
    // Required so the regression case lands in the layer that let it through
    // instead of defaulting to a unit test (§7.1). No "unknown" escape hatch —
    // an unanswered question here is exactly what makes the loop optional.
    if (!LEGAL_ESCAPE_LAYERS.includes(issue.escapeLayer)) {
      errors.push(
        `${issue.id}: invalid escape layer "${issue.escapeLayer ?? ''}" (legal: ${LEGAL_ESCAPE_LAYERS.join('/')})`,
      );
    }
    // `—` is legal here (P0 journeys not defined yet); blank is not, since a
    // blank cell is indistinguishable from "nobody looked".
    if (!issue.journeyStep) {
      errors.push(`${issue.id}: missing journey step (use "${EMPTY}" until P0 journeys are defined)`);
    }
    if (issue.status === 'open' && issue.fixCommit && issue.fixCommit !== EMPTY) {
      errors.push(`${issue.id}: status is open but has fix commit "${issue.fixCommit}"`);
    }
    // "复验才能关单": a fix nobody can re-run is a claim, not a closure. Borrowed
    // from clowder-ai F266 — closure may come from a passing re-check, an explicit
    // reasoned decision, or sunset; never from someone saying "fixed".
    if (issue.status === 'fixed') {
      if (!issue.regressionTest || issue.regressionTest === EMPTY) {
        errors.push(
          `${issue.id}: status is fixed but has no regression test — a fix nobody can re-run is a claim, not a closure`,
        );
      }
      if (!issue.fixCommit || issue.fixCommit === EMPTY) {
        errors.push(`${issue.id}: status is fixed but has no fix commit`);
      }
    }
    if (issue.status === 'wontfix') {
      if (issue.fixCommit && issue.fixCommit !== EMPTY) {
        errors.push(`${issue.id}: status is wontfix but has fix commit "${issue.fixCommit}"`);
      }
      const detail = details.get(issue.id);
      if (!detail || !detail.includes(WONTFIX_REASON_MARKER)) {
        errors.push(
          `${issue.id}: status is wontfix but its detail block has no "${WONTFIX_REASON_MARKER}" — deciding not to fix is a decision, and a decision needs a reason on the record`,
        );
      }
    }
  }
  return errors;
}

export function summarizeBugs(issues) {
  const byStatus = {};
  const bySeverity = {};
  const byEscapeLayer = {};
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    byEscapeLayer[issue.escapeLayer] = (byEscapeLayer[issue.escapeLayer] ?? 0) + 1;
  }
  return {
    total: issues.length,
    byStatus,
    bySeverity,
    byEscapeLayer,
    open: issues.filter((i) => i.status === 'open'),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const markdown = readFileSync(BUG_DOC, 'utf8');
  const { issues } = parseBugLog(markdown);
  const { notes } = parseNoteLog(readFileSync(NOTE_DOC, 'utf8'));
  const errors = validateBugs(issues, parseDetailSections(markdown));
  const summary = summarizeBugs(issues);
  const repeated = findRepeatedSteps([...issues, ...notes]);

  console.log('PersonaHub dogfooding bug log');
  console.log(`total: ${summary.total}`);
  console.log(`by status: ${JSON.stringify(summary.byStatus)}`);
  console.log(`by severity: ${JSON.stringify(summary.bySeverity)}`);
  console.log(`by escape layer: ${JSON.stringify(summary.byEscapeLayer)}`);
  if (repeated.length > 0) {
    console.log(`repeated journey steps (§7.2 — needs a requirement-level spec, not another point fix):`);
    for (const { step, ids } of repeated) {
      console.log(`  - ${step}: ${ids.join(', ')}`);
    }
  }
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
