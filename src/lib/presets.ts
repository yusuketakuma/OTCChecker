/**
 * Shared UI presets for receipt/expiry and quantity inputs.
 * Used by scan, products, and inventory detail pages.
 */

export const receiptExpiryPresets = [
  { label: "今日", days: 0 },
  { label: "+7日", days: 7 },
  { label: "+14日", days: 14 },
  { label: "+30日", days: 30 },
  { label: "+90日", days: 90 },
  { label: "+180日", days: 180 },
] as const;

export const quantityPresets = [1, 3, 5, 10] as const;
