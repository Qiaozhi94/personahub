// tools/check-feature-gates.mjs
// Feature gate validator for PersonaHub.
// Zero runtime dependencies — only node built-ins.
// Exports pure functions for testing; CLI reads the real repo and sets exit code.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_GATE_VERSIONS = [0, 1];
const LEGAL_STATUSES = [
  'draft',
  'ready-for-development',
  'in-progress',
  'review',
  'done',
];
const INCOMPLETE_MARKERS = ['TODO', 'TBD', '待补', '未补', 'pending'];
const REQ_ID_RE = /\b(FR|DR|TR|IR|UX|NFR)-(\d{3})\b/g;
const REQ_PREFIXES = ['FR', 'DR', 'TR', 'IR', 'UX', 'NFR'];

export const SPEC_SECTIONS = [
  { num: 0, title: '来源与意图' },
  { num: 1, title: '问题、目标与非目标' },
  { num: 2, title: '用户场景' },
  { num: 3, title: '范围与边界' },
  { num: 4, title: '需求' },
  { num: 5, title: '生命周期与不变量' },
  { num: 6, title: '成功与验收' },
  { num: 7, title: '测试、依赖与决策' },
  { num: 8, title: '待确认问题' },
];

export const DESIGN_SECTIONS = [
  { num: 0, title: '输入与约束' },
  { num: 1, title: '技术概要与影响面' },
  { num: 2, title: '架构与模块边界' },
  { num: 3, title: '数据模型与 Migration' },
  { num: 4, title: '接口、Contract 与 Event' },
  { num: 5, title: 'Runtime、Workflow 与并发' },
  { num: 6, title: 'UI 与可观测性' },
  { num: 7, title: '失败、恢复、安全与兼容' },
  { num: 8, title: '测试策略与验收映射' },
  { num: 9, title: '已确认决策与残余风险' },
  { num: 10, title: '待确认设计问题' },
];

export const TASKS_SECTIONS = [
  { num: 0, title: '来源与执行规则' },
  { num: 1, title: '前置条件' },
  { num: 2, title: '实现任务' },
  { num: 3, title: '验证与验收任务' },
  { num: 4, title: '依赖与并行关系' },
  { num: 5, title: '明确后移' },
];

// ---------------------------------------------------------------------------
// Pure text utilities
// ---------------------------------------------------------------------------

/**
 * Normalise CRLF / CR to LF.
 */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Strip fenced code blocks (``` or ~~~), replacing their content with empty
 * lines so that line-based parsing outside code blocks is unaffected.
 */
export function stripCodeBlocks(text) {
  const normalized = normalizeLineEndings(text);
  const lines = normalized.split('\n');
  const result = [];
  let inFence = false;
  let fenceChar = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inFence) {
      const m = trimmed.match(/^(`{3,}|~{3,})/);
      if (m) {
        inFence = true;
        fenceChar = m[1][0];
        result.push('');
      } else {
        result.push(line);
      }
    } else {
      const closer = new RegExp(`^${fenceChar === '`' ? '`' : '~'}{3,}`);
      if (closer.test(trimmed)) {
        inFence = false;
        fenceChar = null;
      }
      result.push('');
    }
  }
  return result.join('\n');
}

/**
 * Parse YAML frontmatter from markdown text.
 * Returns { frontmatter: object|null, body: string }.
 * Handles simple key: value, key: "value", key: number, key: [a, b].
 */
export function parseFrontmatter(text) {
  const normalized = normalizeLineEndings(text);
  if (!normalized.startsWith('---')) {
    return { frontmatter: null, body: text };
  }
  const lines = normalized.split('\n');
  // Find closing ---
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: null, body: text };
  }
  const fmLines = lines.slice(1, end);
  const fm = {};
  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Track whether the value was quoted
    let wasQuoted = false;

    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      wasQuoted = true;
    }

    // Array
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (!inner) {
        fm[key] = [];
      } else {
        fm[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s) => s.length > 0);
      }
      continue;
    }

    // Number (only if not quoted)
    if (!wasQuoted && /^-?\d+$/.test(value)) {
      fm[key] = parseInt(value, 10);
      continue;
    }
    if (!wasQuoted && /^-?\d+\.\d+$/.test(value)) {
      fm[key] = parseFloat(value);
      continue;
    }

    fm[key] = value;
  }
  const body = lines.slice(end + 1).join('\n');
  return { frontmatter: fm, body };
}

/**
 * Extract top-level sections (## N. Title) from markdown text.
 * Code blocks are stripped first so headings inside code blocks don't count.
 * Returns an array of { num, title, heading, content, startLine } sorted by
 * appearance order.
 */
