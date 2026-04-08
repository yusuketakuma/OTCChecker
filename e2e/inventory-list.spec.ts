import { expect, test } from "@playwright/test";

test("在庫一覧の検索とバケット絞り込みが動作する", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "在庫一覧" })).toBeVisible();
  const inventorySearch = page.getByLabel("在庫を検索");
  await expect(inventorySearch).toHaveAttribute("placeholder", "商品名・JANコード");

  // API レスポンスを待ってから商品を確認
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("期限切れE2E商品")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("安全在庫E2E商品")).toBeVisible();

  // 検索で絞り込み
  await inventorySearch.fill("安全在庫");
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("安全在庫E2E商品")).toBeVisible();
  await expect(page.getByText("期限切れE2E商品")).not.toBeVisible();

  // 検索クリア
  await inventorySearch.clear();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);

  // バケットタブ: 期限切れ
  await page.getByRole("button", { name: "期限切れ" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("期限切れE2E商品")).toBeVisible();

  // バケットタブ: 本日
  await page.getByRole("button", { name: "本日" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("本日E2E商品")).toBeVisible();

  // バケットタブ: 7日以内
  await page.getByRole("button", { name: "7日以内" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("本日E2E商品")).toBeVisible();
  await expect(page.getByText("7日以内E2E商品")).toBeVisible();
  await expect(page.getByText("30日以内E2E商品")).not.toBeVisible();

  // バケットタブ: 30日以内
  await page.getByRole("button", { name: "30日以内" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("30日以内E2E商品")).toBeVisible();

  // バケットタブ: 全件に戻す
  await page.getByRole("button", { name: "全件" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);

  // JAN検索
  await inventorySearch.fill("4900000000004");
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("安全在庫E2E商品")).toBeVisible();
});
