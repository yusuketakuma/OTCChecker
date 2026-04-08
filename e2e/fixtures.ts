export const seededProducts = {
  expired: { name: "期限切れE2E商品", janCode: "4900000000001" },
  within7: { name: "7日以内E2E商品", janCode: "4900000000002" },
  within30: { name: "30日以内E2E商品", janCode: "4900000000003" },
  safe: { name: "安全在庫E2E商品", janCode: "4900000000004" },
  detail: {
    name: "在庫操作E2E商品",
    janCode: "4900000000005",
    spec: "100錠",
    expiryDateLabel: "2030/01/15",
    newLotExpiryDate: "2030-06-30",
    newLotExpiryLabel: "2030/06/30",
  },
  scanExisting: {
    name: "既存スキャンE2E商品",
    janCode: "4900000000006",
    spec: "20錠",
  },
  importExisting: {
    name: "CSV既存E2E商品",
    janCode: "4900000000007",
    spec: "14包",
  },
  outOfStock: { name: "在庫なしE2E商品", janCode: "4900000000008" },
} as const;

export const e2eCreated = {
  productRegistration: {
    name: "E2Eテスト商品",
    spec: "30錠",
    janCode: "4901234567899",
    expiryDate: "2031-12-31",
    quantity: "12",
    expiryDateLabel: "2031/12/31",
  },
  scanNew: {
    name: "新規スキャンE2E商品",
    spec: "12包",
    janCode: "4900000000099",
    expiryDate: "2031-05-01",
    quantity: "2",
  },
  importNew: {
    name: "CSV新規E2E商品",
    spec: "50ml",
    janCode: "4900000000100",
    expiryDate: "2031-04-01",
    quantity: "1",
  },
} as const;