export function extractTopLevelSections(text) {
  const stripped = stripCodeBlocks(text);
  const lines = stripped.split('\n');
  const headingRe = /^##\s+(\d+)\.\s+(.+?)\s*$/;
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      sections.push({
        num: parseInt(m[1], 10),
        title: m[2],
        heading: lines[i],
        startLine: i,
        content: '',
      });
    }
  }

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].startLine + 1;
    const end = i + 1 < sections.length ? sections[i + 1].startLine : lines.length;
    sections[i].content = lines.slice(start, end).join('\n');
  }
  return sections;
}

/**
 * Get a section by its number from the sections array.
 */
export function getSectionByNum(sections, num) {
  return sections.find((s) => s.num === num) || null;
}

/**
 * Extract sub-section headings (### Title) within a given section's content.
 * Returns array of { title, content }.
 */
export function extractSubSections(sectionContent) {
  const stripped = stripCodeBlocks(sectionContent);
  const lines = stripped.split('\n');
  const headingRe = /^###\s+(.+?)\s*$/;
  const subs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      subs.push({ title: m[1], heading: lines[i], startLine: i, content: '' });
    }
  }
  for (let i = 0; i < subs.length; i++) {
    const start = subs[i].startLine + 1;
    const end = i + 1 < subs.length ? subs[i + 1].startLine : lines.length;
    subs[i].content = lines.slice(start, end).join('\n');
  }
  return subs;
}

/**
 * Extract checkbox items from text (already code-block-stripped).
 * Returns array of { checked: boolean, text: string }.
 */
export function extractCheckboxes(text) {
  const lines = normalizeLineEndings(text).split('\n');
  const result = [];
  const re = /^-\s+\[([ xX])\]\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      result.push({
        checked: m[1].toLowerCase() === 'x',
        text: m[2].trim(),
      });
    }
  }
  return result;
}

/**
 * Parse AC lines from spec section 6 content.
 * Handles formats:
 *   - [ ] **AC-001** (`FR-001`, `UX-001`): text - tests: `path`
 *   - [x] **AC-001**（FR-001/DR-001）：text
 * Returns array of { id, checked, reqIds: string[], text, testPaths: string[] }.
 */
