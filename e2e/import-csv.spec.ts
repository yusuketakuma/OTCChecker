import { expect, test } from "@playwright/test";

test("CSVアップロード→プレビュー→消し込み実行→完了まで確認できる", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "CSV取込" })).toBeVisible();

  // CSV 作成（シード商品のJANにマッチする1行）
  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    "4900000000007,CSV既存E2E商品,1,2026-04-08,E2E-TX-001",
  ].join("\n");

  // ファイルアップロード
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-sales.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });
  await expect(page.getByText("選択中: e2e-sales.csv")).toBeVisible();

  // プレビュー
  await page.getByRole("button", { name: "プレビュー" }).click();
  await expect(page.getByText("消し込み可能")).toBeVisible();

  // プレビュー結果: 消し込み可能が 1
  await expect(page.getByText("消し込み可能").locator("..").getByText("1")).toBeVisible();

  // 消し込み実行
  await page.getByRole("button", { name: "消し込み実行" }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  // プレビューがクリアされる
  await expect(page.getByText("消し込み可能")).not.toBeVisible();
});
