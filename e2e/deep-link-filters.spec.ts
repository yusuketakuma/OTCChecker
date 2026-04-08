import { expect, test } from "@playwright/test";

import { seededProducts } from "./fixtures";

test("在庫一覧の deep link が初回表示でも検索語とバケットを反映する", async ({ page }) => {
  await page.goto(`/inventory?bucket=7d&q=${encodeURIComponent("7日以内E2E")}`);
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);

  await expect(page.getByPlaceholder("商品名・JANコードで検索")).toHaveValue("7日以内E2E");
  await expect(page.getByText(seededProducts.within7.name)).toBeVisible();
  await expect(page.getByText(seededProducts.expired.name)).not.toBeVisible();
});

test("商品管理の deep link が初回表示でも検索語を反映する", async ({ page }) => {
  await page.goto(`/products?q=${encodeURIComponent("在庫なしE2E")}`);
  await page.waitForResponse((r) => r.url().includes("/api/products?mode=master") && r.status() === 200);

  await expect(page.getByPlaceholder("商品名・JANコードで検索")).toHaveValue("在庫なしE2E");
  await expect(page.getByText(seededProducts.outOfStock.name)).toBeVisible();
  await expect(page.getByText(seededProducts.safe.name)).not.toBeVisible();
});
