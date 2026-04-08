export const receiptDefaultsStorageKey = "otc-checker:scan-receipt-defaults";

export function readStoredReceiptDefaults() {
  if (typeof window === "undefined") {
    return { expiryDate: "", quantity: 1 };
  }

  try {
    const saved = window.localStorage.getItem(receiptDefaultsStorageKey);

    if (!saved) {
      return { expiryDate: "", quantity: 1 };
    }

    const parsed = JSON.parse(saved) as { expiryDate?: string; quantity?: number };

    return {
      expiryDate: typeof parsed.expiryDate === "string" ? parsed.expiryDate : "",
      quantity:
        typeof parsed.quantity === "number" && parsed.quantity > 0 ? parsed.quantity : 1,
    };
  } catch {
    window.localStorage.removeItem(receiptDefaultsStorageKey);
    return { expiryDate: "", quantity: 1 };
  }
}

export function writeStoredReceiptDefaults(expiryDate: string, quantity: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    receiptDefaultsStorageKey,
    JSON.stringify({
      expiryDate,
      quantity: quantity > 0 ? quantity : 1,
    }),
  );
}

export function clearStoredReceiptDefaults() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(receiptDefaultsStorageKey);
}
