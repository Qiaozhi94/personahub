---
kind: feature
id: F010
version: "0.3"
status: draft
gate_version: 1
related_features: [F003, F004, F006, F009, F011, F012, F014]
topics: [artifact, revision, provenance, evidence, typed-ref]
doc_kind: spec
created: 2026-08-09
updated: 2026-09-12
---

# F010：Artifact & Provenance Foundation

> Owner: unassigned | Target: v0.3

## 0. 来源与意图

- PRD：第 5.7、5.8、11 节。
- 设计基线：V3.44 任务 · 资源与验收。
- 上游：F003 Trace、F004 Evidence、F006 Work Graph、F009 前端壳层、ADR 0010。
- 意图：让阶段成果以不可漂移 revision 和统一来源契约进入派工与验收。

## 1. 问题、目标与非目标

现有 handoff 主要引用事件与文件变化，缺少可版本化、可消费的阶段成果。目标是建立 Artifact、revision、typed ref、消费记录与 provenance 查询。非目标是实现完整任务页面、Memory、全文搜索或外部对象存储。

## 2. 用户场景

### US-001：登记并查看成果（Priority: P1）

用户能从一个完成的 Attempt 打开阶段成果并查看来源。

**独立测试**：创建 inline 与受控文件两类成果，读取 manifest 与当前 revision。

1. Given Attempt 已提交，when 登记 Artifact，then 返回稳定实体和 revision 1。
2. Given 来源文件缺失，when 打开历史 revision，then 明确显示缺失，不用最新文件替代。

### US-002：稳定消费与追溯（Priority: P1）

下游只通过 typed ref 消费确定 revision，并能反向查看消费者。

**独立测试**：revision 2 发布后，旧派工仍解析 revision 1。

1. Given revision 1 已被派工消费，when Artifact 更新，then 历史消费仍指向 revision 1。
2. Given ref 越权或类型未知，when 解析，then 在启动前阻断并记录原因。

## 3. 范围与边界

### 范围内

- Artifact 实体、不可变 revision、inline Markdown 与代码目录内受控文件。
- `artifact:<id>@<revision>` typed ref 与统一 resolver。
- Issue、Room / Thread、Run / Attempt、创建者、消费者、Evidence 的来源关系。
- loading、empty、missing、invalid 与 hash mismatch 状态。

### 范围外

- 外部 URL / Blob store、富文本协作、跨工作区共享、Memory / Skill 自动沉淀。

### 边界场景

- 路径规范化后越出授权目录必须拒绝。
- DB 成功而文件落盘失败不得留下可消费 revision。
- source locator 与 archive locator 分开保存；工作区源文件后续变化不得改变已发布 archive。
- 同一幂等键只产生一个 revision；并发修订采用 CAS。

## 4. 需求

### 功能需求

- **FR-001**：Artifact 保存归属、类型、标题、来源与当前 revision。
- **FR-002**：revision 内容不可原地覆盖，并保存摘要、创建来源、source locator 与不可变 archive locator；resolver 只读取 archive。
- **FR-003**：resolver 返回确定 revision，缺失 / 越权 / 未知类型显式失败。
- **FR-004**：记录每次派工实际消费的 Artifact revision。
- **FR-005**：可从 Artifact 查来源和消费者，也可从 Run / Evidence 查 Artifact。

### 事件 / Trace 需求

- **TR-001**：创建、修订、消费写结构化事件；解析拒绝在能定位 Artifact 或调用方提供所属 Thread 时写结构化事件，无法定位 Artifact 的 ref 失败只记录服务日志并返回稳定错误码。所有事件只在事务提交后广播。

### 非功能需求

- **NFR-001**：所有写入幂等；进程重启后 revision 与消费链一致。
- **NFR-002**：本地文件读取使用真实路径边界与 hash 校验。

## 5. 生命周期与不变量

Artifact 实体可 active / retired；revision 一经发布不可变。retired 不影响历史解析。当前 revision 只是指针，历史 ref 永不跟随它漂移。F010 不持久化 draft revision；临时内容只有在 manifest 事务提交后才成为 published revision，未发布的临时内容不能被派工消费。

## 6. 成功与验收

### 成功标准

- **SC-001**：下游在没有早期聊天全文时仍能从 refs 读取所需阶段成果。
- **SC-002**：任何历史成果都能解释来源、内容版本和消费者。

### 验收清单

- [ ] **AC-001** (`FR-001`, `FR-002`, `NFR-001`): 两类存储均可创建、修订、重启后读取，历史 revision 不变；文件发布每个故障点 crash 后 resolver 都只能返回完整 published revision 或 not-found。 - tests: `server/tests/integration/artifact-publication.test.ts` `server/tests/integration/migration-artifact.test.ts`
- [ ] **AC-002** (`FR-003`, `NFR-002`): 缺失、越权、hash mismatch、未知类型均在消费前可观察失败。 - tests: `server/tests/unit/artifact-ref.test.ts` `server/tests/integration/artifact-resolver.test.ts`
- [ ] **AC-003** (`FR-004`, `FR-005`, `TR-001`): Run / Artifact / Evidence 双向追溯与事件回放一致。 - tests: `server/tests/integration/artifact-provenance.test.ts` `web/src/f010-artifact-read-model.test.ts`

## 7. 测试、依赖与决策

### 测试策略

Repository / resolver 单测；migration、CAS、文件跨资源一致性和 restart 集成测试；API client 与只读 hooks contract 测试。可见资源视图及浏览器验收归 F011。

### 依赖

依赖 F003、F004、F006 的数据契约；实施顺序上等待 F009 壳层边界冻结。F010 只交付读取 client / hooks，不交付可见 UI；F011、F012、F014 消费本契约。

### 决策与风险

采用实体 + immutable revision；文件只允许授权代码目录内的规范化相对路径。具体 migration 版本在开发前按仓库当前 schema 现值分配，不沿用旧 draft 的预留编号。

## 8. 待确认问题

无。
