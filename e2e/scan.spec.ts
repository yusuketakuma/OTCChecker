import { expect, test } from "@playwright/test";

test("既存SKUのJAN入力で照会→入荷登録ができる", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();

  // JAN入力 → 照会完了を待つ
  await page.getByPlaceholder("JANコード").fill("4900000000006");
  await expect(page.getByText("既存SKU")).toBeVisible();

  // 期限日と数量を入力
  await page.locator('input[type="date"]').fill("2030-12-31");
  const qtyInput = page.locator('input[type="number"]');
  await qtyInput.clear();
  await qtyInput.fill("3");

  // 登録
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("既存SKUへ入荷登録しました。")).toBeVisible();

  // 直近読取履歴に JAN が残る
  await expect(page.getByText("4900000000006")).toBeVisible();
});

test("未登録JANコードで新規SKU作成→入荷登録ができる", async ({ page }) => {
  const unique = Date.now().toString().slice(-8);
  const janCode = `49000000${unique}`;
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();

  // 未登録 JAN を直接入力
  await page.getByPlaceholder("JANコード").fill(janCode);

  // 商品名・規格を入力
  await page.getByPlaceholder("商品名").fill(`新規スキャンE2E商品${unique}`);
  await page.getByPlaceholder("規格").fill("12包");

  // 期限プリセット (+90日) をクリック
  await page.getByRole("button", { name: "+90日" }).click();

  // 数量を + で増やす
  const plusButtons = page.getByRole("button", { name: "+", exact: true });
  await plusButtons.click(); // 1→2

  // 登録
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("新規SKUを作成して入荷登録しました。")).toBeVisible();
});
