/** Formats an amount as Pakistani Rupees, e.g. formatCurrency(1234.5) -> "Rs 1,234.50". */
export function formatCurrency(amount: number | null | undefined): string {
  const n = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  return `Rs ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
