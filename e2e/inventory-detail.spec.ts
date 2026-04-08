import { expect, test, type Locator } from "@playwright/test";

import { seededProducts } from "./fixtures";

async function expectAnchoredNearTop(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => {
      const top = await locator.evaluate((element) => Math.round(element.getBoundingClientRect().top));
      return top >= 0 && top < 180;
    })
    .toBe(true);
}

test("在庫詳細で商品更新・入荷・売上・ロット操作・履歴確認ができる", async ({ page }) => {
  // ── シード商品「在庫操作E2E商品」の詳細へ遷移 ──
  await page.goto("/inventory");
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await page.getByLabel("在庫を検索").fill("在庫操作E2E");
  await page.waitForResponse((r) => r.url().includes("/api/products") && r.status() === 200);
  await expect(page.getByText("在庫操作E2E商品")).toBeVisible();
  // aria-label で特定（全カードに「詳細を見る」リンクがあるため）
  await page.getByRole("link", { name: "在庫操作E2E商品の詳細を見る" }).click();

  await expect(page.getByRole("heading", { name: "在庫操作E2E商品" })).toBeVisible();
  await expect(page.getByText("100錠 / JAN 4900000000005")).toBeVisible();
  await expect(page.getByText("初回 10個 / 現在 10個")).toBeVisible();
  const receiptSection = page.locator("div").filter({ hasText: /^手動入荷登録/ }).first();
  await expect(receiptSection.locator('input[type="date"]')).toBeVisible();

  // ── 1. 商品マスタ更新 ──
  const nameInput = page.getByPlaceholder("商品名");
  await nameInput.clear();
  await nameInput.fill("在庫操作E2E商品 更新");
  await page.getByRole("button", { name: "商品マスタを更新" }).click();
  await expect(page.getByText("商品マスタを更新しました。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "在庫操作E2E商品 更新" })).toBeVisible();

  // ── 2. 手動入荷登録（新ロット追加）──
  await receiptSection.locator('input[type="date"]').fill("2030-06-30");
  await receiptSection.locator('input[type="number"]').fill("5");
  await page.getByRole("button", { name: "入荷登録" }).click();
  await expect(page.getByText("入荷を登録しました。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "期限 2030/06/30" })).toBeVisible();
  await expect(page.getByText("初回 5個 / 現在 5個")).toBeVisible();

  // ── 3. 手動売上登録（FIFO → 初期ロットから消費）──
  const saleSection = page.locator("div").filter({ hasText: /^手動売上登録/ }).first();
  await saleSection.locator('input[type="number"]').fill("4");
  await expect(saleSection.getByText("FIFO消し込み予定")).toBeVisible();
  await expect(saleSection.getByText("期限 2030/01/15")).toBeVisible();
  await expect(saleSection.getByText("売上前 10個 → 売上後 6個")).toBeVisible();
  await expect(saleSection.getByText("-4個")).toBeVisible();
  await page.getByRole("button", { name: "売上登録" }).click();
  await expect(page.getByText("手動売上を登録しました。")).toBeVisible();
  await expect(page.getByText("初回 10個 / 現在 6個")).toBeVisible();

  // ── 4. 数量上書き（初期ロット → 8）──
  const qtyInput = page.getByText("現在庫", { exact: true }).first().locator("..").locator('input[type="number"]');
  await qtyInput.clear();
  await qtyInput.fill("8");
  await page.getByPlaceholder("修正理由").first().clear();
  await page.getByPlaceholder("修正理由").first().fill("棚卸再計数E2E");
  await page.getByRole("button", { name: "数量更新" }).first().click();
  await expect(page.getByText("在庫数量を更新しました。")).toBeVisible();
  await expect(page.getByText("初回 10個 / 現在 8個")).toBeVisible();

  // ── 5. 差分調整（初期ロット -2）──
  await page.getByText("差分", { exact: true }).first().locator("..").locator('input[type="number"]').clear();
  await page.getByText("差分", { exact: true }).first().locator("..").locator('input[type="number"]').fill("-2");
  await page.getByPlaceholder("差分調整理由").first().clear();
  await page.getByPlaceholder("差分調整理由").first().fill("棚卸差異E2E");
  await page.getByRole("button", { name: "差分調整" }).first().click();
  await expect(page.getByText("差分調整を登録しました。")).toBeVisible();
  await expect(page.getByText("初回 10個 / 現在 6個")).toBeVisible();

  // ── 6. 廃棄登録（初期ロット 1個）──
  await page.getByText("廃棄数", { exact: true }).first().locator("..").locator('input[type="number"]').fill("1");
  await page.getByPlaceholder("廃棄理由").first().clear();
  await page.getByPlaceholder("廃棄理由").first().fill("期限近接E2E");
  await page.getByRole("button", { name: "廃棄登録" }).first().click();
  await expect(page.getByText("廃棄を登録しました。")).toBeVisible();
  await expect(page.getByText("初回 10個 / 現在 5個")).toBeVisible();

  // ── 7. 履歴タブ確認（履歴セクション内で検証）──
  const historySection = page.locator("section").filter({ hasText: "履歴" }).first();

  await page.getByRole("button", { name: "入荷", exact: true }).click();
  await expect(historySection.getByText("期限 2030/01/15").first()).toBeVisible();
  await expect(historySection.getByText("期限 2030/06/30").first()).toBeVisible();

  await page.getByRole("button", { name: "売上", exact: true }).click();
  // 売上レコード: "4個 / 手動売上" は heading と重複しない一意なテキスト
  await expect(page.getByText("4個 / 手動売上")).toBeVisible();

  await page.getByRole("button", { name: "廃棄", exact: true }).click();
  await expect(page.getByText("期限近接E2E")).toBeVisible();

  await page.getByRole("button", { name: "調整", exact: true }).click();
  await expect(page.getByText("棚卸差異E2E")).toBeVisible();
});

test("在庫詳細の手動入荷で保持中の入荷条件を表示し、クリア後も再表示しない", async ({
  page,
  request,
}) => {
  const inventoryResponse = await request.get(`/api/products?q=${seededProducts.detail.janCode}`);
  expect(inventoryResponse.ok()).toBeTruthy();

  const { data: inventoryItems } = (await inventoryResponse.json()) as {
    data: Array<{
      productId: string;
      janCode: string;
    }>;
  };
  const targetProduct = inventoryItems.find((item) => item.janCode === seededProducts.detail.janCode);

  if (!targetProduct) {
    throw new Error("seeded inventory detail product not found");
  }

  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "otc-checker:scan-receipt-defaults",
      JSON.stringify({ expiryDate: "2031-02-03", quantity: 5 }),
    );
  });

  await page.goto(`/inventory/${targetProduct.productId}#manual-receipt`);
  await expect(page.getByRole("heading", { name: seededProducts.detail.name })).toBeVisible();

  const receiptSection = page.locator("#manual-receipt");
  const receiptDateInput = receiptSection.locator('input[type="date"]');
  const receiptQuantityInput = receiptSection.locator('input[type="number"]');

  await expect(receiptDateInput).toHaveValue("2031-02-03");
  await expect(receiptQuantityInput).toHaveValue("5");
  await expect(receiptSection.getByText("前回の入荷条件を保持中")).toBeVisible();
  await expect(receiptSection.getByText("期限日 2031-02-03 / 数量 5個")).toBeVisible();

  await receiptSection.getByRole("button", { name: "保持をクリア" }).click();

  await expect(page.getByText("入荷条件の保持をクリアしました。")).toBeVisible();
  await expect(receiptDateInput).toHaveValue("");
  await expect(receiptQuantityInput).toHaveValue("1");
  await expect(receiptSection.getByText("前回の入荷条件を保持中")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: seededProducts.detail.name })).toBeVisible();
  await expect(receiptDateInput).toHaveValue("");
  await expect(receiptQuantityInput).toHaveValue("1");
  await expect(receiptSection.getByText("前回の入荷条件を保持中")).toHaveCount(0);
});

