import { ShelfEntry } from './models';
import { groupByReadingDate, lastFinishedDate } from './grouping';

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

describe('grouping', () => {
  it('usa a leitura concluída mais recente', () => {
    expect(lastFinishedDate(entry({ finishedDates: ['2026-02-01', '2025-03-01'] }))).toBe('2026-02-01');
    expect(lastFinishedDate(entry({}))).toBe('');
  });

  it('agrupa por mês, do mais recente ao mais antigo, com lendo no topo e lerei no fim', () => {
    const groups = groupByReadingDate([
      entry({ bookId: 'antigo', status: 'read', finishedDates: ['2025-12-20'] }),
      entry({ bookId: 'fila', status: 'toread' }),
      entry({ bookId: 'outubro-1', status: 'read', finishedDates: ['2026-10-02'] }),
      entry({ bookId: 'sem-data', status: 'read' }),
      entry({ bookId: 'outubro-2', status: 'read', finishedDates: ['2025-01-01', '2026-10-09'] }),
      entry({ bookId: 'lendo', status: 'reading' }),
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      'Lendo',
      'Outubro de 2026',
      'Dezembro de 2025',
      'Lidos sem data',
      'Lerei',
    ]);
    expect(groups[1].entries.map((e) => e.bookId)).toEqual(['outubro-2', 'outubro-1']);
  });
});
