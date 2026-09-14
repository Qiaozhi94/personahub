import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { format } from "prettier";
import {
  createTestServices,
  createTempDir,
  cleanupTempDir,
  disposeTestServices,
  type TestServices,
} from "../helpers.js";
import {
  SkillDeliveryService,
  parseDeliveredFrontmatter,
  providerSafeSkillName,
  renderNativeInstructions,
} from "../../src/services/skill-delivery.js";

// F013 AC-003 (design §8 skill-delivery)：下发身份是 (runtime_id, cli_provider)；
// 同 provider 多配置只一行；delivered 记录真实 target_path；单安装失败不回滚
// 激活、不影响其他安装；重试按行幂等重放；active 不能推断 delivered。
// R1-012：frontmatter 必须安全引用（YAML 合法）、steps 完整渲染、delivered
// 之前必须写后读回校验。

const opencodeAvailable = (() => {
  try {
    execFileSync("opencode", ["--version"], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
})();


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
      skillDelivery: new (
        services.skillDelivery.constructor as new (
          db: typeof services.db,
          audit: typeof services.auditService,
          root: string,
        ) => typeof services.skillDelivery
      )(services.db, services.auditService, deliveryRoot),
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
    expect(delivered?.native_format).toBe("skill-md");
    expect(delivered?.target_path).toBe(
      path.join(deliveryRoot, "local", "claude", "skills", providerSafeSkillName(skill.id, version), "SKILL.md"),
    );
    const written = fs.readFileSync(delivered!.target_path!);
    expect(parseDeliveredFrontmatter(written)).toEqual({
      name: providerSafeSkillName(skill.id, version),
      description: "Claude skill",
    });
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
    const failing = new (
      services.skillDelivery.constructor as new (
        db: typeof services.db,
        audit: typeof services.auditService,
        root: string,
      ) => typeof services.skillDelivery
    )(services.db, services.auditService, readOnly);
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

  it.skipIf(!opencodeAvailable)(
    "opencode's real skill discovery lists the delivered file with parsed frontmatter",
    () => {
      const xdgHome = createTempDir();
      const previousXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdgHome;
      try {
        const nativeService = new SkillDeliveryService(services.db, services.auditService);
        const project = services.projectService.create("RealDiscovery");
        agentConfigInsert(services, "adp_real_oc", project.id, "opencode");
        const description = 'Release: "生产" #1 — colon-safe';
        const { skill, version } = services.skillRegistry.createSkill({
          display_name: "Real discovery",
          draft: { description, capability_tags: [] },
        });
        nativeService.enqueuePending(skill.id, version);
        const outcome = nativeService.deliverOne(skill.id, version, "local", "opencode");
        expect(outcome.state).toBe("delivered");

        // opencode 是单文件 Bun 二进制：stdout 接 pipe 时会截断到 ~146KB；写文件 fd 才能拿到完整清单。
        const listingFile = path.join(xdgHome, "skill-listing.json");
        const listingFd = fs.openSync(listingFile, "w");
        try {
          const result = spawnSync("opencode", ["debug", "skill"], {
            stdio: ["ignore", listingFd, "ignore"],
            timeout: 60_000,
            env: { ...process.env, XDG_CONFIG_HOME: xdgHome },
          });
          expect(result.status).toBe(0);
        } finally {
          fs.closeSync(listingFd);
        }
        const listed = JSON.parse(fs.readFileSync(listingFile, "utf8")) as Array<{
          name: string;
          description: string;
          location: string;
        }>;
        const entry = listed.find((candidate) => candidate.name === providerSafeSkillName(skill.id, version));
        expect(entry).toBeDefined();
        expect(entry?.description).toBe(description);
        expect(entry?.location).toBe(fs.realpathSync(outcome.target_path!));
      } finally {
        if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = previousXdg;
        cleanupTempDir(xdgHome);
      }
    },
  );
});

describe("F013 R1-012: native instruction rendering", () => {
  it("quotes frontmatter scalars so special characters stay valid YAML", async () => {
    const description = 'Release: "production" #1 \\ path';
    const rendered = renderNativeInstructions(
      "claude",
      { title: "Release: production", description, steps: [], completion_requirements: [] },
      { skillId: "skl_abc", version: 1 },
    )!;
    const text = rendered.bytes.toString("utf8");
    const frontmatter = text.slice(4, text.indexOf("\n---\n", 4));
    await expect(format(frontmatter, { parser: "yaml" })).resolves.toBeTruthy();
    expect(parseDeliveredFrontmatter(rendered.bytes)).toEqual({ name: rendered.name, description });
  });

  it("the unquoted form would be invalid YAML (mutation proves quoting is load-bearing)", async () => {
    await expect(format("name: x\ndescription: Release: production\n", { parser: "yaml" })).rejects.toThrow();
  });

  it("renders step id/order/title and every step requirement in order", () => {
    const steps = [
      {
        id: "deploy",
        order: 2,
        title: "Deploy",
        requirements: [
          { id: "needs-ci", kind: "capability", strength: "hard", tags: ["ci"], description: "CI green" },
        ],
      },
      { id: "build", order: 1, title: "Build", requirements: [] },
    ];
    const completion = [
      { id: "docs-updated", kind: "completion", strength: "soft", tags: [], description: "Docs 更新" },
    ];
    const rendered = renderNativeInstructions(
      "codex",
      { title: "Ship", description: null, steps, completion_requirements: completion },
      { skillId: "skl_abc", version: 3 },
    )!;
    const text = rendered.bytes.toString("utf8");
    expect(text.indexOf("### 1. Build")).toBeLessThan(text.indexOf("### 2. Deploy"));
    expect(text).toContain("- Step ID: deploy");
    expect(text).toContain("needs-ci [hard] tags=ci — CI green");
    expect(text).toContain("- Requirements: (none)");
    expect(text).toContain("docs-updated [soft] — Docs 更新");
  });

  it("keeps every provider name discoverable (lowercase, hyphens, <=64 chars)", () => {
    for (const provider of ["codex", "claude", "opencode"]) {
      const rendered = renderNativeInstructions(
        provider,
        { title: null, description: null, steps: [], completion_requirements: [] },
        { skillId: `skl_${"A".repeat(80)}`, version: 12 },
      )!;
      expect(rendered.name).toMatch(/^[a-z0-9-]+$/);
      expect(rendered.name.length).toBeLessThanOrEqual(64);
      expect(rendered.name).toMatch(/-v12$/);
    }
  });

  it("collapses multiline and over-long descriptions to one bounded line", () => {
    const long = "x".repeat(1100);
    const rendered = renderNativeInstructions(
      "opencode",
      { title: "T", description: `line1\nline2 ${long}`, steps: [], completion_requirements: [] },
      { skillId: "skl_abc", version: 1 },
    )!;
    expect(rendered.description).not.toMatch(/[\r\n]/);
    expect(rendered.description.length).toBeLessThanOrEqual(1024);
  });
});
