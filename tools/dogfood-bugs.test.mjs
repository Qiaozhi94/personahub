// tools/dogfood-bugs.test.mjs
// node:test zero-dependency tests for dogfood-bugs.mjs.
// Fixtures are built inline; the real docs/reviews/ files are never read here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractTable,
  parseBugLog,
  parseDetailSections,
  parseNoteLog,
  validateBugs,
  summarizeBugs,
  findRepeatedSteps,
} from './dogfood-bugs.mjs';

const HEADER = [
  '| ID | 状态 | 发现时间 | 严重度 | 逃逸层级 | 旅程步骤 | 问题（一句话） | 根因（一句话） | 关联模块 | 涉及文件 | 回归测试 | 修复 commit |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
];

function row({
  id = 'BUG-001',
  status = 'fixed',
  severity = '中',
  escape = '任务级',
  step = '—',
  problem = 'p',
  regression = 'a.test.ts::x',
  commit = 'abc1234',
} = {}) {
  return `| ${id} | ${status} | 2026-09-03 10:00 | ${severity} | ${escape} | ${step} | ${problem} | r | m | f | ${regression} | ${commit} |`;
}

function doc(rows, details = '') {
  return ['# log', '', ...HEADER, ...rows, '', '## 详情', '', details].join('\n');
}

test('parseBugLog reads the master table including the regression column', () => {
  const { issues } = parseBugLog(doc([row()]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].regressionTest, 'a.test.ts::x');
  assert.equal(issues[0].fixCommit, 'abc1234');
});

test('extractTable stops at the first non-table line', () => {
  const table = extractTable(doc([row()]));
  assert.equal(table.length, 3);
});

test('parseDetailSections keys blocks by bug id', () => {
  const details = parseDetailSections(
    doc([row()], ['### BUG-001：标题', '', '- **不修理由**：成本高于收益。', '', '### BUG-002：另一个', '', '- 现象：x'].join('\n')),
  );
  assert.equal(details.has('BUG-001'), true);
  assert.match(details.get('BUG-001'), /不修理由/);
  assert.equal(details.has('BUG-002'), true);
  assert.doesNotMatch(details.get('BUG-002'), /不修理由/);
});

test('validateBugs: existing invariants still hold', async (t) => {
  await t.test('accepts a well-formed fixed row', () => {
    assert.deepEqual(validateBugs(parseBugLog(doc([row()])).issues), []);
  });

  await t.test('rejects an unknown status', () => {
    const errors = validateBugs(parseBugLog(doc([row({ status: 'closed' })])).issues);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid status/);
  });

  await t.test('rejects open with a fix commit', () => {
    const errors = validateBugs(
      parseBugLog(doc([row({ status: 'open', regression: '—', commit: 'abc1234' })])).issues,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /open but has fix commit/);
  });

  await t.test('rejects a missing escape layer', () => {
    const errors = validateBugs(parseBugLog(doc([row({ escape: '' })])).issues);
    assert.match(errors.join('\n'), /invalid escape layer/);
  });
});

// ---------------------------------------------------------------------------
// ③-A 复验才能关单 (clowder-ai F266; see clowder-governance-borrowing.md §4.3)
// ---------------------------------------------------------------------------

test('validateBugs: fixed requires a re-runnable check', async (t) => {
  await t.test('rejects fixed with an em-dash regression cell', () => {
    const errors = validateBugs(parseBugLog(doc([row({ regression: '—' })])).issues);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no regression test/);
  });

  await t.test('rejects fixed with an empty regression cell', () => {
    const errors = validateBugs(parseBugLog(doc([row({ regression: '' })])).issues);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no regression test/);
  });

  await t.test('rejects fixed with no fix commit', () => {
    const errors = validateBugs(parseBugLog(doc([row({ commit: '—' })])).issues);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no fix commit/);
  });

  // An honest note about the limits of the regression case is still a re-runnable
  // reference plus a caveat — that must pass, or the rule teaches people to omit
  // the caveat.
  await t.test('accepts a regression cell that names a case and states its limits', () => {
    const errors = validateBugs(
      parseBugLog(doc([row({ regression: 'a.test.ts::x（**无自动防再犯检测**，见备注）' })])).issues,
    );
    assert.deepEqual(errors, []);
  });
});

test('validateBugs: wontfix must state why', async (t) => {
  const wontfix = row({ status: 'wontfix', regression: '—', commit: '—' });

  await t.test('rejects wontfix with no detail block', () => {
    const markdown = doc([wontfix]);
    const errors = validateBugs(parseBugLog(markdown).issues, parseDetailSections(markdown));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /不修理由/);
  });

  await t.test('rejects wontfix whose detail block omits the reason', () => {
    const markdown = doc([wontfix], ['### BUG-001：标题', '', '- 现象：x'].join('\n'));
    const errors = validateBugs(parseBugLog(markdown).issues, parseDetailSections(markdown));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /不修理由/);
  });

  await t.test('accepts wontfix with a stated reason', () => {
    const markdown = doc([wontfix], ['### BUG-001：标题', '', '- **不修理由**：触发条件已随 v0.3 消失。'].join('\n'));
    const errors = validateBugs(parseBugLog(markdown).issues, parseDetailSections(markdown));
    assert.deepEqual(errors, []);
  });

  await t.test('rejects wontfix carrying a fix commit', () => {
    const markdown = doc(
      [row({ status: 'wontfix', regression: '—', commit: 'abc1234' })],
      ['### BUG-001：标题', '', '- **不修理由**：x'].join('\n'),
    );
    const errors = validateBugs(parseBugLog(markdown).issues, parseDetailSections(markdown));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /wontfix but has fix commit/);
  });

  // wontfix is a decision, not a disappearance: it must stay countable.
  await t.test('summarizeBugs counts wontfix separately and keeps it out of open', () => {
    const markdown = doc([wontfix, row({ id: 'BUG-002', status: 'open', regression: '—', commit: '—' })]);
    const summary = summarizeBugs(parseBugLog(markdown).issues);
    assert.equal(summary.byStatus.wontfix, 1);
    assert.equal(summary.open.length, 1);
    assert.equal(summary.open[0].id, 'BUG-002');
  });
});

test('findRepeatedSteps ignores the em-dash placeholder', () => {
  const markdown = doc([row({ id: 'BUG-001' }), row({ id: 'BUG-002' })]);
  const { issues } = parseBugLog(markdown);
  assert.deepEqual(findRepeatedSteps(issues), []);
});

test('findRepeatedSteps flags a real step seen twice across bugs and notes', () => {
  const markdown = doc([row({ id: 'BUG-001', step: 'J3.2' })]);
  const notesDoc = ['| ID | 旅程步骤 | 问题 |', '|---|---|---|', '| NOTE-001 | J3.2 | n |'].join('\n');
  const { issues } = parseBugLog(markdown);
  const { notes } = parseNoteLog(notesDoc);
  const repeated = findRepeatedSteps([...issues, ...notes]);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].step, 'J3.2');
  assert.deepEqual(repeated[0].ids, ['BUG-001', 'NOTE-001']);
});
