import { Goal, ReadingLog, ShelfEntry } from './models';
import { isoDate, parseIsoDate } from './text';

const DAY_MS = 86_400_000;
const DEFAULT_BOOK_PAGES = 250;

export function totalPages(entries: ShelfEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.pagesRead || 0), 0);
}

export function uniquePages(entries: ShelfEntry[]): number {
  return entries.reduce((sum, e) => sum + Math.min(e.maxPage || 0, e.pages || e.maxPage || 0), 0);
}

function daysBetween(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / DAY_MS) + 1;
}

function monthsBetween(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
}

export interface YearStats {
  year: number;
  pages: number;
  perMonth: number;
  perDay: number;
  books: number;
}

export interface ReadingStats {
  total: number;
  unique: number;
  perMonth: number;
  perDay: number;
  since?: string;
  years: YearStats[];
}

/**
 * Consolida as estatísticas a partir dos registros de leitura. As médias consideram o
 * período entre o primeiro registro e hoje (ou o fim de cada ano, para anos passados).
 */
export function readingStats(
  entries: ShelfEntry[],
  logs: ReadingLog[],
  today = new Date(),
): ReadingStats {
  const total = totalPages(entries);
  const unique = uniquePages(entries);
  const dated = logs.filter((l) => l.pages > 0).map((l) => l.date).sort();
  if (!dated.length) {
    return { total, unique, perMonth: 0, perDay: 0, years: [] };
  }

  const first = parseIsoDate(dated[0]);
  const byYear = new Map<number, number>();
  for (const log of logs) {
    const year = Number(log.date.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + log.pages);
  }

  const booksByYear = new Map<number, Set<string>>();
  for (const entry of entries) {
    for (const date of entry.finishedDates ?? []) {
      const year = Number(date.slice(0, 4));
      if (!booksByYear.has(year)) booksByYear.set(year, new Set());
      booksByYear.get(year)!.add(entry.bookId);
    }
  }

  const years: YearStats[] = [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => {
      const pages = byYear.get(year) ?? 0;
      const start = year === first.getFullYear() ? first : new Date(year, 0, 1);
      const end = year === today.getFullYear() ? today : new Date(year, 11, 31);
      return {
        year,
        pages,
        perMonth: pages / Math.max(1, monthsBetween(start, end)),
        perDay: pages / Math.max(1, daysBetween(start, end)),
        books: booksByYear.get(year)?.size ?? 0,
      };
    });

  const loggedTotal = logs.reduce((sum, l) => sum + l.pages, 0);
  return {
    total,
    unique,
    perMonth: loggedTotal / Math.max(1, monthsBetween(first, today)),
    perDay: loggedTotal / Math.max(1, daysBetween(first, today)),
    since: dated[0],
    years,
  };
}

/** Livros que contam para a meta do ano: concluídos no ano e não excluídos. */
export function goalBooks(entries: ShelfEntry[], year: number): ShelfEntry[] {
  const prefix = `${year}-`;
  return entries
    .filter((e) => (e.finishedDates ?? []).some((d) => d.startsWith(prefix)))
    .sort((a, b) => lastFinish(b, prefix).localeCompare(lastFinish(a, prefix)));
}

function lastFinish(entry: ShelfEntry, prefix: string): string {
  return [...entry.finishedDates].filter((d) => d.startsWith(prefix)).sort().pop() ?? '';
}

export function countedForGoal(entries: ShelfEntry[], goal: Goal | null, year: number): number {
  const excluded = new Set(goal?.excluded ?? []);
  return goalBooks(entries, year).filter((e) => !excluded.has(e.bookId)).length;
}

export interface WeeklyPlan {
  goalBooks: number;
  doneBooks: number;
  remainingBooks: number;
  /** Livros usados no plano (lendo primeiro, depois a fila de "lerei"). */
  plannedBooks: ShelfEntry[];
  /** Livros que faltam para a meta e ainda não estão na estante. */
  missingBooks: number;
  pagesNeeded: number;
  weeksLeft: number;
  weeklyPages: number;
}

/**
 * Calcula quantas páginas por semana são necessárias para cumprir a meta anual.
 * Considera as páginas restantes dos livros em leitura (os mais adiantados primeiro) e,
 * em seguida, os livros marcados como "lerei" em ordem de inclusão. Se não houver livros
 * suficientes na estante, usa a média de páginas dos livros do usuário.
 */
export function weeklyPlan(
  entries: ShelfEntry[],
  goal: Goal | null,
  today = new Date(),
): WeeklyPlan | null {
  if (!goal || goal.books <= 0) return null;
  const year = today.getFullYear();
  const excluded = new Set(goal.excluded ?? []);
  const doneBooks = countedForGoal(entries, goal, year);
  const remainingBooks = Math.max(0, goal.books - doneBooks);

  const eligible = entries.filter((e) => !excluded.has(e.bookId));
  const reading = eligible
    .filter((e) => e.status === 'reading')
    .sort((a, b) => remaining(a) - remaining(b));
  const queue = eligible
    .filter((e) => e.status === 'toread')
    .sort((a, b) => a.addedAt - b.addedAt);
  const plannedBooks = [...reading, ...queue].slice(0, remainingBooks);
  const missingBooks = remainingBooks - plannedBooks.length;

  const sized = entries.filter((e) => e.pages > 0);
  const averagePages = sized.length
    ? sized.reduce((sum, e) => sum + e.pages, 0) / sized.length
    : DEFAULT_BOOK_PAGES;

  const pagesNeeded = Math.round(
    plannedBooks.reduce((sum, e) => sum + remaining(e), 0) + missingBooks * averagePages,
  );
  const daysLeft = daysBetween(today, new Date(year, 11, 31));
  const weeksLeft = Math.max(1, daysLeft / 7);

  return {
    goalBooks: goal.books,
    doneBooks,
    remainingBooks,
    plannedBooks,
    missingBooks,
    pagesNeeded,
    weeksLeft,
    weeklyPages: Math.ceil(pagesNeeded / weeksLeft),
  };
}

function remaining(entry: ShelfEntry): number {
  const current = entry.status === 'reading' ? entry.currentPage : 0;
  return Math.max(0, (entry.pages || DEFAULT_BOOK_PAGES) - current);
}

/** Segunda-feira da semana de `today`, no formato AAAA-MM-DD. */
export function weekStart(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return isoDate(d);
}

export function pagesSince(logs: ReadingLog[], fromDate: string): number {
  return logs.filter((l) => l.date >= fromDate).reduce((sum, l) => sum + l.pages, 0);
}
