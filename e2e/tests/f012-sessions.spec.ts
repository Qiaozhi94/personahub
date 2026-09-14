import { expect, test } from "@playwright/test";

// F012 T024 (AC-005): the session surface journey — rooms materialized by the
// real v10→head migration are deep-linkable, messages persist on the shared
// event stream, and a refresh recovers the same conversation (§6.1).
// API calls run as in-page fetch() so they share the app's origin without
// needing an absolute baseURL in the test fixtures.

type Room = { id: string; title: string };

test("F012: a migrated room deep-links to a working session surface and survives refresh", async ({ page }) => {
  await page.goto("/tasks");
  const rooms = await page.evaluate(async () => (await fetch("/api/rooms")).json() as { rooms: Room[] });
  expect(rooms.rooms.length).toBeGreaterThan(0);

  const room = rooms.rooms[0]!;
  await page.goto(`/sessions/${room.id}`);
  await expect(page.getByRole("heading", { name: room.title })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "会话输入框" })).toBeVisible();

  // send a message — it renders on the shared event stream
  const body = `F012 session journey ${Date.now()}`;
  await page.getByRole("textbox", { name: "会话输入框" }).fill(body);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(body)).toBeVisible();

  // refresh recovery: the deep link replays the same conversation
  await page.reload();
  await expect(page.getByRole("heading", { name: room.title })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
});

test("F012: convert-to-task binds an independent room and links the new task", async ({ page }) => {
  await page.goto("/tasks");
  const spaceId = await page.evaluate(async () => {
    const response = await fetch("/api/spaces");
    const body = (await response.json()) as { spaces?: Array<{ id: string }> };
    if (!body.spaces || body.spaces.length === 0) throw new Error("no spaces: " + JSON.stringify(body).slice(0, 200));
    return body.spaces[0]!.id;
  });
  const created = await page.evaluate(async (spaceId: string) => {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space_id: spaceId, title: "F012 独立会话旅程" }),
    });
    return response.json() as Promise<{ room: Room }>;
  }, spaceId);

  await page.goto(`/sessions/${created.room.id}`);
  await expect(page.getByRole("heading", { name: "F012 独立会话旅程" })).toBeVisible();

  const goal = `F012 converted task ${Date.now()}`;
  await page.getByRole("textbox", { name: "任务目标" }).fill(goal);
  await page.getByRole("button", { name: "转成任务" }).click();
  // Success swaps the room to task-bound: the convert section disappears and
  // the header shows the task link — assert the settled state, not the toast.
  const taskLink = page.getByRole("link", { name: "查看任务" });
  await expect(taskLink).toBeVisible();
  const href = await taskLink.getAttribute("href");
  expect(href).toMatch(/^\/tasks\/iss_/);
  // the convert helper copy is gone once the room is task-bound
  await expect(page.getByText("转成任务后执行产物才会进入")).toHaveCount(0);
});
