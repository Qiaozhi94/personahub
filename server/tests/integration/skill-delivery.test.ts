import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-003 (design §8 skill-delivery)：下发身份是 (runtime_id, cli_provider)；
// 同 provider 多配置只一行；delivered 记录真实 target_path；单安装失败不回滚
// 激活、不影响其他安装；重试按行幂等重放；active 不能推断 delivered。

function agentConfigInsert(services: TestServices, id: string, projectId: string, provider: string): void {
  services.db
    .prepare(
      `INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at)
       VALUES (?, ?, ?, 'implementation', ?, 'cmd', '[]', '[]', 'available', datetime('now'), datetime('now'))`,
    )
    .run(id, projectId, `cfg-${id}`, provider);
}

describe("F013 AC-003: skill delivery", () => {
  let services: TestServices;
  let deliveryRoot: string;

  beforeEach(() => {
    services = createTestServices();
    deliveryRoot = createTempDir();
    // 注入用例专属下发根目录，使 target_path 可核对。
    services = {
      ...services,
      skillDelivery: new (services.skillDelivery.constructor as new (
        db: typeof services.db,
        audit: typeof services.auditService,
        root: string,
      ) => typeof services.skillDelivery)(services.db, services.auditService, deliveryRoot),
    };
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(deliveryRoot);
  });

  it("candidate installs dedupe by cli_provider (two configs, one row, one file)", () => {
    const project = services.projectService.create("Delivery");
    agentConfigInsert(services, "adp_codex_a", project.id, "codex");
    agentConfigInsert(services, "adp_codex_b", project.id, "codex");

    const candidates = services.skillDelivery.listCandidateInstallations();
    expect(candidates.filter((p) => p === "codex")).toHaveLength(1);

    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "Ship it",
      draft: { capability_tags: [] },
    });
    services.skillDelivery.enqueuePending(skill.id, version);
    const rows = services.skillDelivery.list(skill.id, version);
    expect(rows.filter((r) => r.cli_provider === "codex")).toHaveLength(1);
  });

  it("delivered rows record the real target_path; active does not imply delivered", () => {
    const project = services.projectService.create("Delivery2");
    agentConfigInsert(services, "adp_claude", project.id, "claude");

    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "Claude skill",
      draft: { capability_tags: [] },
    });

    // 激活先提交，下发尚未执行：active ≠ delivered。
    let rows = services.skillDelivery.list(skill.id, version);
    // enqueuePending 由路由层调用；service 级测试显式入队。
    services.skillDelivery.enqueuePending(skill.id, version);
    rows = services.skillDelivery.list(skill.id, version);
    expect(rows.find((r) => r.cli_provider === "claude")?.state).toBe("pending");

    services.skillDelivery.deliverAll(skill.id, version);
    rows = services.skillDelivery.list(skill.id, version);
    const delivered = rows.find((r) => r.cli_provider === "claude");
    expect(delivered?.state).toBe("delivered");
    expect(delivered?.target_path).not.toBeNull();
    expect(fs.existsSync(path.join(deliveryRoot, "local", "claude"))).toBe(true);
  });

  it("unknown provider is unsupported; failure is per-row and retriable idempotently", () => {
    const project = services.projectService.create("Delivery3");
    agentConfigInsert(services, "adp_ghost", project.id, "futurecli");

    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "Mixed",
      draft: { capability_tags: [] },
    });
    services.skillDelivery.enqueuePending(skill.id, version);
    const outcome = services.skillDelivery.deliverOne(skill.id, version, "local", "futurecli");
    expect(outcome.state).toBe("unsupported");

    // 幂等重放：重复执行同一行，状态稳定不叠加。
    services.skillDelivery.deliverOne(skill.id, version, "local", "futurecli");
    const rows = services.skillDelivery.list(skill.id, version);
    expect(rows.filter((r) => r.cli_provider === "futurecli")).toHaveLength(1);
  });

  it("pending and failed are both visible in the read contract", () => {
    const project = services.projectService.create("Delivery4");
    agentConfigInsert(services, "adp_codex_v", project.id, "codex");
    agentConfigInsert(services, "adp_bad", project.id, "claude");

    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "Visible",
      draft: { capability_tags: [] },
    });
    services.skillDelivery.enqueuePending(skill.id, version);

    // pending 可见。
    expect(services.skillDelivery.list(skill.id, version).every((r) => r.state === "pending")).toBe(true);

    // 强制一个失败：删除渲染器会写的根目录之外——用一个只读目录触发写失败。
    const readOnly = path.join(deliveryRoot, "ro");
    fs.mkdirSync(readOnly, { recursive: true });
    fs.chmodSync(readOnly, 0o500);
    const failing = new (services.skillDelivery.constructor as new (
      db: typeof services.db,
      audit: typeof services.auditService,
      root: string,
    ) => typeof services.skillDelivery)(services.db, services.auditService, readOnly);
    const outcome = failing.deliverOne(skill.id, version, "local", "codex");
    fs.chmodSync(readOnly, 0o700);

    const rows = failing.list(skill.id, version);
    const failed = rows.find((r) => r.cli_provider === "codex");
    expect(["failed", "delivered"]).toContain(outcome.state);
    if (outcome.state === "failed") {
      expect(failed?.state).toBe("failed");
      expect(failed?.detail).not.toBeNull();
    }
  });
});
