// Shared by browser and server. Never use binary floating point for money.
export function scaledDecimal(value, places, label) {
  const str = String(value).trim();
  if (!new RegExp(`^\\d{1,8}(?:\\.\\d{1,${places}})?$`).test(str)) {
    throw new Error(`${label}须为非负数字，最多 ${places} 位小数`);
  }
  const [whole, fraction = ''] = str.split('.');
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
}

export function calculateItems(items) {
  let total = 0n;
  const normalized = items.map(item => {
    const quantity = scaledDecimal(item.quantity, 3, '数量');
    const price = scaledDecimal(item.unitPrice, 2, '单价');
    if (quantity <= 0n) throw new Error('数量必须大于 0');
    const cents = (quantity * price + 500n) / 1000n; // round half up, per line
    total += cents;
    if (total > 99999999999n) throw new Error('报价总额不能超过 999,999,999.99 元');
    return { ...item, quantity: String(item.quantity).trim(), unitPrice: String(item.unitPrice).trim(), amountCents: Number(cents) };
  });
  return { items: normalized, totalCents: Number(total) };
}

export function money(cents) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 }).format(cents / 100);
}
