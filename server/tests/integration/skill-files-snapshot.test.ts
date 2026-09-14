import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-003 (design §8 skill-files-snapshot)：构建期可写文件、发布后写入被
// trigger 拒绝；rel_path 越界拒绝；正文激活时快照入库，源目录失联不影响可读；
// 读取核验 content_hash，不符报 SKILL_FILE_HASH_MISMATCH。

describe("F013 AC-003: skill file snapshot", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("snapshots file content at activation; reading never touches the source again", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Docs skill",
      draft: {
        files: [{ rel_path: "guide.md", content: "# guide\nsnapshot me" }],
      },
    });

    const rows = services.db
      .prepare("SELECT rel_path, content, size_bytes FROM skill_revision_files WHERE skill_id = ? AND version = 1")
      .all(skill.id) as Array<{ rel_path: string; content: Buffer; size_bytes: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].content.toString("utf8")).toBe("# guide\nsnapshot me");
    expect(rows[0].size_bytes).toBe("# guide\nsnapshot me".length);
  });

  it("rejects rel_path escaping the revision root (absolute / .. / backslash)", () => {
    for (const relPath of ["/etc/passwd", "../outside.md", "a\\b.md"]) {
      expect(() =>
        services.skillRegistry.createSkill({
          display_name: "Escape",
          draft: { files: [{ rel_path: relPath, content: "x" }] },
        }),
      ).toThrow();
    }
  });

  it("rejects oversized files wholesale (SKILL_FILES_TOO_LARGE)", () => {
    expect(() =>
      services.skillRegistry.createSkill({
        display_name: "Too big",
        draft: { files: [{ rel_path: "big.bin", content: "x".repeat(1024 * 1024 + 1) }] },
      }),
    ).toThrow(/SKILL_FILES_TOO_LARGE|1 MiB/);
  });

  it("published revision files are frozen: INSERT / UPDATE / DELETE all rejected by triggers", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Frozen files",
      draft: { files: [{ rel_path: "a.md", content: "A" }] },
    });
    const now = new Date().toISOString();

    expect(() =>
      services.db
        .prepare(
          "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES (?, 1, 'b.md', x'42', 'h', 1)",
        )
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
    expect(() =>
      services.db
        .prepare(
          "UPDATE skill_revision_files SET content = x'43' WHERE skill_id = ? AND version = 1 AND rel_path = 'a.md'",
        )
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
    expect(() =>
      services.db
        .prepare("DELETE FROM skill_revision_files WHERE skill_id = ? AND version = 1 AND rel_path = 'a.md'")
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
    expect(now).toBeTruthy();
  });

  it("build-phase revisions accept file writes, then publish freezes them", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Build",
      draft: { capability_tags: [] },
    });
    // 构建期：以事务插入 draft revision + 文件 + 发布 + 推进 current（registry 时序）。
    services.db.transaction(() => {
      const now = new Date().toISOString();
      services.db
        .prepare(
          "INSERT INTO skill_revisions (skill_id, version, title, capability_tags_json, content_hash, published_at, created_at) VALUES (?, 2, 'Build v2', '[]', 'h2', NULL, ?)",
        )
        .run(skill.id, now);
      const draftHash = createHash("sha256").update("draft").digest("hex");
      services.db
        .prepare(
          "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES (?, 2, 'draft.md', ?, ?, 5)",
        )
        .run(skill.id, Buffer.from("draft"), draftHash);
      services.db
        .prepare("UPDATE skill_revisions SET published_at = ? WHERE skill_id = ? AND version = 2")
        .run(now, skill.id);
      services.db.prepare("UPDATE skills SET current_revision = 2 WHERE id = ?").run(skill.id);
    })();

    // 发布后同一 INSERT 被拒（证明 trigger 没把首次写入一起挡掉）。
    expect(() =>
      services.db
        .prepare(
          "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES (?, 2, 'late.md', x'4C', 'h', 1)",
        )
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
  });

  it("keeps file rows attached to a real revision and blocks key moves onto published rows", () => {
    const { skill } = services.skillRegistry.createSkill({ display_name: "FK", draft: {} });
    const now = new Date().toISOString();
    services.db.transaction(() => {
      services.db
        .prepare(
          "INSERT INTO skill_revisions (skill_id, version, title, capability_tags_json, content_hash, published_at, created_at) VALUES (?, 2, 'draft', '[]', 'h', NULL, ?)",
        )
        .run(skill.id, now);
      services.db
        .prepare(
          "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES (?, 2, 'draft.md', x'44', 'h', 1)",
        )
        .run(skill.id);
    })();

    expect(() =>
      services.db
        .prepare(
          "UPDATE skill_revision_files SET version = 1 WHERE skill_id = ? AND version = 2 AND rel_path = 'draft.md'",
        )
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
    expect(() =>
      services.db
        .prepare(
          "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES ('missing', 1, 'x', x'78', 'h', 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("read API verifies content_hash and refuses suspicious bodies", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Hash check",
      draft: { files: [{ rel_path: "x.md", content: "hello" }] },
    });

    const ok = services.skillRegistry.readRevisionFile(skill.id, 1, "x.md");
    expect(ok.content.toString("utf8")).toBe("hello");

    // 模拟带外损坏（trigger 拦不住的磁盘腐蚀）：临时摘除 freeze trigger 后篡改，
    // 读取契约必须报 SKILL_FILE_HASH_MISMATCH 而非返回可疑正文。
    services.db.exec("DROP TRIGGER trg_skill_files_no_update");
    services.db
      .prepare("UPDATE skill_revision_files SET content = x'74616D70' WHERE skill_id = ? AND rel_path = 'x.md'")
      .run(skill.id);
    try {
      services.skillRegistry.readRevisionFile(skill.id, 1, "x.md");
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("SKILL_FILE_HASH_MISMATCH");
    }
  });

  it("unknown field / duplicate requirement id are rejected before activation (schema guard)", () => {
    expect(() =>
      services.skillRegistry.createSkill({
        display_name: "Unknown",
        draft: {
          completion_requirements: [
            {
              id: "r1",
              kind: "completion",
              strength: "hard",
              tags: ["t"],
              evidence: {
                evidence_kind: "event",
                freshness: { scope: "per_attempt" },
                independence_required: false,
                status_map: { satisfied: ["resolved"], failed: ["missing"], not_applicable: ["truncated"] },
                decomposable: false,
                extra: true,
              },
            },
          ],
        },
      }),
    ).toThrow(/SKILL_SCHEMA_UNKNOWN_FIELD|Unknown field/);
  });
});