export function parseAcLines(section6Content) {
  const stripped = stripCodeBlocks(section6Content);
  const lines = stripped.split('\n');
  const result = [];
  const checkboxRe = /^-\s+\[([ xX])\]\s+/;
  const acIdRe = /\*?\*?(AC-\d{3})\*?\*?/;

  for (const line of lines) {
    const cbMatch = line.match(checkboxRe);
    if (!cbMatch) continue;
    const checked = cbMatch[1].toLowerCase() === 'x';
    const rest = line.slice(cbMatch[0].length);

    const idMatch = rest.match(acIdRe);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Extract requirement IDs
    const reqIds = [];
    let m;
    const re = new RegExp(REQ_ID_RE.source, 'g');
    while ((m = re.exec(line)) !== null) {
      const fullId = `${m[1]}-${m[2]}`;
      if (!reqIds.includes(fullId)) reqIds.push(fullId);
    }

    // Extract tests: paths (backtick-wrapped, possibly multiple)
    const testPaths = [];
    const testsRe = /tests[：:]\s*(.+)/i;
    const testsMatch = line.match(testsRe);
    if (testsMatch) {
      const pathPart = testsMatch[1];
      const pathRe = /`([^`]+)`/g;
      let pm;
      while ((pm = pathRe.exec(pathPart)) !== null) {
        testPaths.push(pm[1]);
      }
    }

    result.push({ id, checked, reqIds, text: rest.trim(), testPaths });
  }
  return result;
}

/**
 * Parse requirement IDs defined in spec section 4.
 * Looks for patterns like **FR-001**, `FR-001`, ### Requirement: ... (`FR-001`)
 * Returns a Set of ID strings.
 */
export function parseRequirementIds(section4Content) {
  const stripped = stripCodeBlocks(section4Content);
  const ids = new Set();
  let m;
  const re = new RegExp(REQ_ID_RE.source, 'g');
  while ((m = re.exec(stripped)) !== null) {
    ids.add(`${m[1]}-${m[2]}`);
  }
  return ids;
}

/**
 * Parse task lines from tasks.md content (sections 2 and 3).
 * Returns array of { id, checked, isParallel, refIds, section, raw }.
 */
export function parseTaskLines(sectionContent) {
  const stripped = stripCodeBlocks(sectionContent);
  const lines = stripped.split('\n');
  const result = [];
  const checkboxRe = /^-\s+\[([ xX])\]\s+/;
  const taskIdRe = /\b(T\d{3})\b/;
  const parallelRe = /\[P\]/;

  for (const line of lines) {
    const cbMatch = line.match(checkboxRe);
    if (!cbMatch) continue;
    const checked = cbMatch[1].toLowerCase() === 'x';
    const rest = line.slice(cbMatch[0].length);

    const idMatch = rest.match(taskIdRe);
    if (!idMatch) continue;
    const id = idMatch[1];
    const isParallel = parallelRe.test(line);

    // Extract referenced IDs
    const refIds = [];
    let m;
    const idRe = /\b((?:FR|DR|TR|IR|UX|NFR|AC|US|DQ|Q)-\d{3})\b/g;
    while ((m = idRe.exec(line)) !== null) {
      if (!refIds.includes(m[1])) refIds.push(m[1]);
    }

    result.push({ id, checked, isParallel, refIds, raw: line.trim() });
  }
  return result;
}

/**
 * Check if a task line is an N/A item.
 * Format: - N/A: <reason>
 */
export function isNaItem(line) {
  const trimmed = line.trim();
  return /^-\s*N\/A[：:]\s*.+/.test(trimmed);
}

/**
 * Check if content represents "不适用：<reason>" (N/A with reason).
 */
export function isNaWithReason(content) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const firstLine = trimmed.split('\n').find((l) => l.trim().length > 0);
  if (!firstLine) return false;
  const m = firstLine.trim().match(/^不适用[：:]\s*(.+)$/);
  return m !== null && m[1].trim().length > 0;
}

/**
 * Check if an open-questions section is properly closed.
 * Returns { closed: boolean, reason?: string }.
 *
 * Closed means either:
 *   - Content is just "无"
 *   - Content has only [x] checkbox items (all closed)
 *
 * Not closed means:
 *   - Has [ ] items (open)
 *   - Has free-text bullets
 *   - Empty
 */
export function checkOpenQuestionsClosed(sectionText) {
  const stripped = stripCodeBlocks(sectionText);
  const trimmed = stripped.trim();

  if (trimmed === '无') return { closed: true };

  if (!trimmed) return { closed: false, reason: 'empty section' };

  const lines = trimmed.split('\n');
  const checkboxLines = [];
  const freeTextBullets = [];

  for (const line of lines) {
    const lt = line.trim();
    if (!lt) continue;
    if (/^-\s+\[[ xX]\]\s+/.test(lt)) {
      checkboxLines.push(lt);
    } else if (/^-\s+/.test(lt)) {
      freeTextBullets.push(lt);
    }
  }

  if (freeTextBullets.length > 0) {
    return { closed: false, reason: 'free-text bullets present' };
  }
  if (checkboxLines.length === 0) {
    return { closed: false, reason: 'no valid checkboxes and not 无' };
  }
  const openItems = checkboxLines.filter((l) => /^-\s+\[\s\]\s/.test(l));
  if (openItems.length > 0) {
    return { closed: false, reason: `${openItems.length} open item(s)` };
  }
  return { closed: true };
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Validate the syntax of a tests: path.
 * Returns { ok: boolean, reason?: string }.
 * Rejects: absolute paths, .. segments, glob characters.
 */
export function validateTestPathSyntax(rawPath) {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return { ok: false, reason: 'empty path' };
  }
  const p = rawPath.trim();

  // Reject absolute paths (Unix or Windows)
  if (isAbsolute(p)) {
    return { ok: false, reason: `absolute path: ${p}` };
  }

  // Reject glob characters
  if (/[*?\[\]{}]/.test(p)) {
    return { ok: false, reason: `glob character in path: ${p}` };
  }

  // Reject .. segments
  const parts = p.split(/[/\\]/);
  if (parts.includes('..')) {
    return { ok: false, reason: `.. escape in path: ${p}` };
  }

  return { ok: true };
}

/**
 * Resolve a test path against repo root and check it stays within root.
 * Returns { ok: boolean, resolved?: string, reason?: string }.
 * Does NOT check existence — use validateTestPathExistence for that.
 */
export function resolveTestPath(rawPath, repoRoot) {
  const syntax = validateTestPathSyntax(rawPath);
  if (!syntax.ok) return syntax;

  const resolved = resolve(repoRoot, rawPath);
  const rel = relative(repoRoot, resolved);

  // If the relative path starts with .. or is absolute, it escaped root
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: `path escapes repo root: ${rawPath}` };
  }

  return { ok: true, resolved };
}

/**
 * Check that a resolved test path is a real file.
 * Returns { ok: boolean, reason?: string }.
 */
export function validateTestPathExistence(rawPath, repoRoot) {
  const resolved = resolveTestPath(rawPath, repoRoot);
  if (!resolved.ok) return resolved;

  if (!existsSync(resolved.resolved)) {
    return { ok: false, reason: `file does not exist: ${rawPath}` };
  }
  const stat = statSync(resolved.resolved);
  if (!stat.isFile()) {
    return { ok: false, reason: `not a file (directory?): ${rawPath}` };
  }
  return { ok: true, resolved: resolved.resolved };
}

// ---------------------------------------------------------------------------
// Section heading comparison
// ---------------------------------------------------------------------------

/**
 * Compare actual sections against expected sections.
 * Returns array of error strings.
 */
export function compareSectionHeadings(actualSections, expectedSections, docName) {
  const errors = [];
  const actualByNum = new Map(actualSections.map((s) => [s.num, s]));

  for (const expected of expectedSections) {
    const actual = actualByNum.get(expected.num);
    if (!actual) {
      errors.push(
        `${docName}: missing section ${expected.num}. ${expected.title}`,
      );
      continue;
    }
    if (actual.title !== expected.title) {
      errors.push(
        `${docName}: section ${expected.num} title mismatch — expected "${expected.title}", got "${actual.title}"`,
      );
    }
  }

  // Check for extra sections
  for (const actual of actualSections) {
    if (!expectedSections.find((e) => e.num === actual.num)) {
      errors.push(`${docName}: unexpected section ${actual.num}. ${actual.title}`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// BACKLOG parsing
// ---------------------------------------------------------------------------

/**
 * Parse BACKLOG.md table rows.
 * Returns array of { id, version, name, status, owner, link }.
 */
export function parseBacklogRows(backlogText) {
  const normalized = normalizeLineEndings(backlogText);
  const lines = normalized.split('\n');
  const rows = [];
  let inTable = false;
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      // Skip separator rows
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        continue;
      }
      // Check if this looks like a header
      if (!headerSeen) {
        const lower = cells.map((c) => c.toLowerCase());
        if (lower.includes('id') && lower.includes('status')) {
          headerSeen = true;
          inTable = true;
          continue;
        }
      }
      if (inTable && cells.length >= 6) {
        // Extract link from backticks
        const linkMatch = cells[5].match(/`([^`]+)`/);
        const link = linkMatch ? linkMatch[1] : cells[5].replace(/[*`]/g, '');
        rows.push({
          id: cells[0].replace(/[*`]/g, ''),
          version: cells[1].replace(/[*`]/g, '').replace(/^["']|["']$/g, ''),
          name: cells[2],
          status: cells[3],
          owner: cells[4],
          link,
        });
      }
    } else {
      // End of table
      if (inTable && trimmed.length > 0 && !trimmed.startsWith('>')) {
        inTable = false;
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Feature discovery
// ---------------------------------------------------------------------------

/**
 * Discover Feature directories under docs/features/<version>/Fxxx-...
 * Excludes TEMPLATE/, releases/, version README.md.
 * Returns array of { dir, version, id } where dir is the absolute path.
 */
export function discoverFeatures(featuresRoot, repoRoot) {
  const features = [];
  if (!existsSync(featuresRoot)) return features;

  let versionDirs;
  try {
    versionDirs = readdirSync(featuresRoot).filter((name) => {
      if (name === 'TEMPLATE' || name === 'releases') return false;
      const full = join(featuresRoot, name);
      try {
        return statSync(full).isDirectory() && /^\d+\.\d+$/.test(name);
      } catch {
        return false;
      }
    });
  } catch {
    return features;
  }

  for (const version of versionDirs) {
    const versionDir = join(featuresRoot, version);
    let entries;
    try {
      entries = readdirSync(versionDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^F\d{3}-/.test(name)) continue;
      const featureDir = join(versionDir, name);
      try {
        if (!statSync(featureDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const id = name.match(/^(F\d{3})/)[1];
      features.push({ dir: featureDir, version, id, name });
    }
  }
  return features;
}

// ---------------------------------------------------------------------------
// Composite checks
// ---------------------------------------------------------------------------

/**
 * Read a file safely, returns string or null.
 */
function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if a blockquote line declares a Status field.
 * Matches "> Status: ..." (case-insensitive).
 */
export function hasBlockquoteStatus(text) {
  const normalized = normalizeLineEndings(text);
  const lines = normalized.split('\n');
  for (const line of lines) {
    const m = line.match(/^>\s*(?:\*?\*?Status\*?\*?)\s*[：:]\s*(.+)/i);
    if (m) return true;
  }
  return false;
}

/**
 * Run base checks on a single Feature directory.
 * Returns { errors: string[], warnings: string[], feature: object|null }.
 */
export function checkFeatureBase(featureDir, repoRoot) {
  const errors = [];
  const warnings = [];
  const relDir = relative(repoRoot, featureDir).replace(/\\/g, '/');

  // --- Trio complete ---
  const specPath = join(featureDir, 'spec.md');
  const designPath = join(featureDir, 'design.md');
  const tasksPath = join(featureDir, 'tasks.md');

  for (const [name, p] of [
    ['spec.md', specPath],
    ['design.md', designPath],
    ['tasks.md', tasksPath],
  ]) {
    if (!existsSync(p)) {
      errors.push(`${relDir}: missing ${name}`);
    }
  }

  const specText = readFileSafe(specPath);
  if (!specText) {
    return { errors, warnings, feature: null };
  }

  const { frontmatter: specFm } = parseFrontmatter(specText);
  if (!specFm) {
    errors.push(`${relDir}/spec.md: missing frontmatter`);
    return { errors, warnings, feature: null };
  }

  // --- kind, id, version, status, gate_version ---
  if (specFm.kind !== 'feature') {
    errors.push(
      `${relDir}/spec.md: frontmatter kind must be "feature", got ${JSON.stringify(specFm.kind)}`,
    );
  }

  const dirName = featureDir.split(sep).pop();
  const dirIdMatch = dirName.match(/^(F\d{3})/);
  const dirId = dirIdMatch ? dirIdMatch[1] : null;
  const versionDir = featureDir.split(sep).slice(-2, -1)[0];

  if (specFm.id && dirId && specFm.id !== dirId) {
    errors.push(
      `${relDir}/spec.md: frontmatter id "${specFm.id}" does not match directory "${dirId}"`,
    );
  }
  if (!specFm.id) {
    errors.push(`${relDir}/spec.md: frontmatter missing id`);
  }

  const fmVersion = String(specFm.version || '').replace(/^["']|["']$/g, '');
  if (fmVersion !== versionDir) {
    errors.push(
      `${relDir}/spec.md: frontmatter version "${fmVersion}" does not match directory version "${versionDir}"`,
    );
  }

  if (!LEGAL_STATUSES.includes(specFm.status)) {
    errors.push(
      `${relDir}/spec.md: illegal status "${specFm.status}" (must be one of: ${LEGAL_STATUSES.join(', ')})`,
    );
  }

  const gateVersion = typeof specFm.gate_version === 'number' ? specFm.gate_version : parseInt(specFm.gate_version, 10);
  if (!SUPPORTED_GATE_VERSIONS.includes(gateVersion)) {
    errors.push(
      `${relDir}/spec.md: illegal gate_version "${specFm.gate_version}" (must be one of: ${SUPPORTED_GATE_VERSIONS.join(', ')})`,
    );
  }

  // --- design.md / tasks.md must not declare independent Status ---
  const designText = readFileSafe(designPath);
  const tasksText = readFileSafe(tasksPath);

  if (designText) {
    const { frontmatter: designFm } = parseFrontmatter(designText);
    if (designFm && designFm.status !== undefined) {
      errors.push(`${relDir}/design.md: must not declare independent status in frontmatter`);
    }
    if (hasBlockquoteStatus(designText)) {
      errors.push(`${relDir}/design.md: must not declare Status in blockquote (spec.md is the single source of truth)`);
    }
  }

  if (tasksText) {
    const { frontmatter: tasksFm } = parseFrontmatter(tasksText);
    if (tasksFm && tasksFm.status !== undefined) {
      errors.push(`${relDir}/tasks.md: must not declare independent status in frontmatter`);
    }
    if (hasBlockquoteStatus(tasksText)) {
      errors.push(`${relDir}/tasks.md: must not declare Status in blockquote (spec.md is the single source of truth)`);
    }
  }

  const feature = {
    dir: featureDir,
    relDir,
    id: specFm.id || dirId,
    version: fmVersion || versionDir,
    status: specFm.status,
    gateVersion,
    specPath: relative(repoRoot, specPath).replace(/\\/g, '/'),
  };

  return { errors, warnings, feature };
}

/**
 * Run gate v1 additional checks on a Feature.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkFeatureGateV1(featureDir, repoRoot, baseFeature) {
  const errors = [];
  const warnings = [];
  const relDir = relative(repoRoot, featureDir).replace(/\\/g, '/');

  const specText = readFileSafe(join(featureDir, 'spec.md'));
  const designText = readFileSafe(join(featureDir, 'design.md'));
  const tasksText = readFileSafe(join(featureDir, 'tasks.md'));

  if (!specText || !designText || !tasksText) {
    errors.push(`${relDir}: cannot run gate v1 checks — missing trio`);
    return { errors, warnings };
  }

  const status = baseFeature?.status;
  const specSections = extractTopLevelSections(specText);
  const designSections = extractTopLevelSections(designText);
  const tasksSections = extractTopLevelSections(tasksText);

  // --- 1. Section heading comparison ---
  errors.push(...compareSectionHeadings(specSections, SPEC_SECTIONS, `${relDir}/spec.md`));
  errors.push(...compareSectionHeadings(designSections, DESIGN_SECTIONS, `${relDir}/design.md`));
  errors.push(...compareSectionHeadings(tasksSections, TASKS_SECTIONS, `${relDir}/tasks.md`));

  // --- design N/A sections must have reason ---
  for (const sec of designSections) {
    const content = sec.content.trim();
    if (content.startsWith('不适用')) {
      if (!isNaWithReason(content)) {
        errors.push(
          `${relDir}/design.md: section ${sec.num}. ${sec.title} marked 不适用 but missing reason`,
        );
      }
    }
  }

  // --- tasks Phase only under section 2 ---
  const stripped = stripCodeBlocks(tasksText);
  const taskLines = stripped.split('\n');

  const tasksSec2Idx = tasksSections.findIndex((s) => s.num === 2);
  const sec2Start = tasksSec2Idx >= 0 ? tasksSections[tasksSec2Idx].startLine : -1;
  const sec2End =
    tasksSec2Idx >= 0 && tasksSec2Idx + 1 < tasksSections.length
      ? tasksSections[tasksSec2Idx + 1].startLine
      : taskLines.length;

  for (let i = 0; i < taskLines.length; i++) {
    if (/^###\s+Phase\s/.test(taskLines[i].trim())) {
      if (i <= sec2Start || i >= sec2End) {
        errors.push(`${relDir}/tasks.md: Phase heading outside section 2 (line ${i + 1})`);
      }
    }
  }

  // --- task line format and ID references ---
  const sec2Content = tasksSec2Idx >= 0 ? tasksSections[tasksSec2Idx].content : '';
  const sec3Content = getSectionByNum(tasksSections, 3)?.content || '';

  const sec2Tasks = parseTaskLines(sec2Content);
  const sec3Tasks = parseTaskLines(sec3Content);
  const allTasks = [...sec2Tasks, ...sec3Tasks];

  // --- illegal task format: checkbox lines without Txxx in sections 2/3 ---
  for (const [secName, secContent] of [['section 2', sec2Content], ['section 3', sec3Content]]) {
    const secStripped = stripCodeBlocks(secContent);
    const secLines = secStripped.split('\n');
    const checkboxRe = /^-\s+\[([ xX])\]\s+(.+)$/;
    for (let i = 0; i < secLines.length; i++) {
      const m = secLines[i].match(checkboxRe);
      if (!m) continue;
      const rest = m[2];
      if (/^N\/A[：:]/.test(rest.trim())) continue;
      if (!/\bT\d{3}\b/.test(rest)) {
        errors.push(
          `${relDir}/tasks.md: ${secName} checkbox line without Txxx ID (line ${i + 1}): ${secLines[i].trim()}`,
        );
      }
    }
  }

  // Check task ID uniqueness
  const taskIds = new Set();
  for (const task of allTasks) {
    if (taskIds.has(task.id)) {
      errors.push(`${relDir}/tasks.md: duplicate task ID ${task.id}`);
    }
    taskIds.add(task.id);
  }

  // --- [P] task declaring pre-dependency (section 4) ---
  const sec4Content = getSectionByNum(tasksSections, 4)?.content || '';
  const sec4Lines = sec4Content.split('\n');
  const parallelTaskIds = new Set(
    allTasks.filter((t) => t.isParallel).map((t) => t.id),
  );
  for (const line of sec4Lines) {
    const trimmed = line.trim();
    // Check for lines that have both [P] and -> (direct violation)
    if (/\[P\]/.test(trimmed) && /->/.test(trimmed)) {
      errors.push(`${relDir}/tasks.md: [P] task declaring pre-dependency: ${trimmed}`);
    }
    // Check for dependency edges involving [P] tasks
    const edgeMatch = trimmed.match(/(?:^|\s)(T\d{3})\s*->\s*(T\d{3})/);
    if (edgeMatch) {
      const [, from, to] = edgeMatch;
      if (parallelTaskIds.has(from) || parallelTaskIds.has(to)) {
        errors.push(
          `${relDir}/tasks.md: [P] task ${parallelTaskIds.has(from) ? from : to} appears in dependency edge: ${trimmed}`,
        );
      }
    }
  }

  // --- Parse requirement IDs from spec section 4 ---
  const specSec4 = getSectionByNum(specSections, 4);
  const definedReqIds = specSec4 ? parseRequirementIds(specSec4.content) : new Set();

  // --- Parse AC lines from spec section 6 ---
  const specSec6 = getSectionByNum(specSections, 6);
  const acLines = specSec6 ? parseAcLines(specSec6.content) : [];

  // --- AC uniqueness ---
  const acIds = new Set();
  for (const ac of acLines) {
    if (acIds.has(ac.id)) {
      errors.push(`${relDir}/spec.md: duplicate AC ID ${ac.id}`);
    }
    acIds.add(ac.id);
  }

  // --- AC must reference at least one defined requirement ID ---
  for (const ac of acLines) {
    if (ac.reqIds.length === 0) {
      errors.push(`${relDir}/spec.md: ${ac.id} does not reference any requirement ID`);
    } else {
      const undefined = ac.reqIds.filter((id) => !definedReqIds.has(id));
      if (undefined.length > 0) {
        errors.push(
          `${relDir}/spec.md: ${ac.id} references undefined requirement ID(s): ${undefined.join(', ')}`,
        );
      }
    }
  }

  // --- tests: path validation (review/done states) ---
  if (status === 'review' || status === 'done') {
    for (const ac of acLines) {
      if (ac.testPaths.length === 0) {
        errors.push(
          `${relDir}/spec.md: ${ac.id} missing tests: path (required for ${status} state)`,
        );
      } else {
        for (const tp of ac.testPaths) {
          const result = validateTestPathExistence(tp, repoRoot);
          if (!result.ok) {
            errors.push(`${relDir}/spec.md: ${ac.id} tests path — ${result.reason}`);
          }
        }
      }
    }
  }

  // --- done state checks ---
  if (status === 'done') {
    // tasks sections 2 and 3 must be non-empty and all [x]
    if (sec2Tasks.length === 0) {
      errors.push(`${relDir}/tasks.md: section 2 has no tasks (required for done)`);
    }
    if (sec3Tasks.length === 0) {
      errors.push(`${relDir}/tasks.md: section 3 has no tasks (required for done)`);
    }
    for (const task of allTasks) {
      if (!task.checked) {
        errors.push(`${relDir}/tasks.md: ${task.id} is unchecked (required for done)`);
      }
    }

    // AC list must be non-empty and all [x]
    if (acLines.length === 0) {
      errors.push(`${relDir}/spec.md: acceptance list is empty (required for done)`);
    }
    for (const ac of acLines) {
      if (!ac.checked) {
        errors.push(`${relDir}/spec.md: ${ac.id} is unchecked (required for done)`);
      }
    }

    // Checked tasks must not contain incomplete markers
    for (const task of allTasks) {
      if (task.checked) {
        const lower = task.raw.toLowerCase();
        for (const marker of INCOMPLETE_MARKERS) {
          const markerLower = marker.toLowerCase();
          if (lower.includes(markerLower)) {
            errors.push(
              `${relDir}/tasks.md: ${task.id} is checked but contains incomplete marker "${marker}"`,
            );
            break;
          }
        }
      }
    }
  }

  // --- open questions check (ready-for-development and above) ---
  const needsClosedQuestions = [
    'ready-for-development',
    'in-progress',
    'review',
    'done',
  ].includes(status);

  if (needsClosedQuestions) {
    const specSec8 = getSectionByNum(specSections, 8);
    if (!specSec8) {
      errors.push(`${relDir}/spec.md: missing section 8. 待确认问题`);
    } else {
      const result = checkOpenQuestionsClosed(specSec8.content);
      if (!result.closed) {
        errors.push(
          `${relDir}/spec.md: section 8. 待确认问题 not closed — ${result.reason}`,
        );
      }
    }

    const designSec10 = getSectionByNum(designSections, 10);
    if (!designSec10) {
      errors.push(`${relDir}/design.md: missing section 10. 待确认设计问题`);
    } else {
      const result = checkOpenQuestionsClosed(designSec10.content);
      if (!result.closed) {
        errors.push(
          `${relDir}/design.md: section 10. 待确认设计问题 not closed — ${result.reason}`,
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check BACKLOG bidirectional consistency.
 * @param {Array} features — array of feature objects from checkFeatureBase
 * @param {string} backlogText — BACKLOG.md content
 * @param {string} repoRoot — repo root path
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkBacklogConsistency(features, backlogText, repoRoot) {
  const errors = [];
  const warnings = [];

  if (!backlogText) {
    errors.push('BACKLOG.md: missing or unreadable');
    return { errors, warnings };
  }

  const rows = parseBacklogRows(backlogText);

  // Build maps
  const featuresById = new Map();
  for (const f of features) {
    if (f.id) {
      if (!featuresById.has(f.id)) {
        featuresById.set(f.id, []);
      }
      featuresById.get(f.id).push(f);
    }
  }

  const rowsById = new Map();
  for (const row of rows) {
    if (!rowsById.has(row.id)) {
      rowsById.set(row.id, []);
    }
    rowsById.get(row.id).push(row);
  }

  // Check: non-done features must be in BACKLOG exactly once
  for (const f of features) {
    if (!f.id) continue;
    const rowList = rowsById.get(f.id) || [];
    if (f.status === 'done') {
      if (rowList.length > 0) {
        errors.push(
          `BACKLOG.md: done Feature ${f.id} must not remain in active table`,
        );
      }
    } else {
      if (rowList.length === 0) {
        errors.push(
          `BACKLOG.md: missing row for non-done Feature ${f.id} (status: ${f.status})`,
        );
      } else if (rowList.length > 1) {
        errors.push(
          `BACKLOG.md: duplicate rows for Feature ${f.id} (${rowList.length} occurrences)`,
        );
      } else {
        const row = rowList[0];
        // Check version
        if (String(row.version) !== String(f.version)) {
          errors.push(
            `BACKLOG.md: ${f.id} version mismatch — BACKLOG "${row.version}", spec "${f.version}"`,
          );
        }
        // Check status
        if (row.status !== f.status) {
          errors.push(
            `BACKLOG.md: ${f.id} status mismatch — BACKLOG "${row.status}", spec "${f.status}"`,
          );
        }
        // Check link
        const expectedLink = f.specPath;
        if (row.link !== expectedLink) {
          errors.push(
            `BACKLOG.md: ${f.id} link mismatch — BACKLOG "${row.link}", expected "${expectedLink}"`,
          );
        }
        // Check link exists
        const linkPath = join(repoRoot, row.link);
        if (!existsSync(linkPath)) {
          errors.push(`BACKLOG.md: ${f.id} broken link — ${row.link} does not exist`);
        }
      }
    }
  }

  // Check: BACKLOG rows must correspond to a non-done feature
  for (const row of rows) {
    const featureList = featuresById.get(row.id) || [];
    if (featureList.length === 0) {
      errors.push(
        `BACKLOG.md: row ${row.id} has no corresponding Feature directory`,
      );
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Top-level check
// ---------------------------------------------------------------------------

/**
 * Check all Features in a repo.
 * @param {string} repoRoot — absolute path to repo root
 * Returns { errors: string[], warnings: string[], features: object[] }.
 */
export function checkAllFeatures(repoRoot) {
  const allErrors = [];
  const allWarnings = [];
  const featuresRoot = join(repoRoot, 'docs', 'features');
  const discovered = discoverFeatures(featuresRoot, repoRoot);

  const features = [];

  // --- ID uniqueness across versions ---
  const idMap = new Map();
  for (const d of discovered) {
    if (!idMap.has(d.id)) idMap.set(d.id, []);
    idMap.get(d.id).push(d);
  }
  for (const [id, list] of idMap) {
    if (list.length > 1) {
      for (const d of list) {
        allErrors.push(
          `${relative(repoRoot, d.dir).replace(/\\/g, '/')}: duplicate Feature ID ${id} (also in ${list
            .filter((x) => x !== d)
            .map((x) => relative(repoRoot, x.dir).replace(/\\/g, '/'))
            .join(', ')})`,
        );
      }
    }
  }

  // --- Base checks ---
  for (const d of discovered) {
    const result = checkFeatureBase(d.dir, repoRoot);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
    if (result.feature) {
      features.push(result.feature);
    }
  }

  // --- Gate v1 checks ---
  for (const d of discovered) {
    const baseResult = features.find(
      (f) => f.dir === d.dir || f.relDir === relative(repoRoot, d.dir).replace(/\\/g, '/'),
    );
    if (!baseResult) continue;
    if (baseResult.gateVersion === 1) {
      const v1Result = checkFeatureGateV1(d.dir, repoRoot, baseResult);
      allErrors.push(...v1Result.errors);
      allWarnings.push(...v1Result.warnings);
    }
  }

  // --- BACKLOG consistency ---
  const backlogPath = join(repoRoot, 'BACKLOG.md');
  const backlogText = readFileSafe(backlogPath);
  if (backlogText) {
    const backlogResult = checkBacklogConsistency(features, backlogText, repoRoot);
    allErrors.push(...backlogResult.errors);
    allWarnings.push(...backlogResult.warnings);
  } else {
    allErrors.push('BACKLOG.md: missing or unreadable');
  }

  return { errors: allErrors, warnings: allWarnings, features };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli() {
  const repoRoot = resolve(process.cwd());
  const { errors, warnings } = checkAllFeatures(repoRoot);

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`  WARN  ${w}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\nFeature gate check FAILED — ${errors.length} error(s):\n`);
    for (const e of errors) {
      console.error(`  FAIL  ${e}`);
    }
    process.exit(1);
  }

  console.error('Feature gate check PASSED — all features OK.');
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
