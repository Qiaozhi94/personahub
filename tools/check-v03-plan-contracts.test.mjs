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

test('V03-PLAN-R1-002: Space has a v0.3 schema, migration, and feature owner', () => {
  const documents = [
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F013-project-skills-foundation/spec.md'),
    read('docs/features/0.3/F013-project-skills-foundation/design.md'),
    read('docs/features/0.3/F013-project-skills-foundation/tasks.md'),
    read('docs/decisions/0012-object-model-simplification.md'),
  ];
  const phrases = [
    'F013 是 Space schema、默认数据迁移与首次设置的唯一 owner',
    '`spaces`、`space_skills`',
    '`issues.space_id` 非空',
    '`issues.project_id` 可空',
    'T000 (`FR-001`, `FR-002`, `NFR-001`)',
    '清洁库与仅含历史 Project / Issue 的旧库',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-003: feature dependencies form an acyclic executable order', () => {
  const documents = [
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F010-artifact-foundation-provenance/tasks.md'),
    read('docs/features/0.3/F011-trusted-task-surface/spec.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/spec.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/tasks.md'),
    read('docs/features/0.3/F013-project-skills-foundation/spec.md'),
  ];
  const phrases = [
    '`F009 → (F010 ∥ F013) → F012 → F011 → F014`',
    'F010 只拥有 Artifact core 与 `recordConsumption` 公共契约',
    'F012 是上下文组装调用 `recordConsumption` 的最终集成 owner',
    'F013 发布 effective requirements 与路径授权 contract',
    '依赖 F009 新壳层、F010 Artifact 契约和 F012 已提交的 Dispatch / 会话契约',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-004: file artifact publication never exposes a missing revision', () => {
  const documents = [
    read('docs/features/0.3/F010-artifact-foundation-provenance/spec.md'),
    read('docs/features/0.3/F010-artifact-foundation-provenance/design.md'),
    read('docs/features/0.3/F010-artifact-foundation-provenance/tasks.md'),
  ];
  const phrases = [
    'source locator 与 archive locator 分开保存',
    '临时 blob → 校验并 fsync → 原子改名到 content-addressed archive',
    'DB commit 是 revision 对 resolver 可见的唯一发布点',
    'CAS 失败只留下不可见的 archive orphan',
    '重启清理只删除超过安全宽限期且未被任何 manifest 引用的 orphan',
    '每个故障点 crash 后 resolver 都只能返回完整 published revision 或 not-found',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-005: adapter capability probes are owned readiness work', () => {
  const documents = [
    read('docs/features/0.3/F012-session-dispatch-intervention/spec.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/design.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/tasks.md'),
  ];
  const phrases = [
    'supported / unsupported / unverified',
    '`adapter-capability-evidence.md`',
    'T000 (`FR-003`, `FR-008`, `NFR-003`)',
    'unsupported 与 unverified 都不能承担依赖该能力的独立验证',
    'Phase 0 probe 是进入 schema / eligibility 实现的门槛',
    '不得把缺失 probe 当作 supported',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-006: Dispatch grace-window lifecycle has one commit sequence', () => {
  const documents = [
    read('docs/features/0.3/F012-session-dispatch-intervention/spec.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/design.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/tasks.md'),
  ];
  const phrases = [
    '确认事务立即创建唯一 `draft` Dispatch',
    '`draft → cancelled`',
    '`draft → starting → dispatched`',
    'starting 不再接受撤销',
    '同一事务写入 context snapshot、Artifact consumption、首个 Attempt / queued Run',
    'commit 后才 spawn',
    '过期 starting lease',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-007: F009 limits transitional surfaces and assigns deletion owners', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    'stable-shell / final-surface / transitional-host',
    'replacement_owner',
    'delete_when',
    'latest_milestone',
    '旧 Workflow Template 只保留只读列表 / 详情',
    '不得为 transitional-host 重做最终视觉或新增领域逻辑',
    'F011 / F012 / F013 验收时删除',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-008: URL migration is based on published routes, not invented history', () => {
  const documents = [
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
    read('docs/features/0.3/F014-trusted-task-journey-closure/spec.md'),
  ];
  const phrases = [
    '当前已发布历史 URL inventory 只有根入口 `/`',
    '`/tasks/:taskId/:view?`',
    '`/projects/:projectId/:tab?`',
    '`/sessions/:sessionId`',
    '刷新恢复',
    '未知 ID',
    '不得把新 deep link 写成旧收藏链接迁移',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});
