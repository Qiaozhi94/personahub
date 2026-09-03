// tools/check-feature-gates.test.mjs
// node:test zero-dependency tests for check-feature-gates.mjs
// Tests construct fixtures in temp directories; never modify real docs/features/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkEvalContract,
  parseEvalContractFields,
  EVAL_CONTRACT_FIELDS,
  parseFrontmatter,
  stripCodeBlocks,
  normalizeLineEndings,
  extractTopLevelSections,
  getSectionByNum,
  extractSubSections,
  extractCheckboxes,
  parseAcLines,
  parseRequirementIds,
  parseTaskLines,
  isNaWithReason,
  isNaItem,
  checkOpenQuestionsClosed,
  validateTestPathSyntax,
  resolveTestPath,
  validateTestPathExistence,
  compareSectionHeadings,
  parseBacklogRows,
  hasBlockquoteStatus,
  discoverFeatures,
  checkFeatureBase,
  checkFeatureGateV1,
  checkBacklogConsistency,
  checkAllFeatures,
  SPEC_SECTIONS,
  DESIGN_SECTIONS,
  TASKS_SECTIONS,
} from './check-feature-gates.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ph-gate-'));
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

function writeFeature(repoRoot, version, id, name, { spec, design, tasks } = {}) {
  const dir = join(repoRoot, 'docs', 'features', version, `${id}-${name}`);
  mkdirSync(dir, { recursive: true });
  if (spec !== null) writeFileSync(join(dir, 'spec.md'), spec ?? makeSpec({ id, version }), 'utf-8');
  if (design !== null) writeFileSync(join(dir, 'design.md'), design ?? makeDesign({ id, version }), 'utf-8');
  if (tasks !== null) writeFileSync(join(dir, 'tasks.md'), tasks ?? makeTasks({ id, version }), 'utf-8');
  return dir;
}

function writeTestFile(repoRoot, relPath) {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, '// dummy test file\n', 'utf-8');
}

