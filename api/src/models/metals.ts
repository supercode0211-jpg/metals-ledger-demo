export const METALS = ["gold", "silver", "platinum"] as const;
export type Metal = (typeof METALS)[number];