test("在庫詳細のハッシュ深リンクが初回表示後とハッシュ変更後の両方で目的地へスクロールする", async ({
  page,
  request,
}) => {
  const inventoryResponse = await request.get(`/api/products?q=${seededProducts.detail.janCode}`);
  expect(inventoryResponse.ok()).toBeTruthy();

  const { data: inventoryItems } = (await inventoryResponse.json()) as {
    data: Array<{
      productId: string;
      janCode: string;
      earliestLotId: string | null;
    }>;
  };
  const targetProduct = inventoryItems.find((item) => item.janCode === seededProducts.detail.janCode);

  if (!targetProduct?.earliestLotId) {
    throw new Error("seeded inventory detail product does not have a deep-linkable lot");
  }

  const lotAnchor = `lot-${targetProduct.earliestLotId}`;
  const productResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/products/${targetProduct.productId}`) && response.status() === 200,
  );
  await page.goto(`/inventory/${targetProduct.productId}#${lotAnchor}`);
  await productResponsePromise;

  await expect(page.getByText(`JAN ${seededProducts.detail.janCode}`)).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe(`#${lotAnchor}`);
  await expectAnchoredNearTop(page.locator(`[id="${lotAnchor}"]`));

  await page.evaluate(() => {
    window.location.hash = "#manual-sale";
  });

  await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe("#manual-sale");
  await expectAnchoredNearTop(page.locator('[id="manual-sale"]'));
});
