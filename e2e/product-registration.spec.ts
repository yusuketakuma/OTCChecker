import { expect, test } from "@playwright/test";

const unique = Date.now().toString().slice(-6);

const product = {
  name: `E2Eテスト商品${unique}`,
  spec: "30錠",
  janCode: `49012345${unique}`,
  expiryDate: "2031-12-31",
  quantity: "12",
};

test("商品と初回ロットを登録し、在庫詳細まで確認できる", async ({ page }) => {
  await page.goto("/products");

  await expect(page.getByRole("heading", { name: "商品管理" })).toBeVisible();

  await page.getByPlaceholder("商品名", { exact: true }).fill(product.name);
  await page.getByPlaceholder("規格").fill(product.spec);
  await page.getByPlaceholder("JANコード", { exact: true }).fill(product.janCode);
  await page.locator('input[type="date"]').fill(product.expiryDate);
  await page.getByPlaceholder("初回数量（期限入力時のみ）").fill(product.quantity);

  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/products") && response.request().method() === "POST"),
    page.getByRole("button", { name: "商品と初回ロットを追加" }).click(),
  ]);

  await expect(page.locator('input[type="date"]').first()).toHaveValue(product.expiryDate);
  await expect(page.getByPlaceholder("初回数量（期限入力時のみ）")).toHaveValue(product.quantity);

  const productCard = page.locator("div.space-y-3 > div").filter({ hasText: product.name }).first();
  await expect(productCard.getByRole("heading", { name: product.name })).toBeVisible();
  await expect(productCard.getByText(`JAN: ${product.janCode}`)).toBeVisible();
  await expect(productCard.getByText("ロット番号: LOT-", { exact: false })).toBeVisible();
  await expect(productCard.getByText("在庫数: 12個")).toBeVisible();
  await expect(productCard.getByText("期限: 2031/12/31")).toBeVisible();

  await page.getByRole("link", { name: `${product.name}の在庫詳細を開く` }).click();

  await expect(page.getByRole("heading", { name: product.name })).toBeVisible();
  await expect(page.getByText(`${product.spec} / JAN ${product.janCode}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "ロット一覧" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "期限 2031/12/31" })).toBeVisible();
  await expect(page.getByText("初回 12個 / 現在 12個")).toBeVisible();
});
