import { expect, test } from "@playwright/test";

test("ダッシュボードが期限バケット件数を表示し、カードから在庫一覧へ遷移できる", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "OTC-Checker" })).toBeVisible();

  // 4 枚のカードが表示される
  const cards = ["期限切れ", "7日以内", "30日以内", "未割当"];
  for (const label of cards) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // シードデータ由来の件数が 1 以上になっていることを確認
  const expiredText = page.locator('a[href="/inventory?bucket=expired"]');
  await expect(expiredText).toBeVisible();
  const expiredCount = await expiredText.getByText(/\d+/).first().textContent();
  expect(Number(expiredCount)).toBeGreaterThanOrEqual(1);

  // 7日以内カード → 在庫一覧へ遷移
  await page.locator('a[href="/inventory?bucket=7d"]').click();
  await expect(page.getByRole("heading", { name: "在庫一覧" })).toBeVisible();
  await expect(page.getByText("7日以内E2E商品")).toBeVisible();

  // 「期限切れ」タブをクリック
  await page.getByRole("button", { name: "期限切れ" }).click();
  await expect(page.getByText("期限切れE2E商品")).toBeVisible();

  // 「直近アラート対象」セクションが表示される
  await page.goto("/");
  await expect(page.getByText("直近アラート対象")).toBeVisible();
});
