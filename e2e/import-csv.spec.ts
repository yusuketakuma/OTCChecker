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

test("未割当行は必須入力がそろうまで解決アクションを実行できない", async ({ page }) => {
  await page.goto("/import");

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    "4900000000100,CSV新規E2E商品,1,2026-04-08,E2E-TX-UNMATCHED-001",
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-unmatched.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.getByRole("button", { name: "消し込み実行" }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  const unresolvedCard = page.locator("div").filter({
    has: page.getByText("CSV新規E2E商品"),
    hasText: "NO_PRODUCT",
  }).first();

  const receiveButton = unresolvedCard.getByRole("button", { name: "商品作成して売上反映" });
  const resolveButton = unresolvedCard.getByRole("button", { name: "メモのみで解決" });
  const noteInput = unresolvedCard.getByPlaceholder("解決メモを入力");

  await expect(receiveButton).toBeDisabled();
  await expect(resolveButton).toBeEnabled();
  await expect(unresolvedCard.getByText("規格を入力してください")).toBeVisible();
  await expect(unresolvedCard.getByText("期限日を入力してください")).toBeVisible();

  await noteInput.fill("");
  await expect(resolveButton).toBeDisabled();
  await expect(unresolvedCard.getByText("解決メモを入力してください")).toBeVisible();

  await noteInput.fill("入荷予定を確認中");
  await unresolvedCard.getByPlaceholder("規格").fill("50ml");
  await unresolvedCard.locator('input[type="date"]').fill("2031-04-01");

  await expect(resolveButton).toBeEnabled();
  await expect(receiveButton).toBeEnabled();
});
