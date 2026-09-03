// tools/check-docs.test.mjs
// node:test zero-dependency tests for check-doc-links.mjs and check-doc-ownership.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseMarkdownLinks,
  normalizeAnchor,
  parseHeadingAnchors,
  splitLinkTarget,
  validateLinkPathBoundary,
  stripCodeBlocks,
  checkLinksInFile,
  findMarkdownFiles,
  checkAllDocLinks,
} from './check-doc-links.mjs';

import {
  findFrontmatterStatus,
  findBlockquoteStatusDeclarations,
  checkStatusOwnership,
  checkBacklogOwnership,
  checkAuthoritativeEntries,
  checkReleaseNotTruthSource,
  checkAllOwnership,
} from './check-doc-ownership.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ph-docs-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function writeDoc(repoRoot, relPath, content) {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function writeFeature(repoRoot, version, id, name, { spec, design, tasks } = {}) {
  const dir = join(repoRoot, 'docs', 'features', version, `${id}-${name}`);
  mkdirSync(dir, { recursive: true });
  const fm = `---
kind: feature
id: ${id}
version: "${version}"
status: ${spec?.status || 'draft'}
gate_version: 0
---`;
  writeFileSync(join(dir, 'spec.md'), spec?.content || `${fm}\n\n# ${id}\n`, 'utf-8');
  writeFileSync(join(dir, 'design.md'), design?.content || `---
kind: feature
id: ${id}
version: "${version}"
doc_kind: design
---

# ${id} design
`, 'utf-8');
  writeFileSync(join(dir, 'tasks.md'), tasks?.content || `---
kind: feature
id: ${id}
version: "${version}"
doc_kind: tasks
---

# ${id} tasks
`, 'utf-8');
  return dir;
}

function writeBacklog(repoRoot, rows) {
  let text = `---
topics: [backlog]
---

# Feature Roadmap

| ID | Version | Name | Status | Owner | Link |
|----|---------|------|--------|-------|------|
`;
  for (const row of rows) {
    text += `| ${row.id} | ${row.version} | ${row.name || 'Test'} | ${row.status} | ${row.owner || 'TBD'} | \`${row.link}\` |\n`;
  }
  writeFileSync(join(repoRoot, 'BACKLOG.md'), text, 'utf-8');
}

// ---------------------------------------------------------------------------
// Pure function tests: check-doc-links
// ---------------------------------------------------------------------------

test('parseMarkdownLinks', async (t) => {
  await t.test('parses standard links', () => {
    const text = 'see [example](path/to/file.md) for details';
    const links = parseMarkdownLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].text, 'example');
    assert.equal(links[0].target, 'path/to/file.md');
  });

  await t.test('skips http links', () => {
    const text = '[external](https://example.com)';
    const links = parseMarkdownLinks(text);
    assert.equal(links.length, 0);
  });

  await t.test('skips image links', () => {
    const text = '![alt](image.png)';
    const links = parseMarkdownLinks(text);
    assert.equal(links.length, 0);
  });

  await t.test('skips links in code blocks', () => {
    const text = '```\n[fake](link.md)\n```\n[real](real.md)';
    const links = parseMarkdownLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'real.md');
  });

  await t.test('parses links with anchors', () => {
    const text = '[section](file.md#heading)';
    const links = parseMarkdownLinks(text);
    assert.equal(links[0].target, 'file.md#heading');
  });
});

test('normalizeAnchor', async (t) => {
  await t.test('lowercases and hyphenates', () => {
    assert.equal(normalizeAnchor('Hello World'), 'hello-world');
  });

  await t.test('removes punctuation', () => {
    assert.equal(normalizeAnchor('Section: Title!'), 'section-title');
  });

  await t.test('handles unicode', () => {
    const result = normalizeAnchor('章节 标题');
    assert.ok(result.length > 0);
  });
});

test('parseHeadingAnchors', async (t) => {
  await t.test('extracts heading anchors', () => {
    const text = '# Title\n\n## Section One\n\n### Sub Section\n';
    const anchors = parseHeadingAnchors(text);
    assert.ok(anchors.has('title'));
    assert.ok(anchors.has('section-one'));
    assert.ok(anchors.has('sub-section'));
  });

  await t.test('ignores headings in code blocks', () => {
    const text = '```\n## Fake\n```\n## Real';
    const anchors = parseHeadingAnchors(text);
    assert.ok(!anchors.has('fake'));
    assert.ok(anchors.has('real'));
  });
});

test('splitLinkTarget', async (t) => {
  await t.test('splits path and anchor', () => {
    const result = splitLinkTarget('path/file.md#section');
    assert.equal(result.path, 'path/file.md');
    assert.equal(result.anchor, 'section');
  });

  await t.test('anchor-only link', () => {
    const result = splitLinkTarget('#section');
    assert.equal(result.path, '');
    assert.equal(result.anchor, 'section');
  });

  await t.test('path only', () => {
    const result = splitLinkTarget('path/file.md');
    assert.equal(result.path, 'path/file.md');
    assert.equal(result.anchor, '');
  });
});

