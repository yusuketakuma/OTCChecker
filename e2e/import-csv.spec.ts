import { expect, test } from "@playwright/test";

test("プレビュー中でも未割当一覧へのジャンプと実行をその場で行える", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "CSV取込" })).toBeVisible();

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    "4900000000100,CSVプレビュー導線E2E商品,1,2026-04-08,E2E-TX-PREVIEW-JUMP-001",
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-preview-jump.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await expect(page.getByRole("heading", { name: "プレビュー結果" })).toBeVisible();
  await expect(page.getByRole("link", { name: "未割当一覧へ" })).toBeVisible();

  await page.getByRole("link", { name: "未割当一覧へ" }).click();
  await expect(page).toHaveURL(/#unmatched-list$/);

  await page.getByRole("button", { name: "このまま消し込み実行" }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();
});

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
  await page.getByRole("button", { name: "消し込み実行", exact: true }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  // プレビューがクリアされる
  await expect(page.getByText("消し込み可能")).not.toBeVisible();
});

test("未割当の一括入荷条件はページ再訪でも保持でき、クリアできる", async ({ page }) => {
  await page.goto("/import");

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    "4900000000100,CSV新規E2E商品,1,2026-04-08,E2E-TX-UNMATCHED-PERSIST-001",
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-unmatched-persist.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.getByRole("button", { name: "消し込み実行", exact: true }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  await page.getByLabel("一括期限日").fill("2031-04-01");
  await page.getByLabel("一括入荷数量").fill("5");
  await expect(page.getByText("前回の入荷条件を保持中")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("一括入荷数量")).toHaveValue("5");
  await expect(page.getByText("前回の入荷条件を保持中")).toBeVisible();

  await page.getByRole("button", { name: "保持をクリア" }).click();
  await expect(page.getByLabel("一括入荷数量")).toHaveValue("1");
  await expect(page.getByText("前回の入荷条件を保持中")).not.toBeVisible();
});

test("在庫不足の未割当から既存商品詳細と入荷登録へ1タップで移動できる", async ({ page }) => {
  await page.goto("/import");

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    "4900000000007,CSV既存E2E商品,5,2026-04-08,E2E-TX-INSUFFICIENT-001",
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-insufficient.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.getByRole("button", { name: "消し込み実行", exact: true }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  const unresolvedCard = page
    .getByRole("heading", { name: "CSV既存E2E商品" })
    .locator("xpath=ancestor::div[.//a[normalize-space()='在庫詳細']][1]");

  await expect(unresolvedCard.getByRole("link", { name: "在庫詳細" })).toHaveAttribute(
    "href",
    /\/inventory\//,
  );
  await expect(unresolvedCard.getByRole("link", { name: "手動入荷" })).toHaveAttribute(
    "href",
    /\/inventory\/.+#manual-receipt/,
  );
  await expect(unresolvedCard.getByRole("link", { name: "スキャン入荷" })).toHaveAttribute(
    "href",
    /\/scan\?jan=4900000000007.*quantity=\d+/,
  );
});

test("一括入力後も未割当の編集中ドラフトが消えない", async ({ page }) => {
  await page.goto("/import");

  const unique = Date.now().toString().slice(-6);
  const searchTerm = `CSV一括入力E2E商品${unique}`;
  const productA = `${searchTerm}A`;
  const productB = `${searchTerm}B`;

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    `49000001${unique}1,${productA},1,2026-04-08,E2E-TX-BULK-${unique}-001`,
    `49000001${unique}2,${productB},1,2026-04-08,E2E-TX-BULK-${unique}-002`,
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-bulk-drafts.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.getByRole("button", { name: "消し込み実行", exact: true }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  await page.getByPlaceholder("商品名・JAN・理由で検索").fill(searchTerm);
  await expect(page.getByRole("heading", { name: productA })).toBeVisible();
  await expect(page.getByRole("heading", { name: productB })).toBeVisible();

  const bulkNote = page.getByLabel("一括解決メモ");
  await expect(bulkNote).toHaveAttribute("placeholder", "例: 棚卸確認済み");
  await bulkNote.fill("一括メモE2E");
  await page.getByRole("button", { name: "表示中に一括入力" }).click();
  await expect(page.getByText("表示中の未割当 2 件に入力内容を反映しました。")).toBeVisible();

  await expect(page.getByLabel(`${productA}の解決メモ`)).toHaveValue("一括メモE2E");
  await expect(page.getByLabel(`${productB}の解決メモ`)).toHaveValue("一括メモE2E");
});

test("未割当行は必須入力がそろうまで解決アクションを実行できない", async ({ page }) => {
  await page.goto("/import");

  const unique = Date.now().toString().slice(-6);
  const productName = `CSV新規E2E商品${unique}`;
  const janCode = `49000002${unique}`;

  const csvContent = [
    "JANコード,商品名,数量,取引日,取引ID",
    `${janCode},${productName},1,2026-04-08,E2E-TX-UNMATCHED-${unique}`,
  ].join("\n");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-unmatched.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });

  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.getByRole("button", { name: "消し込み実行", exact: true }).click();
  await expect(page.getByText("CSV 消し込みが完了しました。")).toBeVisible();

  const unresolvedCard = page
    .getByRole("heading", { name: productName })
    .locator("xpath=ancestor::div[.//button[normalize-space()='商品作成して売上反映']][1]");

  const receiveButton = unresolvedCard.getByRole("button", { name: "商品作成して売上反映", exact: true });
  const resolveButton = unresolvedCard.getByRole("button", { name: "メモのみで解決", exact: true });
  const noteInput = unresolvedCard.getByLabel(`${productName}の解決メモ`);

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
