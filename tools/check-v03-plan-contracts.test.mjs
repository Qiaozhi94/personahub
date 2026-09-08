import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function requirePhrases(documents, phrases) {
  const corpus = documents.join('\n');
  for (const phrase of phrases) {
    assert.ok(corpus.includes(phrase), `missing v0.3 planning contract: ${phrase}`);
  }
}

function verifyMutation(documents, phrases) {
  const corpus = documents.join('\n');
  const [first, ...rest] = phrases;
  const mutated = [corpus.replaceAll(first, '')];
  assert.throws(() => requirePhrases(mutated, [first, ...rest]), /missing v0\.3 planning contract/);
}

test('V03-PLAN-R1-001: acceptance writes have canonical owners and integration tasks', () => {
  const documents = [
    read('docs/features/0.3/F011-trusted-task-surface/spec.md'),
    read('docs/features/0.3/F011-trusted-task-surface/design.md'),
    read('docs/features/0.3/F011-trusted-task-surface/tasks.md'),
  ];
  const phrases = [
    'AcceptanceService 是完成要求、主张链、风险接受与完成摘要的唯一写入口',
    'IssueService 只接受 AcceptanceService 发出的 `acceptance.completed`',
    '冻结完成要求基线、写入主张 / 论证 / 证据链接、接受剩余风险、生成完成摘要',
    '完成摘要失败不得推进 Issue done',
    'T004 (`FR-007`, `FR-008`, `NFR-002`)',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});