test('validateLinkPathBoundary', async (t) => {
  await t.test('legal relative path', () => {
    assert.equal(validateLinkPathBoundary('docs/readme.md').ok, true);
  });

  await t.test('rejects absolute path', () => {
    assert.equal(validateLinkPathBoundary('/etc/passwd').ok, false);
  });

  // BUG-006: the verdict must be the same on every host, so both path flavours
  // are asserted here rather than only the one this machine happens to run.
  await t.test('rejects Windows absolute path', () => {
    assert.equal(validateLinkPathBoundary('C:\\Users\\test').ok, false);
  });

  await t.test('rejects .. escape', () => {
    assert.equal(validateLinkPathBoundary('../escape.md').ok, false);
  });

  await t.test('empty path is ok (anchor-only)', () => {
    assert.equal(validateLinkPathBoundary('').ok, true);
  });
});

// ---------------------------------------------------------------------------
// File-level link check tests
// ---------------------------------------------------------------------------

test('checkLinksInFile', async (t) => {
  await t.test('valid internal link passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](b.md)');
      writeDoc(repo, 'docs/b.md', '# B');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('broken link fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](nonexistent.md)');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.ok(result.errors.some((e) => e.includes('broken link')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('valid anchor passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](b.md#section)');
      writeDoc(repo, 'docs/b.md', '# Section\n\ncontent');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('broken anchor fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](b.md#missing)');
      writeDoc(repo, 'docs/b.md', '# Real Section');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.ok(result.errors.some((e) => e.includes('broken anchor')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('absolute path fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](/absolute/path.md)');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.ok(result.errors.some((e) => e.includes('absolute')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('.. escape fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](../escape.md)');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.ok(result.errors.some((e) => e.includes('escape') || e.includes('absolute')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('same-file anchor link', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '# Title\n\n[link](#title)');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('http links are skipped', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[external](https://example.com)');
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.equal(result.errors.length, 0);
    } finally {
      cleanup(repo);
    }
  });

  await t.test('CRLF docs work', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[link](b.md)\r\n'.replace(/\n/g, '\r\n'));
      writeDoc(repo, 'docs/b.md', '# B\r\n'.replace(/\n/g, '\r\n'));
      const result = checkLinksInFile(join(repo, 'docs', 'a.md'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });
});

test('findMarkdownFiles', async (t) => {
  await t.test('finds .md files recursively', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', 'a');
      writeDoc(repo, 'docs/sub/b.md', 'b');
      const files = findMarkdownFiles(join(repo, 'docs'));
      assert.ok(files.some((f) => f.endsWith('a.md')));
      assert.ok(files.some((f) => f.endsWith('b.md')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('excludes node_modules', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', 'a');
      mkdirSync(join(repo, 'docs', 'node_modules'), { recursive: true });
      writeDoc(repo, 'docs/node_modules/skip.md', 'skip');
      const files = findMarkdownFiles(join(repo, 'docs'));
      assert.ok(!files.some((f) => f.endsWith('skip.md')));
    } finally {
      cleanup(repo);
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership check tests
// ---------------------------------------------------------------------------

test('findFrontmatterStatus', async (t) => {
  await t.test('finds status in frontmatter', () => {
    const text = `---
status: done
kind: feature
---
body`;
    const result = findFrontmatterStatus(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].value, 'done');
  });

  await t.test('returns empty for no status', () => {
    const text = `---
kind: feature
---
body`;
    const result = findFrontmatterStatus(text);
    assert.equal(result.length, 0);
  });
});

test('findBlockquoteStatusDeclarations', async (t) => {
  await t.test('finds > Status: line', () => {
    const text = '> Status: done | Owner: TBD';
    const result = findBlockquoteStatusDeclarations(text);
    assert.equal(result.length, 1);
  });

  await t.test('returns empty for no status', () => {
    const text = '> Owner: TBD';
    const result = findBlockquoteStatusDeclarations(text);
    assert.equal(result.length, 0);
  });
});

test('checkStatusOwnership', async (t) => {
  await t.test('design.md with status in blockquote fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test', {
        design: {
          content: `---
kind: feature
id: F001
version: "0.1"
doc_kind: design
---

# F001 design

> Status: done | Owner: TBD

## content
`,
        },
      });
      const result = checkStatusOwnership(join(repo, 'docs', 'features'), repo);
      assert.ok(result.errors.some((e) => e.includes('design.md') && e.includes('Status')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('tasks.md with status in frontmatter fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test', {
        tasks: {
          content: `---
kind: feature
id: F001
version: "0.1"
status: done
doc_kind: tasks
---

# F001 tasks
`,
        },
      });
      const result = checkStatusOwnership(join(repo, 'docs', 'features'), repo);
      assert.ok(result.errors.some((e) => e.includes('tasks.md') && e.includes('status')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('clean design/tasks pass', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test');
      const result = checkStatusOwnership(join(repo, 'docs', 'features'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });
});

test('checkBacklogOwnership', async (t) => {
  await t.test('consistent BACKLOG passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test', {
        spec: { status: 'draft', content: `---
kind: feature
id: F001
version: "0.1"
status: draft
gate_version: 0
---

# F001
` },
      });
      writeBacklog(repo, [
        { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/F001-test/spec.md' },
      ]);
      const result = checkBacklogOwnership(join(repo, 'docs', 'features'), repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('missing BACKLOG row fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test', {
        spec: { status: 'draft', content: `---
kind: feature
id: F001
version: "0.1"
status: draft
gate_version: 0
---

# F001
` },
      });
      writeBacklog(repo, []);
      const result = checkBacklogOwnership(join(repo, 'docs', 'features'), repo);
      assert.ok(result.errors.some((e) => e.includes('missing row')));
    } finally {
      cleanup(repo);
    }
  });
});

test('checkAuthoritativeEntries', async (t) => {
  await t.test('missing docs fail', async () => {
    let repo;
    try {
      repo = createTempRepo();
      const result = checkAuthoritativeEntries(repo);
      assert.ok(result.errors.some((e) => e.includes('Authoritative entry missing')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('all entries present passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      // Create all required files
      writeDoc(repo, 'docs/personahub-prd.md', '# PRD');
      writeDoc(repo, 'docs/personahub-architecture.md', '# Arch');
      writeDoc(repo, 'docs/personahub-system-design.md', '# Design');
      mkdirSync(join(repo, 'docs', 'decisions'), { recursive: true });
      writeDoc(repo, 'docs/SOP.md', '# SOP');
      writeDoc(repo, 'docs/README.md', '# Docs Map\nownership matrix');
      writeDoc(repo, 'BACKLOG.md', '# Backlog');
      writeDoc(repo, 'CLAUDE.md', '# Claude');
      mkdirSync(join(repo, 'docs', 'reviews'), { recursive: true });
      writeDoc(repo, 'docs/reviews/RETROSPECTIVE.md', '# Retro');
      writeDoc(repo, 'docs/reviews/self-test-system-plan.md', '# Self-test');
      const result = checkAuthoritativeEntries(repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });
});

test('checkReleaseNotTruthSource', async (t) => {
  await t.test('release declared as truth source fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/README.md', '# Docs\nreleases/ is the source of truth for product decisions');
      writeDoc(repo, 'CLAUDE.md', '# Claude');
      const result = checkReleaseNotTruthSource(repo);
      assert.ok(result.errors.some((e) => e.includes('releases/') && e.includes('truth source')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('RETROSPECTIVE declared as truth source fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/README.md', '# Docs');
      writeDoc(repo, 'CLAUDE.md', '# Claude\nRETROSPECTIVE.md is the single source of truth for defects');
      const result = checkReleaseNotTruthSource(repo);
      assert.ok(result.errors.some((e) => e.includes('RETROSPECTIVE')));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('no truth source declarations passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/README.md', '# Docs\nno truth source claims here');
      writeDoc(repo, 'CLAUDE.md', '# Claude\njust normal content');
      const result = checkReleaseNotTruthSource(repo);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });
});

test('checkAllDocLinks: integration', async (t) => {
  await t.test('clean repo passes', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '# A\n\n[link to b](b.md)');
      writeDoc(repo, 'docs/b.md', '# B\n\n[back to a](a.md)');
      const result = checkAllDocLinks(repo, ['docs']);
      assert.equal(result.errors.length, 0, result.errors.join('\n'));
    } finally {
      cleanup(repo);
    }
  });

  await t.test('broken link in docs fails', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeDoc(repo, 'docs/a.md', '[broken](nonexistent.md)');
      const result = checkAllDocLinks(repo, ['docs']);
      assert.ok(result.errors.some((e) => e.includes('broken link')));
    } finally {
      cleanup(repo);
    }
  });
});

test('checkAllOwnership: integration', async (t) => {
  await t.test('status in design.md fails ownership check', async () => {
    let repo;
    try {
      repo = createTempRepo();
      writeFeature(repo, '0.1', 'F001', 'test', {
        design: {
          content: `---
kind: feature
id: F001
version: "0.1"
doc_kind: design
---

# F001 design

> Status: done | Owner: TBD
`,
        },
      });
      const result = checkAllOwnership(repo);
      assert.ok(result.errors.some((e) => e.includes('design.md') && e.includes('Status')));
    } finally {
      cleanup(repo);
    }
  });
});
