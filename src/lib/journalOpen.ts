export async function findJournalDay(
  name: string,
  oldest: string,
  prev: (before: string, n: number) => Promise<string[]>,
): Promise<string[]> {
  const result: string[] = [];
  let current = oldest;
  while (current > name) {
    const batch = await prev(current, 5);
    if (batch.length === 0) break;
    for (const day of batch) {
      if (!result.includes(day)) result.push(day);
    }
    if (batch.includes(name)) return result;
    current = batch[batch.length - 1];
  }
  throw new Error(`Журнал ${name} не найден`);
}
