import { expect, test } from "@playwright/test";

test("ダッシュボードが期限バケット件数を表示し、カードから在庫一覧へ遷移できる", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "OTC-Checker" })).toBeVisible();

  await expect(page.getByText("今日のクイック操作")).toBeVisible();
  await expect(page.getByRole("link", { name: /バーコード登録/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /CSV取込/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /商品管理/ })).toBeVisible();

  // 4 枚のサマリーカードが表示される
  const cards = ["期限切れ", "7日以内", "30日以内", "未割当"];
  for (const label of cards) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('a[href="/inventory?bucket=today"]')).toHaveCount(0);

  // シードデータ由来の件数が仕様どおり表示されることを確認
  const expiredText = page.locator('a[href="/inventory?bucket=expired"]');
  await expect(expiredText).toBeVisible();
  const expiredCount = await expiredText.getByText(/\d+/).first().textContent();
  expect(Number(expiredCount)).toBeGreaterThanOrEqual(1);

  const within7Card = page.locator('a[href="/inventory?bucket=7d"]');
  await expect(within7Card).toContainText("本日を含む");
  await expect(within7Card.getByText("2", { exact: true })).toBeVisible();

  const within30Card = page.locator('a[href="/inventory?bucket=30d"]');
  await expect(within30Card).toContainText("8-30日");
  await expect(within30Card.getByText("1", { exact: true })).toBeVisible();

  // 7日以内カード → 本日 + 1..7日が同じ一覧で確認できる
  await within7Card.click();
  await expect(page.getByRole("heading", { name: "在庫一覧" })).toBeVisible();
  await expect(page.getByText("本日E2E商品")).toBeVisible();
  await expect(page.getByText("7日以内E2E商品")).toBeVisible();
  await expect(page.getByText("30日以内E2E商品")).not.toBeVisible();

  // 「期限切れ」タブをクリック
  await page.getByRole("button", { name: "期限切れ" }).click();
  await expect(page.getByText("期限切れE2E商品")).toBeVisible();

  // 「直近アラート対象」セクションが表示される
  await page.goto("/");
  await expect(page.getByText("直近アラート対象")).toBeVisible();

  // クイック操作から主要導線へ 1 タップで遷移できる
  await page.getByRole("link", { name: /バーコード登録/ }).click();
  await expect(page.getByRole("heading", { name: "バーコードから即登録" })).toBeVisible();
});