function writeBacklog(repoRoot, rows) {
  let text = `---
topics: [backlog]
doc_kind: note
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

function makeSpec(opts = {}) {
  const {
    id = 'F001',
    version = '0.1',
    status = 'draft',
    gateVersion = 1,
    sec0 = '- intent',
    sec4 = defaultSec4(),
    sec6 = defaultSec6(),
    sec8 = '无',
    extraFrontmatter = '',
    body = null,
  } = opts;

  if (body !== null) return body;

  return `---
kind: feature
id: ${id}
version: "${version}"
status: ${status}
gate_version: ${gateVersion}
updated: 2026-08-09
${extraFrontmatter}---

# ${id}：Test Feature

> Owner: TBD | Target: v${version}

## 0. 来源与意图

${sec0}

## 1. 问题、目标与非目标

### 问题
problem

### 目标
goal

### 非目标
- non-goal

## 2. 用户场景

### US-001：场景（Priority: P1）
text

## 3. 范围与边界

### 范围内
- item

### 范围外
- item

### 边界场景
- item

## 4. 需求

${sec4}

## 5. 生命周期与不变量

不适用：minimal test feature

## 6. 成功与验收

### 成功标准

- **SC-001**：...

### 验收清单

${sec6}

## 7. 测试、依赖与决策

### 测试策略
- unit

### 依赖
- none

### 决策与风险
| 决策 | 结论 | 理由 | 后续 |
|---|---|---|---|

## 8. 待确认问题

${sec8}
`;
}

function defaultSec4() {
  return `### 功能需求

### Requirement: 需求（\`FR-001\`）
系统应当 ...

### 非功能需求

- **NFR-001**：性能`;
}

function defaultSec6() {
  return `- [ ] **AC-001** (\`FR-001\`): 可观察行为 - tests: \`server/tests/test.test.ts\``;
}

function makeDesign(opts = {}) {
  const {
    id = 'F001',
    version = '0.1',
    sec3 = '不适用：no data model changes',
    sec5 = '不适用：no runtime changes',
    sec6 = '不适用：no UI changes',
    sec10 = '无',
    body = null,
  } = opts;

  if (body !== null) return body;

  return `---
kind: feature
id: ${id}
version: "${version}"
related_features: []
topics: []
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# ${id}：Test Feature - 设计

> Owner: TBD | Spec: \`spec.md\` | Tasks: \`tasks.md\`

## 0. 输入与约束
- constraint

## 1. 技术概要与影响面
- overview

## 2. 架构与模块边界
text

## 3. 数据模型与 Migration

${sec3}

## 4. 接口、Contract 与 Event
text

## 5. Runtime、Workflow 与并发

${sec5}

## 6. UI 与可观测性

${sec6}

## 7. 失败、恢复、安全与兼容
text

## 8. 测试策略与验收映射
| 验收项 | 测试层级 | 计划文件 | 关键断言 |
|---|---|---|---|

## 9. 已确认决策与残余风险
| 决策 | 结论 | 理由 | 后续 |
|---|---|---|---|

## 10. 待确认设计问题

${sec10}
`;
}

function makeTasks(opts = {}) {
  const {
    id = 'F001',
    version = '0.1',
    sec1 = '不适用：no prerequisites',
    sec2 = defaultSec2(),
    sec3 = defaultSec3(),
    sec4 = '无',
    sec5 = '无',
    body = null,
  } = opts;

  if (body !== null) return body;

  return `---
kind: feature
id: ${id}
version: "${version}"
related_features: []
topics: []
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# ${id}：Test Feature - 任务

> Owner: TBD | Spec: \`spec.md\` | Design: \`design.md\`

## 0. 来源与执行规则
- rule

## 1. 前置条件

${sec1}

## 2. 实现任务

${sec2}

## 3. 验证与验收任务

${sec3}

## 4. 依赖与并行关系

${sec4}

## 5. 明确后移

${sec5}
`;
}

function defaultSec2() {
  return `### Phase 1：基础

- [ ] T001 (\`FR-001\`, \`AC-001\`): implement feature - verify: \`server/tests/test.test.ts\``;
}

function defaultSec3() {
  return `- [ ] T002 (\`AC-001\`): run tests - verify: \`server/tests/test.test.ts\``;
}

// Helper to make all tasks and ACs checked (for done/review state)
function checkedSec2() {
  return `### Phase 1：基础

- [x] T001 (\`FR-001\`, \`AC-001\`): implement feature - verify: \`server/tests/test.test.ts\``;
}

function checkedSec3() {
  return `- [x] T002 (\`AC-001\`): run tests - verify: \`server/tests/test.test.ts\``;
}

function checkedSec6() {
  return `- [x] **AC-001** (\`FR-001\`): 可观察行为 - tests: \`server/tests/test.test.ts\``;
}

// Helper to create a complete valid done Feature
function makeDoneSpec(opts = {}) {
  return makeSpec({
    status: 'done',
    gateVersion: 1,
    sec6: checkedSec6(),
    // Non-draft gate_version 1 Features must answer the Eval Contract trigger.
    // The generic fixture is a plumbing Feature, so it answers "no" with a reason.
    extraFrontmatter: 'eval_contract: exempt\neval_contract_exempt_reason: "fixture: 不改用户旅程也不改成员行为"\n',
    ...opts,
  });
}

function makeDoneTasks(opts = {}) {
  return makeTasks({
    sec2: checkedSec2(),
    sec3: checkedSec3(),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

test('parseFrontmatter', async (t) => {
  await t.test('parses simple key-value', () => {
    const text = `---
kind: feature
id: F001
version: "0.1"
status: draft
gate_version: 1
---
body`;
    const { frontmatter, body } = parseFrontmatter(text);
    assert.equal(frontmatter.kind, 'feature');
    assert.equal(frontmatter.id, 'F001');
    assert.equal(frontmatter.version, '0.1');
    assert.equal(frontmatter.status, 'draft');
    assert.equal(frontmatter.gate_version, 1);
    assert.ok(body.includes('body'));
  });

  await t.test('parses array values', () => {
    const text = `---
topics: [a, b, c]
related_features: []
---
body`;
    const { frontmatter } = parseFrontmatter(text);
    assert.deepEqual(frontmatter.topics, ['a', 'b', 'c']);
    assert.deepEqual(frontmatter.related_features, []);
  });

  await t.test('returns null for no frontmatter', () => {
    const { frontmatter } = parseFrontmatter('no frontmatter here');
    assert.equal(frontmatter, null);
  });

  await t.test('parses number gate_version: 0', () => {
    const text = `---
gate_version: 0
---
body`;
    const { frontmatter } = parseFrontmatter(text);
    assert.equal(frontmatter.gate_version, 0);
  });
});

test('stripCodeBlocks', async (t) => {
  await t.test('removes fenced code blocks', () => {
    const text = 'before\n```js\n- [ ] not a checkbox\n```\nafter';
    const result = stripCodeBlocks(text);
    assert.ok(result.includes('before'));
    assert.ok(result.includes('after'));
    assert.ok(!result.includes('not a checkbox'));
  });

  await t.test('handles tilde fences', () => {
    const text = 'before\n~~~js\n- [ ] not a checkbox\n~~~\nafter';
    const result = stripCodeBlocks(text);
    assert.ok(!result.includes('not a checkbox'));
  });

  await t.test('handles CRLF', () => {
    const text = 'before\r\n```\r\n- [ ] code\r\n```\r\nafter';
    const result = stripCodeBlocks(text);
    assert.ok(!result.includes('code'));
    assert.ok(result.includes('before'));
    assert.ok(result.includes('after'));
  });
});

test('extractTopLevelSections', async (t) => {
  await t.test('extracts numbered sections', () => {
    const text = `# Title

## 0. First

content0

## 1. Second

content1
`;
    const sections = extractTopLevelSections(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].num, 0);
    assert.equal(sections[0].title, 'First');
    assert.ok(sections[0].content.includes('content0'));
    assert.equal(sections[1].num, 1);
    assert.equal(sections[1].title, 'Second');
  });

  await t.test('ignores headings inside code blocks', () => {
    const text = `# Title

## 0. Real

\`\`\`
## 99. Fake
\`\`\`

content
`;
    const sections = extractTopLevelSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].num, 0);
  });
});

test('parseAcLines', async (t) => {
  await t.test('parses TEMPLATE format with tests path', () => {
    const content = `- [ ] **AC-001** (\`FR-001\`, \`UX-001\`): behavior - tests: \`server/tests/a.test.ts\``;
    const acs = parseAcLines(content);
    assert.equal(acs.length, 1);
    assert.equal(acs[0].id, 'AC-001');
    assert.equal(acs[0].checked, false);
    assert.deepEqual(acs[0].reqIds, ['FR-001', 'UX-001']);
    assert.deepEqual(acs[0].testPaths, ['server/tests/a.test.ts']);
  });

  await t.test('parses checked AC', () => {
    const content = `- [x] **AC-001** (\`FR-001\`): behavior`;
    const acs = parseAcLines(content);
    assert.equal(acs[0].checked, true);
    assert.equal(acs[0].testPaths.length, 0);
  });

  await t.test('parses full-width paren format', () => {
    const content = `- [ ] **AC-001**（FR-001/DR-001）：behavior`;
    const acs = parseAcLines(content);
    assert.equal(acs.length, 1);
    assert.ok(acs[0].reqIds.includes('FR-001'));
    assert.ok(acs[0].reqIds.includes('DR-001'));
  });
});

test('parseRequirementIds', async (t) => {
  await t.test('extracts all requirement IDs', () => {
    const content = `### Requirement: 需求（\`FR-001\`）
text
- **DR-001**：data
- **NFR-002**：perf`;
    const ids = parseRequirementIds(content);
    assert.ok(ids.has('FR-001'));
    assert.ok(ids.has('DR-001'));
    assert.ok(ids.has('NFR-002'));
    assert.equal(ids.size, 3);
  });
});

test('checkOpenQuestionsClosed', async (t) => {
  await t.test('无 is closed', () => {
    const result = checkOpenQuestionsClosed('无');
    assert.equal(result.closed, true);
  });

  await t.test('all [x] checkboxes is closed', () => {
    const content = `- [x] Q-001: question - 决策：conclusion`;
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, true);
  });

  await t.test('open [ ] checkbox is not closed', () => {
    const content = `- [ ] Q-001: open question`;
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, false);
  });

  await t.test('free-text bullet is not closed', () => {
    const content = `- maybe later`;
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, false);
  });

  await t.test('empty is not closed', () => {
    const result = checkOpenQuestionsClosed('   \n  ');
    assert.equal(result.closed, false);
  });

  await t.test('code-block checkbox does not false-positive', () => {
    const content = `\`\`\`markdown\n- [ ] Q-001: fake\n\`\`\`\n无`;
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, true);
  });

  await t.test('CRLF docs: 无 with CRLF is closed', () => {
    const content = '无\r\n';
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, true);
  });

  await t.test('CRLF docs: open checkbox with CRLF is not closed', () => {
    const content = '- [ ] Q-001: open\r\n';
    const result = checkOpenQuestionsClosed(content);
    assert.equal(result.closed, false);
  });
});

