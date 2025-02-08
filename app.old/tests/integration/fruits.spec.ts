import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import fruits from "../../public/fruits.json";

const [
  {
    name: fruitName,
    image: {
      author: { name: authorName, url: authorURL },
      url: fruitImage,
    },
  },
] = fruits;

// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/naming-convention
let _page: Page;

function get(id: string) {
  return _page.locator(`data-testid=${id}`);
}

const PORT = "5173";
const BASE_URL = `http://localhost${PORT ? `:${PORT}` : ""}`;

test("Sample test suite, featuring sample Fruit code", async ({ page }) => {
  _page = page;
  await page.goto(`${BASE_URL}/fruits`);

  // FruitGallery.tsx
  await expect(page).toHaveURL(`${BASE_URL}/fruits`);
  await expect(get("FruitCard")).toHaveCount(fruits.length);

  await expect(get("FruitCardImage").first()).toHaveAttribute(
    "src",
    new RegExp(`^${fruitImage.replace("?", "\\?")}*`)
  );

  const author = get("FruitImageAuthor").first();
  await expect(author).toHaveText(authorName);
  await expect(author).toHaveAttribute("href", authorURL);
  await author.click();
  const card = get("FruitCardName").first();
  await expect(card).toHaveText(fruitName);
  await card.click();

  // FruitDetails.tsx
  await expect(page).toHaveURL(`${BASE_URL}/${fruitName.toLowerCase()}`);
  await expect(page).toHaveURL(new RegExp(`/${fruitName.toLowerCase()}`));
  await expect(get("FruitImage").first()).toHaveAttribute(
    "src",
    new RegExp(`^${fruitImage.replace("?", "\\?")}*`)
  );
  await expect(get("FruitName")).toHaveText(fruitName);
  await get("BackLink").click();

  // Back to previous page, FruitGallery.tsx
  await expect(page).toHaveURL(`${BASE_URL}/fruits`);
});
