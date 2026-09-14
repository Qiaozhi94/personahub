import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// F013 T008/T024（design §8 测试策略）：首次设置 Space 旅程、项目三 tab
// （文件 / Skills / 设置）与能力面 Skill 列表 / 详情的 Playwright 旅程。
// 与 F009 套件共享同一个升级后的 v0.2 fixture 数据库（默认 Space 已存在）。

test("first-run Space journey: create a Space, select it, and scope project list to it", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  const switcher = page.getByTestId("space-switcher");
  await expect(switcher).toBeVisible();

  // 创建第二个 Space（迁移已保证默认 Space 存在；创建不自动切换焦点）。
  await switcher.getByRole("button", { name: "新建" }).click();
  await switcher.getByLabel("Space 名称").fill("E2E Second Space");
  await switcher.getByRole("button", { name: "确认创建 Space" }).click();
  // option 在未展开的 select 里是 hidden；用 locator 存在性等待创建完成。
  await expect(switcher.getByLabel("当前 Space").locator("option", { hasText: "E2E Second Space" })).toHaveCount(1);

  // 显式选择新 Space：项目列表按 Space 隔离，fixture 项目不再出现。
  await switcher.getByLabel("当前 Space").selectOption({ label: "E2E Second Space" });
  await waitForSpaceSelected(page, "E2E Second Space");
  await expect(page.getByRole("button", { name: /Alpha Platform/ })).toHaveCount(0);

  // 切回默认 Space：项目列表回到 fixture 的两个项目。
  await switcher.getByLabel("当前 Space").selectOption({ label: "Default Space（默认）" });
  await waitForSpaceSelected(page, "Default Space");
  await expect(page.getByRole("button", { name: /Alpha Platform/ })).toBeVisible();
});

test("project tabs: files tab carries primary/reference repo distinction", async ({ page }) => {
  await page.goto("/projects/prj_v02_alpha/files");
  await expect(page.getByRole("heading", { name: "Alpha Platform" })).toBeVisible();
  await expect(page.getByText(/主目录 ·/)).toBeVisible();
  // prj_v02_alpha 迁移出一条只读 reference（ws_v02_graphok）。
  await expect(page.getByText(/参考仓库 ·/).first()).toBeVisible();
});

test("project tabs: files tab binds a primary directory, manages reference scope, and removes the reference", async ({
  page,
}) => {
  const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-e2e-primary-"));
  const referenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-e2e-reference-"));
  const primaryBase = path.basename(primaryDir);
  const referenceBase = path.basename(referenceDir);
  try {
    await page.goto("/projects");
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("Name").fill("E2E Files Project");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByRole("heading", { name: "E2E Files Project" })).toBeVisible();

    // 新项目没有主目录：从 Files tab 绑定真实本地目录。
    await expect(page.getByText("尚未绑定主目录。")).toBeVisible();
    await page.getByLabel("主目录路径").fill(primaryDir);
    await page.getByRole("button", { name: "绑定主目录" }).click();
    await expect(page.getByText(/已绑定主目录/)).toBeVisible();
    await expect(page.getByText(new RegExp(`主目录 · ${primaryBase}`))).toBeVisible();
    await expect(page.getByText(/主目录 · .*可写/)).toBeVisible();

    // 添加参考仓库（只读），并编辑项目范围。
    await page.getByLabel("添加代码仓").fill(referenceDir);
    await page.getByRole("button", { name: "添加参考仓库" }).click();
    await expect(page.getByText(new RegExp(`参考仓库 · .*${referenceBase}`))).toBeVisible();
    const referenceRow = page.getByTestId(/^repo-ref-/).filter({ hasText: referenceBase });
    await referenceRow.getByLabel(/项目范围 read/).fill("docs");
    await referenceRow.getByRole("button", { name: /^保存项目范围/ }).click();
    await expect(page.getByText(/已更新项目范围/)).toBeVisible();

    // 删除参考仓库后列表不再包含它。
    await referenceRow.getByRole("button", { name: /^删除参考仓库/ }).click();
    await expect(page.getByText(/已移除参考仓库/)).toBeVisible();
    await expect(page.getByText(new RegExp(`参考仓库 · .*${referenceBase}`))).toHaveCount(0);
    // 主目录不受影响。
    await expect(page.getByText(/主目录 · /)).toBeVisible();
  } finally {
    fs.rmSync(primaryDir, { recursive: true, force: true });
    fs.rmSync(referenceDir, { recursive: true, force: true });
  }
});

test("project tabs: skills tab keeps a default-skill reference, no copied content", async ({ page }) => {
  await page.goto("/projects/prj_v02_alpha/skills");
  await expect(page.getByText(/尚未选择默认 Skill|默认 Skill：/)).toBeVisible();
  await expect(page.getByRole("button", { name: "前往能力面" })).toBeVisible();
});

test("capabilities page lists migrated legacy skills; detail shows version and requirements", async ({ page }) => {
  await page.goto("/capabilities");
  await expect(page.getByRole("table", { name: "Skills 列表" })).toBeVisible();
  // 迁移产生的 legacy-workflow Skill（wft_coding_default / wft_v02_coding_v2）。
  await expect(page.getByText("Coding Workflow").first()).toBeVisible();

  // 详情：版本与要求可读（来源追溯）。
  await page.getByText("Coding Workflow").first().click();
  await expect(page.getByRole("heading", { name: /Coding Workflow|Skill/ })).toBeVisible();
  await expect(page.getByText(/^版本 v1 ·/)).toBeVisible();
});

async function waitForSpaceSelected(page: import("@playwright/test").Page, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const value = await page.getByLabel("当前 Space").locator("option:checked").textContent();
      return value?.includes(name) ?? false;
    })
    .toBe(true);
}
