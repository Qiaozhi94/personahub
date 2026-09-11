import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** True iff `hash` resolves to a real commit object in this repository. */
function commitExists(hash) {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * review R1-011: a well-formed hex string proves nothing on its own — a
 * completion claim citing a nonexistent commit passed this gate before.
 * `commitExistsFn` is injectable so the "rejects a fake hash" mutation below
 * doesn't have to hope a made-up string happens to collide with no real
 * commit; it proves the assertion path itself is wired correctly.
 */
function verifyExecutionEvidenceCommit(journeyText, commitExistsFn) {
  const match = /execution_evidence_commit: ([0-9a-f]{7,40})/.exec(journeyText);
  assert.ok(match, 'journey-test-matrix.md must declare execution_evidence_commit as a hex string');
  const hash = match[1];
  assert.ok(
    commitExistsFn(hash),
    `execution_evidence_commit ${hash} does not resolve to a real commit in this repository — a hex-shaped string is not evidence of execution`,
  );
}

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

function verifyBrowserCheckApplicability(catalog) {
  const rows = [...catalog.matchAll(/^\| BC-(\d{3}) \|.+\| (adapted|deferred|not-applicable) \|.+\|.+\|$/gm)];
  assert.equal(rows.length, 125, `expected 125 classified browser checks, got ${rows.length}`);
  assert.deepEqual(
    rows.map((row) => Number(row[1])),
    Array.from({ length: 125 }, (_, index) => index + 1),
    'browser check ids must be unique and contiguous',
  );
  const counts = rows.reduce(
    (result, row) => ({ ...result, [row[2]]: result[row[2]] + 1 }),
    { adapted: 0, deferred: 0, 'not-applicable': 0 },
  );
  assert.match(
    catalog,
    new RegExp(
      `adapted: ${counts.adapted} · deferred: ${counts.deferred} · not-applicable: ${counts['not-applicable']} · total: 125`,
    ),
  );
}

function parseMigrationMatrixRows(matrix, idPrefix) {
  return matrix
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`| ${idPrefix}`))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

/**
 * The 28 "adapted" browser checks each name a production test file in the
 * catalog's last column (backtick-quoted). Extracts {id, testFile} pairs —
 * review R1-006's complaint was that this list has never been proven
 * machine-readable, so a deleted row or a deleted in-file assertion for one
 * of these ids would pass silently.
 */
