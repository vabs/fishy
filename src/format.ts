export function formatMoney(amount: number): string {
  return `$${Math.floor(amount).toLocaleString("en-US")}`;
}
