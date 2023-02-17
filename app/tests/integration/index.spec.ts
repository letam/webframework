import { test, expect } from "@playwright/test";

const PORT = "5173";
const BASE_URL = `http://localhost${PORT ? `:${PORT}` : ""}`;

test("title", async ({ page }) => {
  await page.goto(BASE_URL);
  const title = page.locator("title");
  await expect(title).toHaveText("wut up");
});
