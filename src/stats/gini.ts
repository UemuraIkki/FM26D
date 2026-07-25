/**
 * Discrete Gini coefficient (requirement 7: 長期健全性テストの「優勝クラブの
 * ジニ係数」). 0 = perfectly equal distribution (every club wins equally
 * often), approaching 1 = total concentration (one club wins everything).
 */
export function giniCoefficient(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i]!;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/** Gini coefficient over a season-by-season champion list, one club id per season. */
export function giniOfChampions(champions: readonly string[], allClubIds: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const clubId of allClubIds) counts.set(clubId, 0);
  for (const champion of champions) counts.set(champion, (counts.get(champion) ?? 0) + 1);
  return giniCoefficient([...counts.values()]);
}
