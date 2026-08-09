// tools/check-doc-links.mjs
// Validates in-repo Markdown links: target existence, anchors, path boundaries.
// Zero runtime dependencies - only node built-ins.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Pure text utilities
// ---------------------------------------------------------------------------

export function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Strip fenced code blocks so that links inside them are ignored.
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
 * Parse Markdown links from text (code blocks stripped).
 * Returns array of { text, target, line }.
 * Skips http/https/mailto links and autolinks.
 */
export function parseMarkdownLinks(text) {
  const stripped = stripCodeBlocks(text);
  const lines = stripped.split('\n');
  const links = [];
  // Match [text](target) but not ![alt](image) or http/https/mailto
  const linkRe = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    let m;
    const re = new RegExp(linkRe.source, 'g');
    while ((m = re.exec(lines[i])) !== null) {
      const target = m[2].trim();
      // Skip external links
      if (/^(https?:|mailto:|tel:|ftp:)/i.test(target)) continue;
      links.push({
        text: m[1],
        target,
        line: i + 1,
      });
    }
  }
  return links;
}

/**
 * Normalize a heading text to a GitHub-style anchor.
 * Lowercase, remove punctuation, replace spaces with hyphens.
 */
export function normalizeAnchor(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract heading anchors from Markdown text.
 * Returns a Set of anchor strings.
 */
export function parseHeadingAnchors(text) {
  const stripped = stripCodeBlocks(text);
  const lines = stripped.split('\n');
  const anchors = new Set();
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/;

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      const anchor = normalizeAnchor(m[2]);
      if (anchor) anchors.add(anchor);
    }
  }
  return anchors;
}

/**
 * Split a link target into path and anchor parts.
 * "path/to/file.md#section" -> { path: "path/to/file.md", anchor: "section" }
 * "#section" -> { path: "", anchor: "section" }
 * "path/to/file.md" -> { path: "path/to/file.md", anchor: "" }
 */
export function splitLinkTarget(target) {
  const hashIdx = target.indexOf('#');
  if (hashIdx === -1) {
    return { path: target, anchor: '' };
  }
  return {
    path: target.slice(0, hashIdx),
    anchor: target.slice(hashIdx + 1),
  };
}

/**
 * Validate that a link path stays within repo root.
 * Returns { ok: boolean, reason?: string }.
 */
export function validateLinkPathBoundary(rawPath) {
  if (!rawPath) return { ok: true }; // anchor-only link
  const p = rawPath.trim();
  if (isAbsolute(p)) {
    return { ok: false, reason: `absolute path: ${p}` };
  }
  const parts = p.split(/[/\\]/);
  if (parts.includes('..')) {
    return { ok: false, reason: `.. escape in path: ${p}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// File-level checks
// ---------------------------------------------------------------------------

/**
 * Check all Markdown links in a single file.
 * @param {string} filePath - absolute path to the Markdown file
 * @param {string} repoRoot - absolute path to repo root
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkLinksInFile(filePath, repoRoot) {
  const errors = [];
  const warnings = [];
  const text = readFileSync(filePath, 'utf-8');
  const relFile = relative(repoRoot, filePath).replace(/\\/g, '/');
  const links = parseMarkdownLinks(text);
  const fileDir = dirname(filePath);

  for (const link of links) {
    const { path: linkPath, anchor } = splitLinkTarget(link.target);

    // Skip empty links
    if (!linkPath && !anchor) {
      errors.push(`${relFile}:${link.line}: empty link`);
      continue;
    }

    // Anchor-only link (same file)
    if (!linkPath) {
      if (anchor) {
        const fileAnchors = parseHeadingAnchors(text);
        if (!fileAnchors.has(anchor)) {
          errors.push(`${relFile}:${link.line}: broken anchor #${anchor}`);
        }
      }
      continue;
    }

    // Path boundary check
    const boundary = validateLinkPathBoundary(linkPath);
    if (!boundary.ok) {
      errors.push(`${relFile}:${link.line}: ${boundary.reason}`);
      continue;
    }

    // Resolve target
    const targetPath = resolve(fileDir, linkPath);
    const relTarget = relative(repoRoot, targetPath).replace(/\\/g, '/');

    // Check existence
    if (!existsSync(targetPath)) {
      errors.push(`${relFile}:${link.line}: broken link - ${linkPath} does not exist`);
      continue;
    }

    // If anchor and target is a Markdown file, check anchor
    if (anchor && extname(targetPath).toLowerCase() === '.md') {
      const targetText = readFileSync(targetPath, 'utf-8');
      const targetAnchors = parseHeadingAnchors(targetText);
      if (!targetAnchors.has(anchor)) {
        errors.push(`${relFile}:${link.line}: broken anchor #${anchor} in ${relTarget}`);
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Directory traversal
// ---------------------------------------------------------------------------

/**
 * Find all Markdown files under a directory, recursively.
 * Excludes node_modules, .git, .local.
 */
export function findMarkdownFiles(rootDir, excludeDirs = ['node_modules', '.git', '.local']) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(rootDir);
  } catch {
    return results;
  }
  for (const name of entries) {
    if (excludeDirs.includes(name)) continue;
    const full = join(rootDir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      results.push(...findMarkdownFiles(full, excludeDirs));
    } else if (st.isFile() && extname(name).toLowerCase() === '.md') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Check all Markdown links in the repo.
 * @param {string} repoRoot - absolute path to repo root
 * @param {string[]} searchDirs - dirs to search (relative to repoRoot), default ['docs']
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkAllDocLinks(repoRoot, searchDirs = ['docs']) {
  const allErrors = [];
  const allWarnings = [];

  for (const dir of searchDirs) {
    const absDir = join(repoRoot, dir);
    if (!existsSync(absDir)) continue;
    const files = findMarkdownFiles(absDir);
    for (const file of files) {
      const result = checkLinksInFile(file, repoRoot);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }
  }

  // Also check root-level Markdown files
  let rootEntries;
  try {
    rootEntries = readdirSync(repoRoot);
  } catch {
    rootEntries = [];
  }
  for (const name of rootEntries) {
    if (extname(name).toLowerCase() !== '.md') continue;
    const full = join(repoRoot, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const result = checkLinksInFile(full, repoRoot);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return { errors: allErrors, warnings: allWarnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli() {
  const repoRoot = resolve(process.cwd());
  const { errors, warnings } = checkAllDocLinks(repoRoot);

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`  WARN  ${w}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\nDoc link check FAILED - ${errors.length} error(s):\n`);
    for (const e of errors) {
      console.error(`  FAIL  ${e}`);
    }
    process.exit(1);
  }

  console.error('Doc link check PASSED - all links OK.');
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
