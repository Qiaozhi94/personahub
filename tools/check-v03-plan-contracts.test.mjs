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

function forbidPhrases(documents, phrases) {
  const corpus = documents.join('\n');
  for (const phrase of phrases) {
    assert.ok(!corpus.includes(phrase), `forbidden v0.3 planning contract: ${phrase}`);
  }
}

function verifyMutation(documents, phrases) {
  const corpus = documents.join('\n');
  const [first, ...rest] = phrases;
  const mutated = [corpus.replaceAll(first, '')];
  assert.throws(() => requirePhrases(mutated, [first, ...rest]), /missing v0\.3 planning contract/);
}

function verifyForbiddenMutation(documents, phrase) {
  assert.throws(
    () => forbidPhrases([...documents, phrase], [phrase]),
    /forbidden v0\.3 planning contract/,
  );
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

test('V03-PLAN-R2-011: F013 publishes inputs while F012 owns Dispatch integration', () => {
  const documents = [
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/spec.md'),
    read('docs/features/0.3/F012-session-dispatch-intervention/tasks.md'),
    read('docs/features/0.3/F013-project-skills-foundation/spec.md'),
    read('docs/features/0.3/F013-project-skills-foundation/tasks.md'),
  ];
  const phrases = [
    '| F009 |',
    'F010 与 F013 互不依赖',
    'F013 只验收 versioned effective-requirements 输出',
    'F012 最终验收 Skill 升级 / 禁用不改已提交 Dispatch',
    '已固定旧 ref 的 effective requirements 输出不变',
    '跨 Feature Dispatch 快照集成只由 F012 验收',
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
  forbidPhrases(documents, ['when 打开旧收藏链接']);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, 'when 打开旧收藏链接');
});

test('V03-PLAN-R2-012: F009 scenarios consistently retire unsupported legacy surfaces', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    '从已发布历史根入口 `/` 进入',
    'Workflow Template 编辑动作标为 retired',
    '旧数据只读',
    'adapter 配置与 runtime health 入口',
    '不把退役管理动作算作能力回归',
  ];
  const forbidden = [
    'when 打开旧收藏链接',
    '现有 adapter、workflow template 与 runtime health 能力从临时弹窗迁入最终信息架构允许的生产位置',
  ];

  requirePhrases(documents, phrases);
  forbidPhrases(documents, forbidden);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, forbidden[0]);
});

test('V03-PLAN-R1-009: all eleven task states have named acceptance fixtures', () => {
  const documents = [
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F011-trusted-task-surface/spec.md'),
    read('docs/features/0.3/F011-trusted-task-surface/design.md'),
    read('docs/features/0.3/F011-trusted-task-surface/tasks.md'),
  ];
  const phrases = [
    '11 个具名 Task state fixture',
    '| 刚创建 |',
    '| 等待启动 |',
    '| 权限阻塞 |',
    '| 已排队 |',
    '| 执行中 |',
    '| 等待指派 |',
    '| 验证未收敛 |',
    '| 执行失败 |',
    '| 已中断 |',
    '| 已取消 |',
    '| 已完成 |',
    '首屏优先级、唯一主操作、恢复结果和必须保留事实',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R1-010: v0.4 has independent value lanes and a minimum boundary', () => {
  const documents = [read('docs/personahub-prd.md')];
  const phrases = [
    'v0.4 是方向性 umbrella，不是要求四条价值链同时收口的单个发布包',
    'v0.4.0 最小收口边界',
    'Provenance / Memory foundation',
    'Usage / Monitoring 候选线',
    'Automation 候选线',
    'Memory 效用 / 知识图谱候选线',
    '不作为 v0.4.0 的阻塞条件',
    'v0.3 收口后的真实反馈',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R3-013: active review artifacts stay local while retrospectives remain tracked', () => {
  const documents = [read('.gitignore'), read('CLAUDE.md')];
  const phrases = [
    'docs/reviews/CURRENT-*.md',
    'docs/reviews/FIX-log.md',
    '长期复盘与产品级文档纳入 git，进行中的 `CURRENT-*.md` / `FIX-log.md` 除外',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('V03-PLAN-R4-014: downstream research docs reference the current Artifact feature', () => {
  const documents = [read('docs/quant-factor-research-tradingview-assessment.md')];
  const phrases = [
    'F010 又规划了 Artifact entity、immutable revision 和 pinned ref',
    'features/0.3/F010-artifact-foundation-provenance/spec.md',
  ];
  const retiredPath = 'features/0.3/F009-artifact-foundation-provenance/spec.md';

  requirePhrases(documents, phrases);
  forbidPhrases(documents, [retiredPath]);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, retiredPath);
});
