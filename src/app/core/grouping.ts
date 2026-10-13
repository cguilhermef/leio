import { STATUS_LABEL, ShelfEntry } from './models';
import { parseIsoDate } from './text';

export interface EntryGroup {
  key: string;
  label: string;
  entries: ShelfEntry[];
}

/** Data (AAAA-MM-DD) da leitura concluída mais recente, ou '' se nunca foi concluído. */
export function lastFinishedDate(entry: ShelfEntry): string {
  return [...(entry.finishedDates ?? [])].sort().pop() ?? '';
}

function monthLabel(month: string): string {
  const label = parseIsoDate(`${month}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Agrupa a estante pela data de leitura: primeiro os livros em leitura, depois os lidos por
 * mês e ano (mais recentes primeiro), os lidos sem data e, por fim, os que serão lidos.
 */
export function groupByReadingDate(entries: ShelfEntry[]): EntryGroup[] {
  const reading = entries.filter((e) => e.status === 'reading').sort((a, b) => b.updatedAt - a.updatedAt);
  const toread = entries.filter((e) => e.status === 'toread').sort((a, b) => b.addedAt - a.addedAt);
  const read = entries
    .filter((e) => e.status === 'read')
    .map((e) => ({ entry: e, date: lastFinishedDate(e) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.entry.updatedAt - a.entry.updatedAt);

  const groups: EntryGroup[] = [];
  if (reading.length) groups.push({ key: 'reading', label: STATUS_LABEL.reading, entries: reading });

  const undated: ShelfEntry[] = [];
  for (const { entry, date } of read) {
    if (!date) {
      undated.push(entry);
      continue;
    }
    const month = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === month) last.entries.push(entry);
    else groups.push({ key: month, label: monthLabel(month), entries: [entry] });
  }

  if (undated.length) groups.push({ key: 'undated', label: 'Lidos sem data', entries: undated });
  if (toread.length) groups.push({ key: 'toread', label: STATUS_LABEL.toread, entries: toread });
  return groups;
}
