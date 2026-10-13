import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STATUS_LABEL, ShelfEntry, ShelfStatus } from '../core/models';
import { authorsLabel, matchesQuery } from '../core/text';
import { BookCover } from './book-cover';
import { Icon } from './icon';

type Filter = 'all' | ShelfStatus;
type ViewMode = 'grid' | 'list';
const VIEW_KEY = 'leio.view';

function storedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Lista de livros com filtro por status, busca por título/autor e modo grade ou lista. */
@Component({
  selector: 'app-book-collection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BookCover, Icon],
  templateUrl: './book-collection.html',
  styleUrl: './book-collection.scss',
})
export class BookCollection {
  readonly entries = input.required<ShelfEntry[]>();
  readonly initialFilter = input<Filter>('all');
  readonly emptyText = input('Nenhum livro aqui ainda.');

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'reading', label: STATUS_LABEL.reading },
    { value: 'toread', label: STATUS_LABEL.toread },
    { value: 'read', label: STATUS_LABEL.read },
  ];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly authorsLabel = authorsLabel;

  protected readonly selectedFilter = signal<Filter | null>(null);
  protected readonly filter = computed(() => this.selectedFilter() ?? this.initialFilter());
  protected readonly query = signal('');
  protected readonly view = signal<ViewMode>(storedView());

  protected readonly counts = computed(() => {
    const counts: Record<Filter, number> = { all: 0, read: 0, reading: 0, toread: 0 };
    for (const e of this.entries()) {
      counts.all++;
      counts[e.status]++;
    }
    return counts;
  });

  protected readonly visible = computed(() => {
    const filter = this.filter();
    const query = this.query();
    return this.entries()
      .filter((e) => filter === 'all' || e.status === filter)
      .filter((e) => matchesQuery(query, e.title, e.authors))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  });

  protected setView(view: ViewMode) {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Preferência apenas local; ignorar se o armazenamento estiver indisponível.
    }
  }

  protected progress(entry: ShelfEntry): number {
    return entry.pages ? Math.round((entry.currentPage / entry.pages) * 100) : 0;
  }
}
