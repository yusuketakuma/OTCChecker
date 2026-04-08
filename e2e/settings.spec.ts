import { expect, test } from "@playwright/test";

test("アラート日数を変更して保存できる", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "運用設定" })).toBeVisible();

  // 設定ページの input を取得
  const alertInput = page.locator("input").first();
  await expect(alertInput).toHaveValue("30,7,0");

  // 変更して保存
  await alertInput.clear();
  await alertInput.fill("60,30,7,0");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect(page.getByText("設定を保存しました。")).toBeVisible();

  // 再度アクセスして永続化確認
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "運用設定" })).toBeVisible();
  const savedInput = page.locator("input").first();
  await expect(savedInput).toHaveValue("60,30,7,0");

  // 元に戻す
  await savedInput.clear();
  await savedInput.fill("30,7,0");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect(page.getByText("設定を保存しました。")).toBeVisible();
});
