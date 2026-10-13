import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CatalogService } from '../core/catalog.service';
import { errorMessage } from '../core/firebase';
import { resizeImage } from '../core/image';
import { Book, ShelfStatus } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { authorsLabel, isoDate } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { Icon } from '../shared/icon';

type Step = 'cover' | 'matches' | 'card' | 'form';

interface DraftForm {
  title: string;
  subtitle: string;
  authors: string;
  publisher: string;
  year: number | null;
  isbn: string;
  pages: number | null;
  edition: string;
}

const EMPTY_FORM: DraftForm = {
  title: '',
  subtitle: '',
  authors: '',
  publisher: '',
  year: null,
  isbn: '',
  pages: null,
  edition: '',
};

@Component({
  selector: 'app-add-book',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BookCover, Icon],
  templateUrl: './add-book.html',
  styleUrl: './add-book.scss',
})
export class AddBookPage {
  private catalog = inject(CatalogService);
  private shelf = inject(ShelfService);
  private router = inject(Router);

  protected readonly authorsLabel = authorsLabel;
  protected readonly today = isoDate();

  protected readonly step = signal<Step>('cover');
  protected readonly busy = signal('');
  protected readonly error = signal('');
  protected readonly coverImage = signal('');
  protected readonly matches = signal<Book[]>([]);
  protected readonly isbnMatch = signal<Book | null>(null);
  protected readonly form = signal<DraftForm>({ ...EMPTY_FORM });
  protected readonly finishedDate = signal(isoDate());

  private async withBusy(label: string, action: () => Promise<void>) {
    this.busy.set(label);
    this.error.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set('');
    }
  }

  private fileFrom(event: Event): File | null {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    return file;
  }

  protected onCover(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Lendo a capa...', async () => {
      const image = await resizeImage(file, 1024);
      this.coverImage.set(image);
      const result = await this.catalog.identifyCover(image);
      this.form.set({
        ...EMPTY_FORM,
        title: result.title,
        subtitle: result.subtitle,
        authors: result.authors.join(', '),
      });
      this.matches.set(result.matches);
      this.step.set(result.matches.length ? 'matches' : 'card');
    });
  }

  protected onCard(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Lendo a ficha catalográfica...', async () => {
      const image = await resizeImage(file, 1600, 0.9);
      const { draft, match } = await this.catalog.readCatalogCard(image);
      const current = this.form();
      this.form.set({
        title: draft.title || current.title,
        subtitle: draft.subtitle || current.subtitle,
        authors: draft.authors.length ? draft.authors.join(', ') : current.authors,
        publisher: draft.publisher ?? '',
        year: draft.year ?? null,
        isbn: draft.isbn ?? '',
        pages: draft.pages || null,
        edition: draft.edition ?? '',
      });
      this.isbnMatch.set(match);
      this.step.set('form');
    });
  }

  protected manual() {
    this.isbnMatch.set(null);
    this.step.set('form');
  }

  protected notListed() {
    this.step.set('card');
  }

  protected choose(book: Book) {
    void this.router.navigate(['/livro', book.id]);
  }

  protected update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected restart() {
    this.step.set('cover');
    this.coverImage.set('');
    this.matches.set([]);
    this.isbnMatch.set(null);
    this.form.set({ ...EMPTY_FORM });
    this.error.set('');
  }

  protected save(status: ShelfStatus) {
    const f = this.form();
    if (!f.title.trim()) {
      this.error.set('Informe o título do livro.');
      return;
    }
    void this.withBusy('Salvando...', async () => {
      const book = await this.catalog.create(
        {
          title: f.title,
          subtitle: f.subtitle,
          authors: f.authors.split(/[,;]/),
          publisher: f.publisher,
          year: f.year ? Number(f.year) : null,
          isbn: f.isbn,
          pages: Number(f.pages) || 0,
          edition: f.edition,
        },
        this.coverImage() || undefined,
      );
      await this.shelf.add(book, status, this.finishedDate());
      void this.router.navigate(['/livro', book.id]);
    });
  }
}
