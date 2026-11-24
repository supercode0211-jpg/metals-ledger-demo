/**
 * Metal amounts are whole milligrams inside the API and in MongoDB.
 * Grams only exist at the edges, as decimal strings like "12.345",
 * so an amount never passes through a float on its way to the ledger.
 */
export const MG_PER_GRAM = 1000;

// Up to 9,999,999 g with at most three decimals. "0" is a valid amount here;
// the ledger refuses zero where something actually has to move.
export const GRAMS_PATTERN = /^(0|[1-9]\d{0,6})(\.\d{1,3})?$/;

export function gramsToMg(grams: string): number {
  const match = GRAMS_PATTERN.exec(grams);
  if (!match) {
    throw new Error(`Not a gram amount: "${grams}"`);
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? ".").slice(1).padEnd(3, "0"));
  return whole * MG_PER_GRAM + fraction;
}

export function mgToGrams(mg: number): string {
  const sign = mg < 0 ? "-" : "";
  const abs = Math.abs(mg);
  const whole = Math.floor(abs / MG_PER_GRAM);
  const fraction = String(abs % MG_PER_GRAM).padStart(3, "0");
  return `${sign}${whole}.${fraction}`;
}