test('validateTestPathSyntax', async (t) => {
  await t.test('legal relative path', () => {
    assert.equal(validateTestPathSyntax('server/tests/a.test.ts').ok, true);
  });

  await t.test('rejects absolute path', () => {
    const result = validateTestPathSyntax('/etc/passwd');
    assert.equal(result.ok, false);
  });

  await t.test('rejects Windows absolute path', () => {
    const result = validateTestPathSyntax('C:\\Users\\test');
    assert.equal(result.ok, false);
  });

  await t.test('rejects .. escape', () => {
    const result = validateTestPathSyntax('../escape.ts');
    assert.equal(result.ok, false);
  });

  await t.test('rejects glob *', () => {
    const result = validateTestPathSyntax('server/tests/*.test.ts');
    assert.equal(result.ok, false);
  });

  await t.test('rejects glob ?', () => {
    const result = validateTestPathSyntax('server/tests/?.test.ts');
    assert.equal(result.ok, false);
  });

  await t.test('rejects empty', () => {
    const result = validateTestPathSyntax('');
    assert.equal(result.ok, false);
  });
});

test('resolveTestPath', async (t) => {
  await t.test('resolves within root', () => {
    const result = resolveTestPath('server/tests/a.ts', '/repo');
    assert.equal(result.ok, true);
    assert.ok(result.resolved);
  });

  await t.test('rejects .. escape beyond root', () => {
    const result = resolveTestPath('../../../etc/passwd', '/repo');
    assert.equal(result.ok, false);
  });
});

test('parseBacklogRows', async (t) => {
  await t.test('parses table rows', () => {
    const text = `# Roadmap

| ID | Version | Name | Status | Owner | Link |
|----|---------|------|--------|-------|------|
| F001 | 0.1 | Test | draft | TBD | \`docs/features/0.1/F001-test/spec.md\` |
`;
    const rows = parseBacklogRows(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'F001');
    assert.equal(rows[0].version, '0.1');
    assert.equal(rows[0].status, 'draft');
    assert.equal(rows[0].link, 'docs/features/0.1/F001-test/spec.md');
  });
});

test('hasBlockquoteStatus', async (t) => {
  await t.test('detects > Status: in blockquote', () => {
    assert.equal(hasBlockquoteStatus('> Status: done | Owner: TBD'), true);
  });

  await t.test('returns false for no status', () => {
    assert.equal(hasBlockquoteStatus('> Owner: TBD | Spec: spec.md'), false);
  });
});

test('isNaWithReason', async (t) => {
  await t.test('valid N/A with reason', () => {
    assert.equal(isNaWithReason('不适用：no data model changes'), true);
  });

  await t.test('N/A without reason is invalid', () => {
    assert.equal(isNaWithReason('不适用：'), false);
  });

  await t.test('N/A without colon is invalid', () => {
    assert.equal(isNaWithReason('不适用'), false);
  });
});

test('compareSectionHeadings', async (t) => {
  await t.test('matching sections produce no errors', () => {
    const actual = SPEC_SECTIONS.map((s) => ({ ...s, content: 'x' }));
    const errors = compareSectionHeadings(actual, SPEC_SECTIONS, 'spec.md');
    assert.equal(errors.length, 0);
  });

  await t.test('missing section produces error', () => {
    const actual = SPEC_SECTIONS.filter((s) => s.num !== 5).map((s) => ({ ...s, content: 'x' }));
    const errors = compareSectionHeadings(actual, SPEC_SECTIONS, 'spec.md');
    assert.ok(errors.some((e) => e.includes('missing section 5')));
  });

  await t.test('renamed section produces error', () => {
    const actual = SPEC_SECTIONS.map((s) =>
      s.num === 5 ? { ...s, title: 'wrong title' } : s,
    );
    const errors = compareSectionHeadings(actual, SPEC_SECTIONS, 'spec.md');
    assert.ok(errors.some((e) => e.includes('title mismatch')));
  });
});

