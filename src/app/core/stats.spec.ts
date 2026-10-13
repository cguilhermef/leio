import { ReadingLog, ShelfEntry } from './models';
import { goalBooks, readingStats, totalPages, uniquePages, weekStart, weeklyPlan } from './stats';

function entry(partial: Partial<ShelfEntry>): ShelfEntry {
  return {
    bookId: 'b',
    title: 'Livro',
    authors: [],
    pages: 200,
    status: 'toread',
    currentPage: 0,
    maxPage: 0,
    pagesRead: 0,
    reads: 0,
    finishedDates: [],
    addedAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function log(date: string, pages: number): ReadingLog {
  return { bookId: 'b', title: 'Livro', date, fromPage: 0, toPage: pages, pages, kind: 'progress', createdAt: 0 };
}

describe('stats', () => {
  const reread = entry({ bookId: 'a', status: 'read', pages: 300, maxPage: 300, pagesRead: 600, reads: 2, finishedDates: ['2025-03-01', '2026-02-01'] });
  const reading = entry({ bookId: 'b', status: 'reading', pages: 200, currentPage: 50, maxPage: 50, pagesRead: 50, addedAt: 2 });

  it('soma páginas totais e únicas', () => {
    expect(totalPages([reread, reading])).toBe(650);
    expect(uniquePages([reread, reading])).toBe(350);
  });

  it('lista livros concluídos no ano', () => {
    expect(goalBooks([reread, reading], 2026).map((e) => e.bookId)).toEqual(['a']);
    expect(goalBooks([reread, reading], 2024)).toEqual([]);
  });

  it('calcula médias por ano a partir dos registros', () => {
    const stats = readingStats([reread], [log('2026-01-01', 310), log('2026-01-10', 0)], new Date(2026, 0, 31));
    expect(stats.years).toHaveLength(1);
    expect(stats.years[0].pages).toBe(310);
    expect(stats.perDay).toBeCloseTo(10);
    expect(stats.perMonth).toBe(310);
  });

  it('calcula a meta semanal com livros em leitura, depois a fila e a média', () => {
    const queued = entry({ bookId: 'c', status: 'toread', pages: 100, addedAt: 1 });
    const today = new Date(2026, 11, 3); // 29 dias até o fim do ano
    const plan = weeklyPlan([reread, reading, queued], { year: 2026, books: 4, excluded: [] }, today)!;
    expect(plan.doneBooks).toBe(1);
    expect(plan.remainingBooks).toBe(3);
    expect(plan.plannedBooks.map((e) => e.bookId)).toEqual(['b', 'c']);
    expect(plan.missingBooks).toBe(1);
    // 150 restantes + 100 da fila + média (300 + 200 + 100) / 3 = 200
    expect(plan.pagesNeeded).toBe(450);
    expect(plan.weeklyPages).toBe(Math.ceil(450 / (29 / 7)));
  });

  it('respeita livros excluídos da meta', () => {
    const plan = weeklyPlan([reread], { year: 2026, books: 1, excluded: ['a'] }, new Date(2026, 5, 1))!;
    expect(plan.doneBooks).toBe(0);
  });

  it('começa a semana na segunda-feira', () => {
    expect(weekStart(new Date(2026, 9, 13))).toBe('2026-10-12');
    expect(weekStart(new Date(2026, 9, 18))).toBe('2026-10-12');
  });
});
