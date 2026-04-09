import { expect, test } from "@playwright/test";

test("既存SKUのJAN入力で照会→入荷登録ができる", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();

  // JAN入力 → 照会完了を待つ
  await page.getByPlaceholder("JANコード").fill("4900000000006");
  await expect(page.getByText("既存SKU")).toBeVisible();
  await expect(page.locator('input[type="date"]')).toBeFocused();

  // 期限日と数量を入力
  await page.locator('input[type="date"]').fill("2030-12-31");
  const qtyInput = page.locator('input[type="number"]');
  await qtyInput.clear();
  await qtyInput.fill("3");

  // 登録
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("既存SKUへ入荷登録しました。")).toBeVisible();
  await page.getByRole("button", { name: "同じ商品でもう一件" }).click();
  await expect(page.getByText("既存SKU")).toBeVisible();
  await expect(qtyInput).toBeFocused();

  // 直近読取履歴に JAN が残り、在庫詳細へも飛べる
  await expect(page.getByText("4900000000006")).toBeVisible();
  await expect(page.getByRole("link", { name: /の在庫詳細を開く/ })).toBeVisible();
});

test("履歴タップで商品名を即時復元し、既存在庫の詳細へ移動できる", async ({ page }) => {
  await page.goto("/scan");
  await page.getByPlaceholder("JANコード").fill("4900000000006");
  await expect(page.getByText("既存SKU")).toBeVisible();
  await expect(page.getByRole("link", { name: /の在庫詳細を開く/ })).toBeVisible();

  await page.getByRole("button", { name: "クリア", exact: true }).click();
  await expect(page.getByPlaceholder("JANコード")).toHaveValue("");
  await expect(page.getByPlaceholder("商品名")).toHaveValue("");

  await page.getByRole("button", { name: /既存スキャンE2E商品/ }).click();
  await expect(page.getByPlaceholder("JANコード")).toHaveValue("4900000000006");
  await expect(page.getByPlaceholder("商品名")).toHaveValue("既存スキャンE2E商品");

  await page.getByRole("link", { name: /の在庫詳細を開く/ }).click();
  await expect(page).toHaveURL(/\/inventory\//);
  await expect(page.getByRole("heading", { name: "ロット一覧" })).toBeVisible();
});

test("未登録JANコードで新規SKU作成→入荷登録ができる", async ({ page }) => {
  const unique = Date.now().toString().slice(-8);
  const janCode = `49000000${unique}`;
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();

  // 未登録 JAN を直接入力
  await page.getByPlaceholder("JANコード").fill(janCode);
  await expect(page.getByText("新規SKU候補")).toBeVisible();
  await expect(page.getByPlaceholder("商品名")).toBeFocused();

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

test("未登録JANのprefillでも商品名と規格を保持したまま新規SKU候補として扱う", async ({ page }) => {
  const janCode = `49000001${Date.now().toString().slice(-6)}`;
  const prefilledName = `未登録prefill商品${Date.now().toString().slice(-4)}`;
  const prefilledSpec = "24包";

  await page.goto(
    `/scan?jan=${encodeURIComponent(janCode)}&name=${encodeURIComponent(prefilledName)}&spec=${encodeURIComponent(prefilledSpec)}&quantity=2`,
  );
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();

  await expect(page.getByText("新規SKU候補")).toBeVisible();
  await expect(page.getByPlaceholder("JANコード")).toHaveValue(janCode);
  await expect(page.getByPlaceholder("商品名")).toHaveValue(prefilledName);
  await expect(page.getByPlaceholder("規格")).toHaveValue(prefilledSpec);
  await expect(page.getByPlaceholder("商品名")).toBeEnabled();
  await expect(page.getByPlaceholder("規格")).toBeEnabled();
  await expect(page.getByRole("button", { name: "登録する" })).toBeDisabled();
});
