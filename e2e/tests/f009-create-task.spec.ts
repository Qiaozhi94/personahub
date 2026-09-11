import { expect, test } from "@playwright/test";

// BC-056/BC-057: task creation through the intake host keeps the goal text
// verbatim, writes nothing before confirmation, is idempotent on repeat
// submission, and never recommends for an empty goal.

test("BC-057: an empty goal never triggers a recommendation", async ({ page }) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();
  const issuesBefore = await page.getByRole("button", { name: /Harden parser error paths/ }).count();

  await page.getByRole("button", { name: "推荐创建" }).click();
  const dialog = page.getByRole("dialog", { name: "Intake" });
  await expect(dialog).toBeVisible();

  // The recommend action stays disabled without a goal.
  await expect(dialog.getByRole("button", { name: "Recommend" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /Recommending/i })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.getByRole("button", { name: /Harden parser error paths/ }).count()).toBe(issuesBefore);
});

test("BC-056: confirm creates exactly one task with the goal text preserved", async ({ page }) => {
  const goal = `F009 intake journey ${Date.now()}`;
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();

  await page.getByRole("button", { name: "推荐创建" }).click();
  const dialog = page.getByRole("dialog", { name: "Intake" });
  await expect(dialog).toBeVisible();

  // Nothing is written before confirmation: the task list is unchanged while
  // the recommendation is being prepared.
  await dialog.getByPlaceholder("Describe the goal in plain language…").fill(goal);
  const recommendPromise = page.waitForResponse(
    (res) => res.url().includes("/intake/recommend") && res.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Recommend" }).click();
  await recommendPromise;

  await expect(dialog.getByRole("button", { name: /^Confirm$/ })).toBeVisible();
  expect(await page.getByRole("button", { name: new RegExp(goal) }).count()).toBe(0);

  // BC-056 client-side repeat protection: the confirm control disables
  // itself while the first request is in flight, so a rapid double click
  // cannot fire two requests.
  const confirmButton = dialog.getByRole("button", { name: /^Confirm$/ });
  let confirmUrl = "";
  let confirmBody = "";
  page.on("request", (request) => {
    if (request.url().includes("/intake/confirm") && request.method() === "POST") {
      confirmUrl = request.url();
      confirmBody = request.postData() ?? "";
    }
  });
  const firstConfirm = page.waitForResponse(
    (res) => res.url().includes("/intake/confirm") && res.request().method() === "POST",
  );
  await confirmButton.dblclick();
  const firstConfirmResponse = await firstConfirm;
  expect(firstConfirmResponse.status()).toBe(201);

  // Confirming navigates to the created task; its goal is the original text.
  await page.waitForURL(/\/tasks\/iss_/);
  await expect(page.getByText(goal).first()).toBeVisible();
  const createdIssueId = page.url().match(/\/tasks\/(iss_[^/?#]+)/)?.[1];

  // BC-056 canonical-confirm idempotence: replaying the exact same canonical
  // confirm request as a genuine second HTTP call (not a client-blocked
  // double-click) must not create a second task — the server replays the
  // original result by nonce (200, same issue_id) instead.
  const replay = await page.request.post(confirmUrl, {
    data: JSON.parse(confirmBody),
    headers: { "Content-Type": "application/json" },
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).issue_id).toBe(createdIssueId);

  // Exactly one task with this goal exists (repeat-submit idempotence).
  await page.goto("/tasks?project=prj_v02_alpha");
  expect(await page.getByRole("button", { name: new RegExp(goal.slice(0, 20)) }).count()).toBe(1);
});