// ---------------------------------------------------------------------------
// Base check tests (gate v0)
// ---------------------------------------------------------------------------

test('Base checks: legal v0 Feature', async (t) => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ id: 'F001', version: '0.1', gateVersion: 0 }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.equal(result.errors.length, 0, result.errors.join('\n'));
    assert.equal(result.feature.gateVersion, 0);
  } finally {
    cleanup(repo);
  }
});

test('Base checks: legal v1 Feature (draft)', async (t) => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    const baseResult = checkFeatureBase(dir, repo);
    assert.equal(baseResult.errors.length, 0, baseResult.errors.join('\n'));
    const v1Result = checkFeatureGateV1(dir, repo, baseResult.feature);
    assert.equal(v1Result.errors.length, 0, v1Result.errors.join('\n'));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: missing trio', async (t) => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', { design: null, tasks: null });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('missing design.md')));
    assert.ok(result.errors.some((e) => e.includes('missing tasks.md')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: illegal status', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ status: 'spec' }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('illegal status')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: illegal gate_version', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ gateVersion: 2 }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('illegal gate_version')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: frontmatter id mismatch with directory', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ id: 'F002' }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('does not match directory')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: version mismatch with directory', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ version: '0.2' }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('version') && e.includes('does not match')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: design.md declares status in blockquote', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      design: makeDesign({ body: `---
kind: feature
id: F001
version: "0.1"
doc_kind: design
---

# F001：Test - 设计

> Status: done | Owner: TBD

## 0. 输入与约束
text

## 1. 技术概要与影响面
text

## 2. 架构与模块边界
text

## 3. 数据模型与 Migration
不适用：none

## 4. 接口、Contract 与 Event
text

## 5. Runtime、Workflow 与并发
不适用：none

## 6. UI 与可观测性
不适用：none

## 7. 失败、恢复、安全与兼容
text

## 8. 测试策略与验收映射
text

## 9. 已确认决策与残余风险
text

## 10. 待确认设计问题

无
` }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('design.md') && e.includes('Status')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: tasks.md declares status in frontmatter', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      tasks: makeTasks({ body: `---
kind: feature
id: F001
version: "0.1"
status: done
doc_kind: tasks
---

# F001：Test - 任务

> Owner: TBD

## 0. 来源与执行规则
text

## 1. 前置条件
不适用：none

## 2. 实现任务
- [ ] T001: task

## 3. 验证与验收任务
- [ ] T002: task

## 4. 依赖与并行关系
无

## 5. 明确后移
无
` }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('tasks.md') && e.includes('status')));
  } finally {
    cleanup(repo);
  }
});

test('Base checks: kind not feature', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ body: `---
kind: guide
id: F001
version: "0.1"
status: draft
gate_version: 1
---

# F001：Test

## 0. 来源与意图
text

## 1. 问题、目标与非目标
text

## 2. 用户场景
text

## 3. 范围与边界
text

## 4. 需求
text

## 5. 生命周期与不变量
不适用：none

## 6. 成功与验收
text

## 7. 测试、依赖与决策
text

## 8. 待确认问题

无
` }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(result.errors.some((e) => e.includes('kind') && e.includes('feature')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// V1 section structure tests
// ---------------------------------------------------------------------------

test('V1: spec section missing', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const specBody = makeSpec({ body: null });
    // Remove section 5
    const modified = specBody.replace(/## 5\. 生命周期与不变量[\s\S]*?(?=## 6\.)/, '');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', { spec: modified });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('missing section 5')));
  } finally {
    cleanup(repo);
  }
});

test('V1: spec section renumbered', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const specBody = makeSpec();
    // Renumber section 5 to 6 and 6 to 7 etc. - just rename title
    const modified = specBody.replace('## 5. 生命周期与不变量', '## 5. 生命周期');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', { spec: modified });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('title mismatch')));
  } finally {
    cleanup(repo);
  }
});

test('V1: design N/A section missing reason', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      design: makeDesign({ sec3: '不适用：' }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('不适用') && e.includes('reason')));
  } finally {
    cleanup(repo);
  }
});

test('V1: Phase outside section 2', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      tasks: makeTasks({
        sec3: `### Phase 2：验证

- [ ] T002 (\`AC-001\`): run tests - verify: \`server/tests/test.test.ts\``,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('Phase') && e.includes('section 2')));
  } finally {
    cleanup(repo);
  }
});

test('V1: illegal task format (no Txxx ID)', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      tasks: makeTasks({
        sec2: `### Phase 1：基础

- [ ] implement feature without ID`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(
      v1.errors.some((e) => e.includes('not a valid task') || e.includes('without Txxx')),
      v1.errors.join('\n'),
    );
  } finally {
    cleanup(repo);
  }
});

test('V1: [P] task declaring pre-dependency', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      tasks: makeTasks({
        sec2: `### Phase 1：基础

- [ ] T001 (\`FR-001\`, \`AC-001\`): task1 - verify: \`server/tests/test.test.ts\`
- [ ] T002 [P] (\`FR-001\`): task2 - verify: \`server/tests/test.test.ts\``,
        sec4: '- `T002 [P] -> T001`：dependency',
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('[P]') && e.includes('dependen')));
  } finally {
    cleanup(repo);
  }
});

test('V1: duplicate task ID', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      tasks: makeTasks({
        sec2: `### Phase 1：基础

- [ ] T001 (\`FR-001\`, \`AC-001\`): task1 - verify: \`server/tests/test.test.ts\``,
        sec3: `- [ ] T001 (\`AC-001\`): duplicate - verify: \`server/tests/test.test.ts\``,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('duplicate task ID')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// Done state tests
// ---------------------------------------------------------------------------

test('Done: legal done Feature', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeDoneSpec(),
      tasks: makeDoneTasks(),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.equal(v1.errors.length, 0, v1.errors.join('\n'));
  } finally {
    cleanup(repo);
  }
});

test('Done: unchecked task fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeDoneSpec(),
      tasks: makeTasks({
        sec2: checkedSec2(),
        sec3: `- [ ] T002 (\`AC-001\`): unchecked - verify: \`server/tests/test.test.ts\``,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('unchecked') && e.includes('done')));
  } finally {
    cleanup(repo);
  }
});

