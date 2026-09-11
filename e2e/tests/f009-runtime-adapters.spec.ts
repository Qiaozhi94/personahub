import { expect, test } from "@playwright/test";

// BC-053: adapter credentials default to masked input with an explicit
// reveal toggle; the mask is the default state on every open. OpenCode is
// the provider with api-key auth (codex / claude are CLI-managed OAuth).

test("BC-053: the api key input is masked by default with an explicit reveal", async ({ page }) => {
  await page.goto("/runtime/adapters");
  await page.getByRole("radio", { name: "Alpha Platform" }).click();

  await expect(page.getByText("适配器配置")).toBeVisible();

  // Open the create-adapter flow.
  await page.getByRole("button", { name: "Configure adapter" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Switch to OpenCode, the provider with api-key auth support.
  await dialog.locator("#adapter-provider").selectOption("opencode");
  await dialog.locator("#adapter-auth-type").selectOption("api_key");

  const keyInput = dialog.locator("#adapter-api-key");
  await expect(keyInput).toHaveAttribute("type", "password");

  await keyInput.fill("sk-test-secret-value");
  await dialog.getByRole("button", { name: "Show" }).click();
  await expect(keyInput).toHaveAttribute("type", "text");
  await expect(keyInput).toHaveValue("sk-test-secret-value");

  await dialog.getByRole("button", { name: "Hide" }).click();
  await expect(keyInput).toHaveAttribute("type", "password");
});
