import { expect, test } from "@playwright/test";

// BC-056/BC-057 (F012/T016 rewrite): task creation now goes through the plain
// create-task dialog — goal-only task with zero execution writes; dispatching
// happens on the session face. The intake recommend/confirm host (and its
// recommend action) was retired with F012's old-write-path removal.

test("BC-057: the create action stays disabled without a title and goal, and cancelling writes nothing", async ({
  page,
}) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();
  const issuesBefore = await page.getByRole("button", { name: /Harden parser error paths/ }).count();

  await page.getByRole("button", { name: "新建任务" }).click();
  const dialog = page.getByRole("dialog", { name: "New coding issue" });
  await expect(dialog).toBeVisible();

  // The create action stays disabled until both title and goal are present.
  await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.getByRole("button", { name: /Harden parser error paths/ }).count()).toBe(issuesBefore);
});

test("BC-056: creating a task writes exactly one task with the goal preserved and dispatches nothing", async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Journey ${stamp}`;
  const goal = `F009 task creation journey ${stamp}`;
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();

  await page.getByRole("button", { name: "新建任务" }).click();
  const dialog = page.getByRole("dialog", { name: "New coding issue" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Goal").fill(goal);

  // Zero execution writes before/at creation: dispatching only happens on the
  // session face, never as a side effect of creating the task.
  const executionWrites: string[] = [];
  page.on("request", (request) => {
    if (/\/dispatches|\/runs/.test(request.url()) && request.method() === "POST") {
      executionWrites.push(request.url());
    }
  });

  const createResponse = page.waitForResponse(
    (res) => res.url().includes("/issues") && res.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create" }).click();
  expect((await createResponse).status()).toBe(201);

  // Creating navigates to the new task; its goal is the original text.
  await page.waitForURL(/\/tasks\/iss_/);
  await expect(page.getByText(goal).first()).toBeVisible();
  expect(executionWrites).toEqual([]);

  // Exactly one task with this title exists (no duplicate creation).
  await page.goto("/tasks?project=prj_v02_alpha");
  expect(await page.getByRole("button", { name: new RegExp(title) }).count()).toBe(1);
});