test('Done: unchecked AC fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ status: 'done', gateVersion: 1, sec6: defaultSec6() }),
      tasks: makeDoneTasks(),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('AC-001') && e.includes('unchecked')));
  } finally {
    cleanup(repo);
  }
});

test('Done: empty task section 2 fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeDoneSpec(),
      tasks: makeTasks({
        sec2: '',
        sec3: checkedSec3(),
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('section 2') && e.includes('no tasks')));
  } finally {
    cleanup(repo);
  }
});

test('Done: empty AC list fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ status: 'done', gateVersion: 1, sec6: 'no items' }),
      tasks: makeDoneTasks(),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('acceptance list') && e.includes('empty')));
  } finally {
    cleanup(repo);
  }
});

test('Done: checked task with TODO marker fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeDoneSpec(),
      tasks: makeTasks({
        sec2: `### Phase 1：基础

- [x] T001 (\`FR-001\`, \`AC-001\`): implement TODO feature - verify: \`server/tests/test.test.ts\``,
        sec3: checkedSec3(),
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('incomplete marker')));
  } finally {
    cleanup(repo);
  }
});

test('Done: checked task with 待补 marker fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeDoneSpec(),
      tasks: makeTasks({
        sec2: `### Phase 1：基础

- [x] T001 (\`FR-001\`, \`AC-001\`): implement 待补 feature - verify: \`server/tests/test.test.ts\``,
        sec3: checkedSec3(),
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('incomplete marker') && e.includes('待补')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// AC / requirement ID tests
// ---------------------------------------------------------------------------

test('AC: requirement ID not defined in section 4', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        sec6: `- [ ] **AC-001** (\`FR-999\`): behavior`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('undefined requirement')));
  } finally {
    cleanup(repo);
  }
});

test('AC: no requirement ID reference', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        sec6: `- [ ] **AC-001**: behavior without req`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(
      v1.errors.some((e) => e.includes('not a valid AC') || e.includes('does not reference')),
      v1.errors.join('\n'),
    );
  } finally {
    cleanup(repo);
  }
});