function parseAdaptedBrowserChecks(catalog) {
  return [...catalog.matchAll(/^\| (BC-\d{3}) \|.+\| adapted \|.+\| `([^`]+)` \|$/gm)].map(([, id, testFile]) => ({
    id,
    testFile,
  }));
}

/**
 * Fails if: the adapted count drifts from 28 (a row was added/removed
 * without updating the list this function derives from), a named test file
 * is missing, or a file's content no longer mentions its assigned BC id
 * (readFile returns the actual file content — tests substitute a mutated
 * version to prove a deleted case turns this red).
 */
function verifyAdaptedInventory(catalog, readFile) {
  const rows = parseAdaptedBrowserChecks(catalog);
  assert.equal(rows.length, 28, `expected 28 adapted browser checks, got ${rows.length}`);
  const byFile = new Map();
  for (const { id, testFile } of rows) {
    if (!byFile.has(testFile)) byFile.set(testFile, []);
    byFile.get(testFile).push(id);
  }
  for (const [testFile, ids] of byFile) {
    let content;
    try {
      content = readFile(testFile);
    } catch {
      assert.fail(`adapted browser check test file not found: ${testFile} (covers ${ids.join(', ')})`);
    }
    for (const id of ids) {
      assert.match(
        content,
        new RegExp(`${id}(?!\\d)`),
        `${testFile} no longer references ${id} — a production instance for this adapted browser check was deleted`,
      );
    }
  }
}

const completionEvidencePlaceholders = new Set([
  'todo',
  'tbd',
  'pending',
  'placeholder',
  '待补',
  '—',
]);

function parseCompletionEvidence(id, completionEvidence) {
  const evidence = new Map();
  for (const entry of completionEvidence.split(';').map((part) => part.trim())) {
    const match = /^([a-z][a-z-]*)=(.*)$/.exec(entry);
    assert.ok(match, `${id} has invalid completion evidence syntax`);
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    assert.ok(value, `${id} missing evidence value: ${key}`);
    assert.ok(
      !completionEvidencePlaceholders.has(value.toLowerCase()),
      `${id} has placeholder completion evidence value: ${key}=${value}`,
    );
    assert.ok(!evidence.has(key), `${id} has duplicate completion evidence key: ${key}`);
    evidence.set(key, value);
  }
  return evidence;
}

function requireEvidenceValue(id, evidence, key) {
  assert.ok(evidence.get(key), `${id} missing evidence value: ${key}`);
}

function verifyMigrationMatrixProgress(matrix) {
  const pageRows = parseMigrationMatrixRows(matrix, 'P');
  const actionRows = parseMigrationMatrixRows(matrix, 'A');
  assert.equal(pageRows.length, 11, 'expected 11 page/entry migration rows');
  assert.equal(actionRows.length, 31, 'expected 31 action/fact migration rows');

  const expectedIds = [
    ...Array.from({ length: 11 }, (_, index) => `P${String(index + 1).padStart(3, '0')}`),
    ...Array.from({ length: 31 }, (_, index) => `A${String(index + 1).padStart(3, '0')}`),
  ];
  const rows = [...pageRows, ...actionRows];
  assert.deepEqual(rows.map((row) => row[0]), expectedIds, 'migration row ids must be unique and contiguous');

  const targetDispositions = new Set(['migrated', 'deferred', 'retired']);
  const implementationStatuses = new Set(['inventoried', 'migrated', 'deferred', 'retired']);
  for (const row of rows) {
    assert.ok(
      row.length === (row[0].startsWith('P') ? 13 : 14),
      `${row[0]} must include target disposition, implementation status, and completion evidence`,
    );
    const [id, , , , , targetDisposition, implementationStatus, completionEvidence] = row;
    assert.ok(targetDispositions.has(targetDisposition), `${id} has invalid target disposition`);
    assert.ok(implementationStatuses.has(implementationStatus), `${id} has invalid implementation status`);
    assert.ok(completionEvidence, `${id} is missing completion evidence`);
    if (implementationStatus === 'inventoried') {
      assert.equal(completionEvidence, 'pending', `${id} must remain pending before implementation`);
      continue;
    }

    assert.equal(implementationStatus, targetDisposition, `${id} implementation must match its frozen target`);
    assert.notEqual(completionEvidence, 'pending', `${id} completed status requires evidence`);
    const evidence = parseCompletionEvidence(id, completionEvidence);
    if (implementationStatus === 'migrated') {
      for (const evidenceKey of ['route', 'data', 'write', 'browser']) {
        requireEvidenceValue(id, evidence, evidenceKey);
      }
    } else {
      assert.equal(evidence.get('registry'), 'absent', `${id} removal evidence must prove registry absence`);
      requireEvidenceValue(id, evidence, implementationStatus === 'deferred' ? 'owner' : 'decision');
    }
  }
}

function verifyV03FixtureJourney(versionPlan) {
  requirePhrases(
    [versionPlan],
    [
      '`v02-fixture-contract.md`',
      'source commit `5ef5055`',
      'release schema v10 原始 fixture',
      'v10 → v11 → current head',
    ],
  );
  assert.doesNotMatch(
    versionPlan,
    /v0\.2\s*(?:最新|latest)(?:\s+schema)?\s+fixture/i,
    'v0.3 acceptance must not use an ambiguous latest v0.2 fixture',
  );
}

function verifyDraftGenerationContract(documents) {
  const phrases = [
    '`generation` 是同一 key 的 shell 生命周期代际',
    '清除记录不得重置 generation high-water',
    '`revision` 只在同一 generation 内单调递增',
    '提交开始时捕获 key + generation + revision',
    '只有匹配 key、generation 与 revision 的成功响应可以清除',
    '显式丢弃在 pending 期间仍然允许',
    '旧请求迟到的成功或失败响应都只能成为 no-op',
    'submit N → discard while pending → retype → old success',
    '重置 generation high-water',
    '只比较 revision',
  ];
  const normalized = documents.join('\n').replace(/\s+/g, '');
  for (const phrase of phrases) {
    assert.ok(
      normalized.includes(phrase.replace(/\s+/g, '')),
      `missing v0.3 planning contract: ${phrase}`,
    );
  }
  assert.doesNotMatch(
    normalized,
    /只有匹配key与revision的成功响应可以清除/,
    'draft cleanup must not compare revision without generation',
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

test('F009-DOC-R1-001: the migration matrix is a frozen development input', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md'),
  ];
  const phrases = [
    'status**: frozen-for-development',
    '本矩阵是 F009 进入编码前的冻结设计输入',
    '页面与入口清单',
    '动作与事实清单',
    'T001 只维护和校验已经冻结的矩阵',
    '发现漏项须先补矩阵门禁',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('F009-DOC-R1-001: the frozen migration matrix is a development input', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md'),
  ];
  const phrases = [
    '本矩阵是 F009 进入编码前的冻结设计输入',
    'inventory_baseline: `main@53c3c55`',
    '## 2. 页面与入口清单',
    '## 3. 动作与事实清单',
    'migrated / deferred / retired',
    'stable-shell / final-surface / transitional-host',
    'T001 只维护和校验已经冻结的矩阵',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

const P001_ROW_PATTERN = /^\| P001 \|[^\n]*/m;

function replaceP001Row(matrix, replacement) {
  return matrix.replace(P001_ROW_PATTERN, replacement);
}

const P001_COMPLETED_ROW =
  '| P001 | `App.tsx` + `AppLayout` | 三栏 App Shell、当前对象选择、全局反馈 | projects / issues / workspace 聚合读取 | `web/src/app.test.tsx` | migrated | migrated | route=/ (ApplicationShell); data=GET /api/projects; write=none; browser=e2e/tests/f009-shell.spec.ts::BC-070 the rail is the only primary navigation | stable-shell | `ApplicationShell` | — | — | — |';

test('F009-DOC-R6-010: migration targets and implementation progress are independently tracked', () => {
  const matrix = read(
    'docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md',
  );

  verifyMigrationMatrixProgress(matrix);

  const blankStatus = replaceP001Row(
    matrix,
    P001_COMPLETED_ROW.replace('| migrated | migrated |', '| migrated | |'),
  );
  assert.notEqual(blankStatus, matrix, 'status mutation must change a migration row');
  assert.throws(() => verifyMigrationMatrixProgress(blankStatus), /invalid implementation status/);

  const forgedCompletion = replaceP001Row(
    matrix,
    P001_COMPLETED_ROW.replace('migrated | migrated | route=', 'migrated | inventoried | route='),
  );
  assert.notEqual(forgedCompletion, matrix, 'completion mutation must change a migration row');
  assert.throws(
    () => verifyMigrationMatrixProgress(forgedCompletion),
    /must remain pending before implementation/,
  );

  const missingEvidence = replaceP001Row(
    matrix,
    P001_COMPLETED_ROW.replace(
      'route=/ (ApplicationShell); data=GET /api/projects; write=none; browser=e2e/tests/f009-shell.spec.ts::BC-070 the rail is the only primary navigation',
      '',
    ),
  );
  assert.notEqual(missingEvidence, matrix, 'evidence mutation must change a migration row');
  assert.throws(() => verifyMigrationMatrixProgress(missingEvidence), /missing completion evidence|placeholder completion evidence/);
});

test('F009-DOC-R7-013: completed migration evidence has non-empty disposition-specific values', () => {
  const matrix = read(
    'docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md',
  );

  const withRow = (evidence) => replaceP001Row(matrix, P001_COMPLETED_ROW.replace(/route=[^|]*/, evidence));

  const emptyMigratedEvidence = withRow('route= data= write= browser=');
  assert.notEqual(emptyMigratedEvidence, matrix, 'empty migrated-evidence mutation must change a row');
  assert.throws(
    () => verifyMigrationMatrixProgress(emptyMigratedEvidence),
    /invalid completion evidence|missing evidence value/,
  );

  const emptyCanonicalValues = withRow('route=; data=; write=; browser=');
  assert.notEqual(emptyCanonicalValues, matrix, 'empty canonical-value mutation must change a row');
  assert.throws(() => verifyMigrationMatrixProgress(emptyCanonicalValues), /missing evidence value: route/);

  const validMigratedEvidence = withRow(
    'route=/ (ApplicationShell); data=GET /api/projects; write=none; browser=e2e/tests/f009-shell.spec.ts::BC-070 the rail is the only primary navigation',
  );
  assert.doesNotThrow(() => verifyMigrationMatrixProgress(validMigratedEvidence));

  for (const placeholder of ['TODO', 'tBd', 'PeNdInG', 'placeholder', '待补', '—']) {
    const placeholderValue = withRow(
      `route= ${placeholder} ; data=GET /api/projects; write=none; browser=e2e/tests/f009-shell.spec.ts::BC-070`,
    );
    assert.notEqual(placeholderValue, matrix, `${placeholder} mutation must change a migration row`);
    assert.throws(
      () => verifyMigrationMatrixProgress(placeholderValue),
      /placeholder completion evidence value/,
    );
  }

  const placeholderDeferredOwner = matrix.replace(
    P001_ROW_PATTERN,
    '| P001 | old | capability | api | test | deferred | deferred | registry=absent; owner=placeholder | stable-shell | ApplicationShell | — | — | — |',
  );
  assert.throws(
    () => verifyMigrationMatrixProgress(placeholderDeferredOwner),
    /placeholder completion evidence value/,
  );

  const placeholderRetiredDecision = matrix.replace(
    P001_ROW_PATTERN,
    '| P001 | old | capability | api | test | retired | retired | registry=absent; decision=TODO | stable-shell | ApplicationShell | — | — | — |',
  );
  assert.throws(
    () => verifyMigrationMatrixProgress(placeholderRetiredDecision),
    /placeholder completion evidence value/,
  );
});

test('F009-DOC-R1-002: M1 routes have stable identities and deterministic failures', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    'M1 不发布 `/sessions/:sessionId`',
    '`taskId` 在 M1 中严格等于既有 Issue ID',
    '`projectId` 严格等于既有 Project ID',
    '`/tasks/:taskId` | Task object',
    '`/projects/:projectId` | Project object',
    '`route_issue=unsupported-view`',
    'History 前进 / 后退必须重放 URL',
    'F012 发布 Session ID 后才注册 `/sessions/:sessionId`',
  ];
  const forbidden = ['F009 新增 `/tasks/:taskId/:view?`、`/projects/:projectId/:tab?`、`/sessions/:sessionId`'];

  requirePhrases(documents, phrases);
  forbidPhrases(documents, forbidden);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, forbidden[0]);
});

test('F009-DOC-R1-003: M1 SurfaceRegistry enumerates every V3.44 primary slot', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    'M1 SurfaceRegistry manifest',
    '| 任务 | `enabled` | `/tasks`',
    '| 会话 | `not-registered` | — |',
    '| 项目 | `enabled` | `/projects`',
    '| 自动化 | `not-registered` | — |',
    '| 记忆 | `not-registered` | — |',
    '| 能力 | `not-registered` | — |',
    '| 运行时 | `enabled` | `/runtime`',
    '| 统计 | `not-registered` | — |',
    '| 设置 | `enabled` | `/settings/system-diagnostics`',
    'M1 没有 `visible-disabled` 槽位',
    '代码目录绑定只在 `/projects/:projectId`',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('F009-DOC-R1-004: every retained write has one transitional host and owner', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md'),
  ];
  const phrases = [
    'A006–A015',
    'A016–A020 是只读事实',
    'A021–A024 是保留的用户动作',
    '`POST /api/issues/:id/validation`',
    '`POST /api/issues/:id/unblock`',
    '`POST /api/issues/:id/validation-rounds/reset`',
    '同一个 action ID 在生产 registry 中只能挂到一个 host',
    '旧 Workflow Template 的 A030 保持 retired',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('F009-DOC-R1-005: the v0.2 fixture has a pinned source and upgrade path', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/v02-fixture-contract.md'),
  ];
  const phrases = [
    'source_commit: `5ef5055`',
    'source_schema: `v10`',
    'target_schema_at_review: `v11`',
    '不得调用当前 public API 造数',
    'v10 → v11 → current head',
    '至少两个 Issue 与多个 Run 同时存在',
    'T000 (`FR-003`, `NFR-001`)',
    'Phase 0 fixture 通过前不得执行 T001',
  ];

  requirePhrases(documents, phrases);
  forbidPhrases(documents, ['v0.2 最新 schema fixture']);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, 'v0.2 最新 schema fixture');
});

test('F009-DOC-R6-011: v0.3 acceptance starts from the pinned release v10 fixture', () => {
  const versionPlan = read('docs/features/0.3/README.md');

  verifyV03FixtureJourney(versionPlan);

  const ambiguousSource = versionPlan.replace('release schema v10 原始 fixture', 'v0.2 最新 fixture');
  assert.notEqual(ambiguousSource, versionPlan, 'fixture-source mutation must change the version plan');
  assert.throws(() => verifyV03FixtureJourney(ambiguousSource), /missing v0\.3 planning contract|ambiguous latest/);

  const skippedV10 = versionPlan.replace('v10 → v11 → current head', 'v11 → current head');
  assert.notEqual(skippedV10, versionPlan, 'upgrade-chain mutation must change the version plan');
  assert.throws(() => verifyV03FixtureJourney(skippedV10), /missing v0\.3 planning contract/);
});

test('F009-DOC-R1-006: all 125 V3.44 browser checks have an explicit disposition', () => {
  const catalog = read(
    'docs/features/0.3/F009-v344-frontend-foundation-migration/v344-browser-check-applicability.md',
  );
  const implementationNotes = read(
    'ui-reference/personahub-draft/personahub-v3.1/browser-check.mjs',
  );
  assert.equal((implementationNotes.match(/await check\(/g) ?? []).length, 125);
  const sourceChecksum = createHash('sha256').update(implementationNotes).digest('hex');
  assert.ok(catalog.includes(`source_sha256: ${sourceChecksum}`), 'browser-check source checksum drifted');
  verifyBrowserCheckApplicability(catalog);
  const removeFirstCatalogRow = (input) =>
    input.replace(/^\| BC-001 \|[^\r\n]*(?:\r?\n|$)/m, '');
  const mutated = removeFirstCatalogRow(catalog);
  assert.notEqual(mutated, catalog, 'LF mutation must remove BC-001');
  assert.throws(() => verifyBrowserCheckApplicability(mutated), /expected 125 classified browser checks/);
  const crlfCatalog = catalog.replace(/\r?\n/g, '\r\n');
  const crlfMutated = removeFirstCatalogRow(crlfCatalog);
  assert.notEqual(crlfMutated, crlfCatalog, 'CRLF mutation must remove BC-001');
  assert.throws(
    () => verifyBrowserCheckApplicability(crlfMutated),
    /expected 125 classified browser checks/,
  );
  assert.notEqual(
    createHash('sha256').update(implementationNotes.replace('任务面是主角', '任务面')).digest('hex'),
    sourceChecksum,
  );
  requirePhrases(
    [catalog],
    [
      '新增或改变共享交互形态时必须先更新本清单',
      'adapted 必须落入 F009 生产浏览器门禁',
      'deferred 不得进入 F009 production registry',
    ],
  );
});

test('F009-CODE-R1-006: every adapted browser check has a locked, non-placeholder production test', () => {
  const catalog = read(
    'docs/features/0.3/F009-v344-frontend-foundation-migration/v344-browser-check-applicability.md',
  );
  const rows = parseAdaptedBrowserChecks(catalog);
  assert.equal(rows.length, 28, `expected 28 adapted rows parsed, got ${rows.length}`);
  assert.deepEqual(
    new Set(rows.map((r) => r.id)).size,
    28,
    'adapted browser check ids must be unique — a duplicate would silently under-count real coverage',
  );

  const realContent = new Map(rows.map(({ testFile }) => [testFile, read(testFile)]));
  const readFile = (testFile) => {
    if (!realContent.has(testFile)) throw new Error(`unexpected test file: ${testFile}`);
    return realContent.get(testFile);
  };

  // Green on the real repo state — every one of the 28 rows' file really
  // contains a reference to its own id right now.
  verifyAdaptedInventory(catalog, readFile);

  // Deleting one row from the catalog must turn the count check red.
  const droppedRow = catalog.replace(/^\| BC-050 \|[^\r\n]*(?:\r?\n|$)/m, '');
  assert.notEqual(droppedRow, catalog, 'mutation must actually remove the BC-050 row');
  assert.throws(() => verifyAdaptedInventory(droppedRow, readFile), /expected 28 adapted browser checks/);

  // Deleting the in-file reference for one adapted id — the case the review
  // found unprovable — must turn this red even though the catalog row and
  // every other row's coverage stay untouched.
  const a11yFile = 'e2e/tests/f009-a11y.spec.ts';
  const withoutBc050 = realContent.get(a11yFile).replaceAll('BC-050', 'redacted');
  assert.notEqual(withoutBc050, realContent.get(a11yFile), 'mutation must actually remove BC-050 references');
  const mutatedReadFile = (testFile) => (testFile === a11yFile ? withoutBc050 : readFile(testFile));
  assert.throws(() => verifyAdaptedInventory(catalog, mutatedReadFile), /no longer references BC-050/);

  // A file the catalog names but that doesn't exist on disk must also fail,
  // not silently pass with empty coverage.
  const missingFileReadFile = (testFile) => {
    if (testFile === a11yFile) throw new Error('ENOENT');
    return readFile(testFile);
  };
  assert.throws(() => verifyAdaptedInventory(catalog, missingFileReadFile), /test file not found/);
});

test('F009-DOC-R1-007: draft ownership and cleanup semantics are deterministic', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    '`TaskDraftStore` 由 `ApplicationShell` 持有',
    '`task:${taskId}:composer`',
    '切换 task、project、surface 或后续四个 task view 均不清除',
    '浏览器刷新不恢复草稿',
    '`beforeunload`',
    '提交失败保留原记录',
    '提交开始时捕获 key + generation + revision',
    '对象 not-found / deleted 时同样清除记录',
    'T004 (`UX-002`, `NFR-002`)',
  ];

  requirePhrases(documents, phrases);
  verifyMutation(documents, phrases);
});

test('F009-DOC-R6-012: discard and retype cannot reuse a pending draft identity', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];

  verifyDraftGenerationContract(documents);

  const resetGeneration = documents.map((document) =>
    document.replace('清除记录不得重置 generation high-water', '清除记录会重置 generation high-water'),
  );
  assert.notDeepEqual(resetGeneration, documents, 'generation-reset mutation must change the contract');
  assert.throws(() => verifyDraftGenerationContract(resetGeneration), /missing v0\.3 planning contract/);

  const revisionOnly = documents.map((document) =>
    document.replace('提交开始时捕获 key + generation + revision', '提交开始时捕获 key + revision'),
  );
  assert.notDeepEqual(revisionOnly, documents, 'revision-only mutation must change the contract');
  assert.throws(() => verifyDraftGenerationContract(revisionOnly), /missing v0\.3 planning contract/);
});

test('F009-DOC-R2-008: entry and task-list routes never guess an active project', () => {
  const documents = [
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/design.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md'),
  ];
  const phrases = [
    '`/` | 已发布 legacy entry | `replace` 到 `/projects`',
    '`/tasks` | Task list | 未指定 `project` query 时显示项目选择',
    '不得默认选择列表第一项',
    '用户明确选择 Project 后才 `push`',
  ];
  const forbidden = ['API 稳定顺序的第一项', 'Project 列表第一项加载既有 Issue 列表'];

  requirePhrases(documents, phrases);
  forbidPhrases(documents, forbidden);
  verifyMutation(documents, phrases);
  verifyForbiddenMutation(documents, forbidden[0]);
});

test('F009 design-gate status is synchronized across roadmap documents', () => {
  const documents = [
    read('CLAUDE.md'),
    read('BACKLOG.md'),
    read('docs/features/0.3/README.md'),
    read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md'),
  ];
  const phrases = [
    'status: review',
    'eval_contract: exempt',
    '| F009 | 0.3     | V3.44 Frontend Foundation & Migration | review |',
    'F009 开发与自检已完成并进入 `review`（`npm run verify:release` 全绿）',
    'F010–F014 仍为 `draft`',
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
    '`/tasks/:taskId`',
    '`/projects/:projectId`',
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

// F009 T020 (FR-007 / NFR-003 / NFR-004): the old shell has left the
// production registry, every migrated write action keeps exactly one
// production host, retired template writes are unreachable, and every
// transitional host in the frozen matrix still carries its replacement owner,
// delete condition, and latest milestone.

const F009_WEB_SRC = 'web/src';

function listProductionWebFiles(dir = F009_WEB_SRC) {
  const entries = [];
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    const full = `${dir}/${name}`;
    const stat = statSync(new URL(`../${full}`, import.meta.url));
    if (stat.isDirectory()) {
      entries.push(...listProductionWebFiles(full));
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) {
      entries.push(full);
    }
  }
  return entries;
}

const F009_WRITE_API_HOSTS = new Map([
  ['projects.create', ['web/src/hooks/use-projects.ts']],
  ['workspaces.bind', ['web/src/hooks/use-workspace.ts']],
  ['issues.create', ['web/src/hooks/use-issues.ts']],
  ['issues.startGraph', ['web/src/components/thread/ThreadView.tsx']],
  ['graphRuns.cancel', ['web/src/components/thread/ThreadView.tsx']],
  ['graphRuns.retryNode', ['web/src/components/thread/ThreadView.tsx']],
  ['graphRuns.resolveExecutors', ['web/src/components/thread/ThreadView.tsx']],
  ['runs.create', ['web/src/hooks/use-runs.ts']],
  ['runs.cancel', ['web/src/hooks/use-runs.ts']],
  ['validation.triggerValidation', ['web/src/hooks/use-validation.ts']],
  ['validation.unblock', ['web/src/hooks/use-validation.ts']],
  ['validation.resetRounds', ['web/src/hooks/use-validation.ts']],
  ['intake.recommend', ['web/src/components/intake/IntakeDialog.tsx']],
  ['intake.confirm', ['web/src/components/intake/IntakeDialog.tsx']],
  ['adapters.create', ['web/src/hooks/use-adapters.ts']],
  ['adapters.update', ['web/src/hooks/use-adapters.ts']],
  ['adapters.delete', ['web/src/hooks/use-adapters.ts']],
  ['adapters.validate', ['web/src/hooks/use-adapters.ts']],
  ['adapters.setDefault', ['web/src/hooks/use-adapters.ts']],
  // A030: retired — the read-only legacy page never reaches these.
  ['workflowTemplates.createVersion', []],
  ['workflowTemplates.activate', []],
  ['workflowTemplates.deactivate', []],
]);

test('F009-T020-001: every write action has one production host and retired writes are unreachable', () => {
  const productionFiles = listProductionWebFiles().filter((file) => file !== 'web/src/lib/api-client.ts');
  const productionSources = productionFiles.map((file) => ({ file, source: read(file) }));

  for (const [apiMethod, allowedHosts] of F009_WRITE_API_HOSTS) {
    const hosts = productionSources
      .filter(({ source }) => source.includes(`apiClient.${apiMethod}`))
      .map(({ file }) => file)
      .sort();
    assert.deepEqual(
      hosts,
      [...allowedHosts].sort(),
      `write action ${apiMethod} must be reachable only from its single frozen host`,
    );
  }

  // Old shell identifiers must not survive anywhere in production source.
  const retiredIdentifiers = [
    'AppLayout',
    'ProjectSwitcher',
    'WorkflowTemplateAdminDialog',
    'RuntimeHealthDialog',
    'NoProject',
    'NoWorkspace',
    'NoIssue',
  ];
  for (const identifier of retiredIdentifiers) {
    const holders = productionSources.filter(({ source }) => source.includes(identifier)).map(({ file }) => file);
    assert.deepEqual(holders, [], `retired component ${identifier} must not be referenced in production`);
  }
  for (const retiredPath of [
    'web/src/components/layout/AppLayout.tsx',
    'web/src/components/project/ProjectSwitcher.tsx',
    'web/src/components/workflow-template/WorkflowTemplateAdminDialog.tsx',
    'web/src/components/runtime-health/RuntimeHealthDialog.tsx',
    'web/src/components/empty-states/NoProject.tsx',
    'web/src/components/empty-states/NoWorkspace.tsx',
    'web/src/components/empty-states/NoIssue.tsx',
  ]) {
    assert.throws(() => read(retiredPath), /ENOENT/, `retired file ${retiredPath} must be deleted`);
  }
});

test('F009-T020-002: every transitional host in the matrix has owner, delete condition, and milestone', () => {
  const matrix = read('docs/features/0.3/F009-v344-frontend-foundation-migration/migration-matrix.md');
  const rows = parseMigrationMatrixRows(matrix, 'P').concat(parseMigrationMatrixRows(matrix, 'A'));

  // Page rows: | id | old | capability | api | test | target | status | evidence | lifecycle | entry | owner | delete | milestone |
  // Action rows carry one more column (canonical write API) before owner.
  for (const row of rows) {
    const lifecycle = row.find((cell) => /^stable-shell$|^final-surface$|^transitional-host$/.test(cell));
    assert.ok(lifecycle, `${row[0]} must declare a lifecycle classification`);
    if (lifecycle !== 'transitional-host') continue;
    const [owner, deleteWhen, milestone] = row.slice(-3);
    assert.ok(owner && owner !== '—', `${row[0]} transitional host needs a replacement_owner`);
    assert.ok(deleteWhen && deleteWhen !== '—', `${row[0]} transitional host needs a delete_when`);
    assert.ok(milestone && /^M\d$/.test(milestone), `${row[0]} transitional host needs a latest_milestone`);
  }
});
test('F009-DOC-R6-014: review-state documents stay consistent with execution artifacts', () => {
  const spec = read('docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md');
  const statusMatch = /^status: (review|done)$/m.exec(spec);
  assert.ok(statusMatch, 'F009 spec must declare review or done status for this gate');
  const state = statusMatch[1];

  const tasks = read('docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md');
  const uncheckedTasks = [...tasks.matchAll(/^- \[ \] (T\d{3})/gm)].map((m) => m[1]);
  assert.deepEqual(uncheckedTasks, [], `F009 is ${state} but tasks remain unchecked`);
  const uncheckedAcs = [...spec.matchAll(/^- \[ \] \*\*(AC-\d{3})\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(uncheckedAcs, [], `F009 is ${state} but ACs remain unchecked`);

  // T031 execution evidence must be archived in the journey matrix, bound to
  // a real commit — no placeholder.
  const journey = read('docs/reviews/journey-test-matrix.md');
  assert.doesNotMatch(journey, /待 T021 回填|待 T022 回填|execution_evidence: pending/);
  verifyExecutionEvidenceCommit(journey, commitExists);
});

test('F009-CODE-R1-011: execution_evidence_commit must resolve to a real commit, not just look like one', () => {
  const journey = read('docs/reviews/journey-test-matrix.md');

  // Green against the real repo and the real git history.
  verifyExecutionEvidenceCommit(journey, commitExists);

  // A hex string that was never a commit here must fail even though the
  // format regex alone would have accepted it — this is the exact gap
  // review R1-011 found (format-only validation, no existence check).
  const fakeHash = '0123456789abcdef0123456789abcdef01234567';
  const journeyWithFakeHash = journey.replace(
    /execution_evidence_commit: [0-9a-f]{7,40}/,
    `execution_evidence_commit: ${fakeHash}`,
  );
  assert.notEqual(journeyWithFakeHash, journey, 'mutation must actually replace the commit hash');
  assert.throws(
    () => verifyExecutionEvidenceCommit(journeyWithFakeHash, commitExists),
    /does not resolve to a real commit/,
  );

  // Proves the assertion path itself is wired to commitExistsFn's result,
  // independent of whether fakeHash happens to collide with a real object.
  assert.throws(() => verifyExecutionEvidenceCommit(journey, () => false), /does not resolve to a real commit/);
});

/**
 * T031's "confirm no entry point" pass over the 96 deferred browser checks
 * (docs/reviews/journey-test-matrix.md §5.1) was previously all-manual.
 * Most deferred rows aren't independent claims — they're sub-features of a
 * small number of routes/nav-slots that are *already* mechanically proven
 * unreachable by two existing production tests:
 *
 *  - `f009-shell.spec.ts`'s BC-070 case asserts the primary nav renders
 *    exactly the 4 enabled surfaces and zero buttons for the 5 not-registered
 *    ones (会话/自动化/记忆/能力/统计) — covers every deferred row whose
 *    entire owning surface doesn't exist yet.
 *  - `f009-golden-journey.spec.ts`'s S1 case asserts three route families
 *    are generically unreachable (`/tasks/:id/:view` → unsupported-view,
 *    `/projects/:id/:tab` → unsupported-tab, `/sessions/:id` → not found) —
 *    per route-manifest.ts these match ANY segment value, so one example
 *    route per family proves the whole family, not just that one case.
 *
 * This does NOT eliminate T031 — roughly a third of the 96 are sub-elements
 * of already-*enabled* pages (e.g. "no pause-all button on /runtime") that
 * still need individual verification, and are deliberately left out of the
 * covered buckets below rather than guessed at.
 */
function classifyDeferredBrowserChecks(catalog) {
  const rows = [...catalog.matchAll(/^\| (BC-\d{3}) \|.+\| deferred \|.+\|.+\|.+\|$/gm)].map((m) => m[1]);

  // Sub-features of the task four-view route family (F011) — any row whose
  // reason column ties it to task-view/acceptance/evidence/trace projection
  // reachable only via /tasks/:id/:view.
  const TASK_VIEW = new Set([
    'BC-003', 'BC-004', 'BC-009', 'BC-010', 'BC-011', 'BC-012', 'BC-013', 'BC-014', 'BC-015', 'BC-016',
    'BC-017', 'BC-018', 'BC-019', 'BC-020', 'BC-021', 'BC-022', 'BC-023', 'BC-024', 'BC-025', 'BC-026',
    'BC-034', 'BC-035', 'BC-036', 'BC-037', 'BC-038', 'BC-039', 'BC-059', 'BC-071',
  ]);
  // Sub-features reachable only via /sessions/:id.
  const SESSION = new Set(['BC-008', 'BC-029']);
  // Sub-features reachable only via /projects/:id/:tab.
  const PROJECT_TAB = new Set(['BC-060', 'BC-073']);
  // Sub-features of a whole not-registered top-level surface (记忆/自动化/
  // 统计/能力, or a concept — plugin/MCP/notifications/monitoring — that was
  // never given a SurfaceId at all, so it has strictly less reachability
  // than a not-registered one).
  const NAV_ABSENT = new Set([
    'BC-041', 'BC-061', 'BC-062', 'BC-063', 'BC-064', 'BC-065', 'BC-066', 'BC-067', 'BC-069', 'BC-074',
    'BC-077', 'BC-078', 'BC-079', 'BC-080', 'BC-081', 'BC-084', 'BC-085', 'BC-092', 'BC-093', 'BC-094',
    'BC-095', 'BC-096', 'BC-098', 'BC-099', 'BC-100', 'BC-104', 'BC-114', 'BC-115', 'BC-117', 'BC-118',
    'BC-121',
  ]);
  // BC-105 alone: a forbidden-term content check (web/src/f009-content-contract.test.ts).
  const CONTENT_CONTRACT = new Set(['BC-105']);
  // The settings catalog is proven closed at exactly 2 entries by BC-097
  // (f009-shell.spec.ts) — any row describing a settings page/section that
  // would need its own catalog entry is covered by that same closed count,
  // with no new test needed.
  const SETTINGS_CATALOG_CLOSED = new Set(['BC-055', 'BC-083', 'BC-111', 'BC-120']);
  // ThreadView's composer has no model/depth selector, context-scope
  // selector, eligibility-rationale explainer, or undo window
  // (f009-deferred-boundary.spec.ts).
  const COMPOSER_ABSENT = new Set(['BC-027', 'BC-028', 'BC-040', 'BC-058']);
  // /runtime has no pause-all, quota, machine-rail/adapter-tabs, capability
  // matrix, log-export, machine-health, or per-task controls (same spec).
  const RUNTIME_PAGE_ABSENT = new Set(['BC-054', 'BC-082', 'BC-087', 'BC-088', 'BC-090', 'BC-101', 'BC-116']);
  // /runtime/adapters has no dedicated four-block adapter detail page — the
  // compat entry is a flat config dialog, not a route (same spec).
  const ADAPTER_DETAIL_ABSENT = new Set(['BC-108', 'BC-109']);
  // A project's WorkspaceBinding has no remote-repo recognition, Skills
  // reference, or primary/reference repo distinction (same spec).
  const WORKSPACE_BINDING_MINIMAL = new Set(['BC-102', 'BC-107', 'BC-112']);
  // CreateIssueDialog has no issue-type selector — coding is the only shape
  // it can produce (same spec).
  const TASK_CREATE_MINIMAL = new Set(['BC-033']);

  const covered = new Set([
    ...TASK_VIEW, ...SESSION, ...PROJECT_TAB, ...NAV_ABSENT, ...CONTENT_CONTRACT,
    ...SETTINGS_CATALOG_CLOSED, ...COMPOSER_ABSENT, ...RUNTIME_PAGE_ABSENT, ...ADAPTER_DETAIL_ABSENT,
    ...WORKSPACE_BINDING_MINIMAL, ...TASK_CREATE_MINIMAL,
  ]);

  // Data-model / business-rule / cross-feature claims with no discrete UI
  // element whose absence is checkable — e.g. BC-031/032 are about a future
  // eleven-state task projection's data shape, not a reachable control;
  // BC-110 is F014's own cross-feature completeness audit. Listed
  // explicitly (not silently dropped) so every one of the 96 is accounted
  // for in exactly one bucket.
  const NOT_APPLICABLE = new Set([
    'BC-031', 'BC-032', 'BC-042', 'BC-043', 'BC-068', 'BC-086', 'BC-089', 'BC-103', 'BC-106', 'BC-110', 'BC-113',
  ]);

  const accounted = new Set([...covered, ...NOT_APPLICABLE]);
  const residual = rows.filter((id) => !accounted.has(id));
  return {
    rows, covered, notApplicable: NOT_APPLICABLE, residual,
    buckets: {
      TASK_VIEW, SESSION, PROJECT_TAB, NAV_ABSENT, CONTENT_CONTRACT, SETTINGS_CATALOG_CLOSED,
      COMPOSER_ABSENT, RUNTIME_PAGE_ABSENT, ADAPTER_DETAIL_ABSENT, WORKSPACE_BINDING_MINIMAL, TASK_CREATE_MINIMAL,
    },
  };
}

test('F009-CODE-DEFERRED-INVENTORY: all 96 deferred browser checks are accounted for — provably unreachable, explicitly not-applicable, or a named residual', () => {
  const catalog = read(
    'docs/features/0.3/F009-v344-frontend-foundation-migration/v344-browser-check-applicability.md',
  );
  const shell = read('e2e/tests/f009-shell.spec.ts');
  const journey = read('e2e/tests/f009-golden-journey.spec.ts');
  const contentContract = read('web/src/f009-content-contract.test.ts');
  const boundary = read('e2e/tests/f009-deferred-boundary.spec.ts');

  const { rows, covered, notApplicable, residual } = classifyDeferredBrowserChecks(catalog);
  assert.equal(rows.length, 96, `expected 96 deferred rows parsed, got ${rows.length}`);
  assert.equal(new Set(rows).size, 96, 'deferred browser check ids must be unique');

  // Every bucketed id (covered or not-applicable) must actually be one of
  // the 96 deferred rows — a stale entry (renamed/removed BC id) must fail
  // loudly rather than silently not matching anything.
  const rowSet = new Set(rows);
  for (const id of new Set([...covered, ...notApplicable])) {
    assert.ok(rowSet.has(id), `bucketed id ${id} is not (or no longer) a deferred row in the catalog`);
  }

  // The bucket assignments only mean something if the gates they lean on
  // still make the exact claims this classification depends on.
  assert.match(shell, /BC-070\/BC-007/, 'BC-070 nav-absence case must still exist in f009-shell.spec.ts');
  for (const name of ['会话', '自动化', '记忆', '能力', '统计']) {
    assert.ok(
      shell.includes(`"${name}"`),
      `BC-070 case must still assert "${name}" has zero primary-nav buttons`,
    );
  }
  assert.match(journey, /task-unsupported-view|unsupported-view/, 'S1 must still assert the task-view route family is unreachable');
  assert.match(journey, /unsupported-tab/, 'S1 must still assert the project-tab route family is unreachable');
  assert.match(journey, /\/sessions\//, 'S1 must still assert the session route is unreachable');
  assert.match(contentContract, /权限档/, 'BC-105 content-contract term must still be forbidden');
  assert.match(shell, /catalog\.getByRole\("link"\)\.count\(\)\)\.toBe\(2\)/, 'BC-097 must still assert the settings catalog is closed at exactly 2 entries');
  for (const bcId of ['BC-027/028/040/058', 'BC-033', 'BC-054/082/087/088/090/101/116', 'BC-108/109', 'BC-102/107/112']) {
    assert.ok(boundary.includes(bcId), `f009-deferred-boundary.spec.ts must still have a case named "${bcId}"`);
  }

  // Every one of the 96 must land in exactly one of: proven-covered,
  // explicitly-not-applicable, or the printed residual — never silently
  // dropped.
  console.log(
    `F009-CODE-DEFERRED-INVENTORY: ${covered.size}/${rows.length} deferred checks proven unreachable by existing gates; ` +
      `${notApplicable.size} explicitly not-applicable (no discrete UI element to assert absent); ` +
      `${residual.length} residual still need individual review: ${residual.join(', ') || '(none)'}`,
  );
  assert.equal(
    residual.length,
    0,
    `expected zero unaccounted residual deferred checks, got ${residual.length}: ${residual.join(', ')} — bucket them or add them to NOT_APPLICABLE with a reason, don't leave them unaccounted`,
  );

  // Deleting a bucket's coverage must turn this red: e.g. if BC-070 stopped
  // asserting 记忆 is absent, every NAV_ABSENT-classified Memory row's proof
  // would be gone.
  const shellWithoutMemoryAssertion = shell.replace('"记忆"', '"redacted"');
  assert.notEqual(shellWithoutMemoryAssertion, shell, 'mutation must actually remove the 记忆 assertion');
  assert.throws(
    () => {
      assert.ok(shellWithoutMemoryAssertion.includes('"记忆"'), 'BC-070 case must still assert "记忆" has zero primary-nav buttons');
    },
    /BC-070 case must still assert/,
  );

  // Same proof for the settings-catalog-closed bucket: weakening BC-097's
  // count assertion must turn this red too.
  const shellWithoutClosedCatalog = shell.replace('.toBe(2)', '.toBe(999)');
  assert.notEqual(shellWithoutClosedCatalog, shell, 'mutation must actually change the closed-count assertion');
  assert.throws(() => {
    assert.match(
      shellWithoutClosedCatalog,
      /catalog\.getByRole\("link"\)\.count\(\)\)\.toBe\(2\)/,
      'BC-097 must still assert the settings catalog is closed at exactly 2 entries',
    );
  });
});