test('AC: duplicate AC ID', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        sec6: `- [ ] **AC-001** (\`FR-001\`): first
- [ ] **AC-001** (\`FR-001\`): duplicate`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('duplicate AC')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// Test path tests
// ---------------------------------------------------------------------------

test('Test paths: review without tests: path fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior`,
      }),
      tasks: makeTasks({
        sec2: checkedSec2(),
        sec3: checkedSec3(),
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('missing tests: path')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: non-existent file fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`server/tests/nonexistent.test.ts\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('does not exist')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: directory instead of file fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    mkdirSync(join(repo, 'server', 'tests'), { recursive: true });
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`server/tests\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('not a file')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: absolute path fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`/etc/passwd\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('absolute')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: .. escape fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`../escape.ts\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('escape') || e.includes('absolute')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: glob fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`server/tests/*.test.ts\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('glob')));
  } finally {
    cleanup(repo);
  }
});

test('Test paths: multiple legal paths pass', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/a.test.ts');
    writeTestFile(repo, 'server/tests/b.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: `- [x] **AC-001** (\`FR-001\`): behavior - tests: \`server/tests/a.test.ts\` \`server/tests/b.test.ts\``,
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    // Fix task verify paths too
    writeTestFile(repo, 'server/tests/test.test.ts');
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    // Should have no test path errors
    assert.ok(!v1.errors.some((e) => e.includes('tests path')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// Open questions tests
// ---------------------------------------------------------------------------

test('Open questions: ready-for-development with open Q fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'ready-for-development',
        sec8: `- [ ] Q-001: open question`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('section 8') && e.includes('not closed')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: ready-for-development with open DQ fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      design: makeDesign({ sec10: `- [ ] DQ-001: open design question` }),
    });
    const base = checkFeatureBase(dir, repo);
    // Need status = ready-for-development
    const feature = { ...base.feature, status: 'ready-for-development' };
    const v1 = checkFeatureGateV1(dir, repo, feature);
    assert.ok(v1.errors.some((e) => e.includes('section 10') && e.includes('not closed')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: free-text bullet fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'ready-for-development',
        sec8: `- maybe later`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('section 8') && e.includes('not closed')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: empty section fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'ready-for-development',
        sec8: '   ',
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(v1.errors.some((e) => e.includes('section 8') && e.includes('not closed')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: 无 is legal', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'ready-for-development',
        sec8: '无',
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(!v1.errors.some((e) => e.includes('section 8')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: code-block checkbox not false-positive', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'ready-for-development',
        sec8: '```markdown\n- [ ] Q-001: fake\n```\n\n无',
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(!v1.errors.some((e) => e.includes('section 8')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: CRLF docs', async () => {
  let repo;
  try {
    repo = createTempRepo();
    // Create spec with CRLF
    const specContent = makeSpec({
      status: 'ready-for-development',
      sec8: '无',
    }).replace(/\n/g, '\r\n');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', { spec: specContent });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(!v1.errors.some((e) => e.includes('section 8')));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: review all-checked still legal', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'review',
        gateVersion: 1,
        sec6: checkedSec6(),
        sec8: '无',
        extraFrontmatter: 'eval_contract: exempt\neval_contract_exempt_reason: "fixture: 不改用户旅程也不改成员行为"\n',
      }),
      tasks: makeTasks({ sec2: checkedSec2(), sec3: checkedSec3() }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    // review with all checked is legal - gate must NOT infer status from checkboxes
    assert.equal(v1.errors.length, 0, v1.errors.join('\n'));
  } finally {
    cleanup(repo);
  }
});

test('Open questions: draft with open Q is legal (check does not apply)', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({
        status: 'draft',
        sec8: `- [ ] Q-001: open question`,
      }),
    });
    const base = checkFeatureBase(dir, repo);
    const v1 = checkFeatureGateV1(dir, repo, base.feature);
    assert.ok(!v1.errors.some((e) => e.includes('section 8')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// BACKLOG tests
// ---------------------------------------------------------------------------

test('BACKLOG: legal consistency', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/F001-test/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.equal(result.errors.length, 0, result.errors.join('\n'));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: missing row for non-done Feature', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, []);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('missing row')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: duplicate rows', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/F001-test/spec.md' },
      { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/F001-test/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('duplicate')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: done Feature residue', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ status: 'done', gateVersion: 0 }),
    });
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'done', link: 'docs/features/0.1/F001-test/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('done') && e.includes('active table')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: status mismatch', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'in-progress', link: 'docs/features/0.1/F001-test/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('status mismatch')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: version mismatch', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.2', status: 'draft', link: 'docs/features/0.1/F001-test/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('version mismatch')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: link mismatch', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/wrong/spec.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('link mismatch')));
  } finally {
    cleanup(repo);
  }
});

test('BACKLOG: broken link', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'test');
    writeBacklog(repo, [
      { id: 'F001', version: '0.1', status: 'draft', link: 'docs/features/0.1/F001-test/nonexistent.md' },
    ]);
    const base = checkFeatureBase(dir, repo);
    const backlogText = require_backlog(repo);
    const result = checkBacklogConsistency([base.feature], backlogText, repo);
    assert.ok(result.errors.some((e) => e.includes('broken link')));
  } finally {
    cleanup(repo);
  }
});

// Helper to read BACKLOG.md
function require_backlog(repo) {
  try {
    return readFileSync(join(repo, 'BACKLOG.md'), 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch test (project-mandatory rule)
// ---------------------------------------------------------------------------

test('Batch: multiple versions and multiple Features', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeTestFile(repo, 'server/tests/test.test.ts');

    // v0.1: F001 (done, gate v0), F002 (done, gate v0)
    writeFeature(repo, '0.1', 'F001', 'alpha', {
      spec: makeSpec({ id: 'F001', version: '0.1', status: 'done', gateVersion: 0 }),
    });
    writeFeature(repo, '0.1', 'F002', 'beta', {
      spec: makeSpec({ id: 'F002', version: '0.1', status: 'done', gateVersion: 0 }),
    });

    // v0.2: F003 (draft, gate v1)
    writeFeature(repo, '0.2', 'F003', 'gamma');

    // BACKLOG: only non-done Features
    writeBacklog(repo, [
      { id: 'F003', version: '0.2', status: 'draft', link: 'docs/features/0.2/F003-gamma/spec.md' },
    ]);

    const result = checkAllFeatures(repo);
    assert.equal(result.errors.length, 0, result.errors.join('\n'));
    assert.equal(result.features.length, 3);
  } finally {
    cleanup(repo);
  }
});

test('Batch: duplicate ID across versions fails', async () => {
  let repo;
  try {
    repo = createTempRepo();
    writeFeature(repo, '0.1', 'F001', 'alpha', {
      spec: makeSpec({ id: 'F001', version: '0.1', status: 'done', gateVersion: 0 }),
    });
    writeFeature(repo, '0.2', 'F001', 'beta', {
      spec: makeSpec({ id: 'F001', version: '0.2', status: 'draft', gateVersion: 0 }),
    });
    writeBacklog(repo, [
      { id: 'F001', version: '0.2', status: 'draft', link: 'docs/features/0.2/F001-beta/spec.md' },
    ]);

    const result = checkAllFeatures(repo);
    assert.ok(result.errors.some((e) => e.includes('duplicate Feature ID')));
  } finally {
    cleanup(repo);
  }
});

test('Batch: v0 does not run v1 checks', async () => {
  let repo;
  try {
    repo = createTempRepo();
    // A v0 Feature with old structure (no proper sections) should not trigger v1 section errors
    writeFeature(repo, '0.1', 'F001', 'test', {
      spec: makeSpec({ id: 'F001', version: '0.1', status: 'done', gateVersion: 0 }),
      design: makeDesign({ id: 'F001', version: '0.1' }),
      tasks: makeTasks({ id: 'F001', version: '0.1' }),
    });
    writeBacklog(repo, []);

    const result = checkAllFeatures(repo);
    // Should have no v1 section errors
    assert.ok(!result.errors.some((e) => e.includes('title mismatch') || e.includes('missing section')));
  } finally {
    cleanup(repo);
  }
});

// ---------------------------------------------------------------------------
// Regression tests for structure-improvement code review round 1 (2026-08-10)
// ---------------------------------------------------------------------------

test('Regress: gate-v0-bypass — new Feature declaring gate_version 0 is rejected', async () => {
  let repo;
  try {
    repo = createTempRepo();
    // A new (non-legacy) Feature id must not be able to declare gate_version 0.
    const dir = writeFeature(repo, '0.3', 'F020', 'new-feature', {
      spec: makeSpec({ id: 'F020', version: '0.3', gateVersion: 0 }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(
      result.errors.some((e) => e.includes('gate_version 0 is a legacy exemption')),
      result.errors.join('\n'),
    );
  } finally {
    cleanup(repo);
  }
});

test('Regress: gate-v0-bypass — legacy F001 may still declare gate_version 0', async () => {
  let repo;
  try {
    repo = createTempRepo();
    const dir = writeFeature(repo, '0.1', 'F001', 'legacy', {
      spec: makeSpec({ id: 'F001', version: '0.1', gateVersion: 0 }),
    });
    const result = checkFeatureBase(dir, repo);
    assert.ok(!result.errors.some((e) => e.includes('gate_version 0 is a legacy exemption')));
  } finally {
    cleanup(repo);
  }
});

test('Regress: section-order-duplicate — reversed sections are rejected', () => {
  const actual = [...SPEC_SECTIONS].reverse().map((s) => ({ ...s, content: 'x' }));
  const errors = compareSectionHeadings(actual, SPEC_SECTIONS, 'spec.md');
  assert.ok(errors.some((e) => e.includes('out of order')), errors.join('\n'));
});

test('Regress: section-order-duplicate — duplicate section number is rejected', () => {
  const actual = [
    ...SPEC_SECTIONS.map((s) => ({ ...s, content: 'x' })),
    { num: 0, title: '来源与意图', content: 'dup' },
  ];
  const errors = compareSectionHeadings(actual, SPEC_SECTIONS, 'spec.md');
  assert.ok(errors.some((e) => e.includes('duplicate section 0')), errors.join('\n'));
});

test('Regress: open-question-syntax — arbitrary checked checkbox is NOT closed', () => {
  const result = checkOpenQuestionsClosed('- [x] not-a-Q and no decision');
  assert.equal(result.closed, false);
});

test('Regress: open-question-syntax — a valid closed Q item IS closed', () => {
  const result = checkOpenQuestionsClosed('- [x] Q-001: question - 决策：conclusion');
  assert.equal(result.closed, true);
});

test('Regress: traceability — prose mention of an ID is not a requirement definition', () => {
  const ids = parseRequirementIds('本文仅引用 FR-999，并未定义它');
  assert.ok(!ids.has('FR-999'));
});

test('Regress: traceability — loose AC text is not accepted as an AC', () => {
  const acs = parseAcLines('- [x] garbage AC-001 mentions FR-999');
  assert.equal(acs.length, 0);
});

test('Regress: traceability — loose task text is not accepted as a task', () => {
  const tasks = parseTaskLines('- [x] blah T001');
  assert.equal(tasks.length, 0);
});

// ---------------------------------------------------------------------------
// Round-3 regression tests (diff-only review of the round-2 fixes)
// ---------------------------------------------------------------------------

test('Regress r3: open-question — a checked item without a 决策 conclusion is not closed', () => {
  const result = checkOpenQuestionsClosed('- [x] Q-001: unresolved question', 'Q');
  assert.equal(result.closed, false);
});

test('Regress r3: open-question — "无" mixed with checklist items is not closed', () => {
  const result = checkOpenQuestionsClosed('- [x] Q-001: q - 决策：conclusion\n\n无', 'Q');
  assert.equal(result.closed, false);
});

test('Regress r3: open-question — a checked item WITH a 决策 conclusion is closed', () => {
  const result = checkOpenQuestionsClosed('- [x] Q-001: q - 决策：conclusion', 'Q');
  assert.equal(result.closed, true);
});

test('Regress r3: open-question — a closed DQ item (design) with 决策 is closed', () => {
  const result = checkOpenQuestionsClosed('- [x] DQ-001: design question - 决策：decision', 'DQ');
  assert.equal(result.closed, true);
});

test('Regress r3: traceability — bold prose mention is NOT a requirement definition', () => {
  const ids = parseRequirementIds('这里只是加粗引用 **FR-999**，不是定义');
  assert.ok(!ids.has('FR-999'));
});

test('Regress r3: traceability — a definition bullet **FR-xxx** IS a requirement definition', () => {
  const ids = parseRequirementIds('- **FR-001**：定义');
  assert.ok(ids.has('FR-001'));
});

test('Regress r3: traceability — single-star AC is rejected', () => {
  const acs = parseAcLines('- [x] *AC-001* (FR-999): vague');
  assert.equal(acs.length, 0);
});

test('Regress r3: traceability — double-star AC is accepted', () => {
  const acs = parseAcLines('- [x] **AC-001** (`FR-001`): ok');
  assert.equal(acs.length, 1);
});

test('Regress r3: traceability — bare task without action/verify is rejected', () => {
  const tasks = parseTaskLines('- [x] T001');
  assert.equal(tasks.length, 0);
});

test('Regress r3: traceability — valid task with refs, action and verify is accepted', () => {
  const tasks = parseTaskLines('- [x] T001 (`FR-001`): do - verify: `server/tests/x.test.ts`');
  assert.equal(tasks.length, 1);
});

test('Regress r3: traceability — doc-backfill task without refs but with action+verify is accepted', () => {
  const tasks = parseTaskLines('- [ ] T034: 回写 - verify: `docs/spec.md`');
  assert.equal(tasks.length, 1);
});

// ---------------------------------------------------------------------------
// Round-4 regression tests (diff-only review of the round-3 fixes)
// ---------------------------------------------------------------------------

test('Regress r4: task format — canonical "T001 [P]" (P after id) is accepted', () => {
  const tasks = parseTaskLines('- [ ] T001 [P] (`FR-001`, `AC-001`): do - verify: `server/tests/x.test.ts`');
  assert.equal(tasks.length, 1);
});

test('Regress r4: task format — non-canonical "[P] T001" (P before id) is rejected', () => {
  const tasks = parseTaskLines('- [ ] [P] T001 (`FR-001`): do - verify: `server/tests/x.test.ts`');
  assert.equal(tasks.length, 0);
});

test('Regress r4: task format — empty verify value is rejected', () => {
  assert.equal(parseTaskLines('- [ ] T001: do - verify: ').length, 0);
  assert.equal(parseTaskLines('- [ ] T001: do - verify: ``').length, 0);
});

test('Regress r4: task format — non-empty verify value is accepted', () => {
  assert.equal(parseTaskLines('- [ ] T001: do - verify: `server/tests/x.test.ts`').length, 1);
});

// ---------------------------------------------------------------------------
// Eval / Tracking Contract (borrowed from clowder-ai; see
// docs/reviews/clowder-governance-borrowing.md §4.2)
// ---------------------------------------------------------------------------

function specWith({ frontmatter = '', section6 = '## 6. 成功与验收\n\n### 成功标准\n\n- SC-001：x\n' } = {}) {
  return `---\nkind: feature\nid: F999\nversion: "0.9"\nstatus: review\ngate_version: 1\n${frontmatter}---\n\n# F999\n\n${section6}\n`;
}

const FULL_CONTRACT = [
  '## 6. 成功与验收',
  '',
  '### 成功标准',
  '',
  '- SC-001：x',
  '',
  '### Eval / Tracking Contract',
  '',
  '- **主要用户与激活信号**：单人开发者；创建第一个 coding Issue 时激活。',
  '- **摩擦指标**：从派活到拿到验证结论的人工介入次数。',
  '- **回归夹具**：一次 pass、一次 fail 转 Ready。',
  '- **退役信号**：连续两个版本该指标为 0 且无人查看，则删除本 Feature 的专用实现。',
  '',
].join('\n');

test('parseEvalContractFields extracts the four labelled bullets', () => {
  const fields = parseEvalContractFields(FULL_CONTRACT);
  for (const name of EVAL_CONTRACT_FIELDS) {
    assert.equal(fields.has(name), true, `missing ${name}`);
  }
  assert.match(fields.get('退役信号'), /连续两个版本/);
});

test('checkEvalContract', async (t) => {
  await t.test('passes a fully filled required contract', () => {
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: required\n', section6: FULL_CONTRACT }),
      'review',
      'docs/features/0.9/F999-x',
    );
    assert.deepEqual(errors, []);
  });

  // KD-4: the whole gate rests on this one. An empty sunset signal is the field
  // people skip, so it is the field that must fail closed.
  await t.test('rejects an empty 退役信号 with no reviewer-signature downgrade', () => {
    const section6 = FULL_CONTRACT.replace(/- \*\*退役信号\*\*：.*/, '- **退役信号**：');
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: required\n', section6 }),
      'review',
      'd',
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /退役信号.*is empty/);
  });

  await t.test('rejects a placeholder value', () => {
    const section6 = FULL_CONTRACT.replace(/- \*\*摩擦指标\*\*：.*/, '- **摩擦指标**：N/A');
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: required\n', section6 }),
      'review',
      'd',
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /placeholder/);
  });

  await t.test('rejects a missing field', () => {
    const section6 = FULL_CONTRACT.split('\n').filter((l) => !l.includes('回归夹具')).join('\n');
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: required\n', section6 }),
      'review',
      'd',
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /missing field: 回归夹具/);
  });

  await t.test('rejects "required" with no subsection at all', () => {
    const errors = checkEvalContract(specWith({ frontmatter: 'eval_contract: required\n' }), 'review', 'd');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no "Eval \/ Tracking Contract" subsection/);
  });

  await t.test('exempt requires a concrete reason', () => {
    const errors = checkEvalContract(specWith({ frontmatter: 'eval_contract: exempt\n' }), 'review', 'd');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /eval_contract_exempt_reason/);
  });

  await t.test('exempt rejects a TODO reason', () => {
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: exempt\neval_contract_exempt_reason: "TODO"\n' }),
      'review',
      'd',
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /eval_contract_exempt_reason/);
  });

  await t.test('accepts exempt with a concrete reason', () => {
    const errors = checkEvalContract(
      specWith({ frontmatter: 'eval_contract: exempt\neval_contract_exempt_reason: "纯内部重构，不改用户旅程也不改成员行为"\n' }),
      'review',
      'd',
    );
    assert.deepEqual(errors, []);
  });

  // The N/A-farm guard: an untriggered Feature must delete the section, not fill it.
  await t.test('exempt rejects a leftover subsection', () => {
    const errors = checkEvalContract(
      specWith({
        frontmatter: 'eval_contract: exempt\neval_contract_exempt_reason: "纯内部重构"\n',
        section6: FULL_CONTRACT,
      }),
      'review',
      'd',
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /delete it rather than filling it with N\/A/);
  });

  await t.test('rejects an unknown declaration value', () => {
    const errors = checkEvalContract(specWith({ frontmatter: 'eval_contract: maybe\n' }), 'review', 'd');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must be "required" or "exempt"/);
  });

  // draft is before PersonaHub's Design Gate: user scenarios are not settled, so a
  // contract written now would be fiction. Declaration and content both become
  // mandatory at ready-for-development.
  await t.test('draft may omit the declaration entirely', () => {
    assert.deepEqual(checkEvalContract(specWith(), 'draft', 'd'), []);
  });

  await t.test('ready-for-development must declare', () => {
    const errors = checkEvalContract(specWith(), 'ready-for-development', 'd');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must declare eval_contract/);
  });

  // A half-filled section is worse than none, so a draft that writes one is still
  // held to all four fields.
  await t.test('a draft that writes a partial contract is still validated', () => {
    const section6 = FULL_CONTRACT.replace(/- \*\*退役信号\*\*：.*/, '- **退役信号**：');
    const errors = checkEvalContract(specWith({ section6 }), 'draft', 'd');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /退役信号.*is empty/);
  });
});
