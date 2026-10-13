import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CatalogService, OnlineEdition } from '../core/catalog.service';
import { errorMessage } from '../core/firebase';
import { resizeImage } from '../core/image';
import { Book, ShelfStatus } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { authorsLabel, isoDate } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { Icon } from '../shared/icon';

/**
 * Etapas do cadastro:
 * photo -> confirm (nome identificado) -> matches (já no catálogo) -> covers (capa online) -> form.
 */
type Step = 'photo' | 'confirm' | 'matches' | 'covers' | 'form';

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

function splitAuthors(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

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

  protected readonly step = signal<Step>('photo');
  protected readonly busy = signal('');
  protected readonly error = signal('');

  /** Foto tirada pelo usuário (usada para identificar e, se ele quiser, como capa). */
  protected readonly photo = signal('');
  /** Capa que será salva com o livro. */
  protected readonly coverImage = signal('');

  protected readonly title = signal('');
  protected readonly authors = signal('');
  private subtitle = '';

  protected readonly matches = signal<Book[]>([]);
  protected readonly editions = signal<OnlineEdition[]>([]);
  protected readonly onlineFailed = signal(false);
  protected readonly isbnMatch = signal<Book | null>(null);
  protected readonly cardRead = signal(false);
  protected readonly form = signal<DraftForm>({ ...EMPTY_FORM });
  protected readonly finishedDate = signal(isoDate());
  private readonly readDialog = viewChild<ElementRef<HTMLDialogElement>>('readDialog');

  protected readonly stepIndex = computed(() => {
    const step = this.step();
    return step === 'photo' ? 0 : step === 'form' ? 2 : 1;
  });

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

  // 1. Foto da capa -------------------------------------------------------------

  protected onPhoto(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Identificando o livro...', async () => {
      const image = await resizeImage(file, 1024);
      this.photo.set(image);
      const result = await this.catalog.identifyCover(image);
      this.title.set(result.title);
      this.subtitle = result.subtitle;
      this.authors.set(result.authors.join(', '));
      this.step.set('confirm');
    });
  }

  protected typeManually() {
    this.photo.set('');
    this.title.set('');
    this.authors.set('');
    this.subtitle = '';
    this.error.set('');
    this.step.set('confirm');
  }

  // 2. Confirmação do nome e busca --------------------------------------------------

  protected search() {
    const title = this.title().trim();
    if (!title) {
      this.error.set('Informe o título do livro.');
      return;
    }
    void this.withBusy('Procurando o livro...', async () => {
      const result = await this.catalog.search(title, splitAuthors(this.authors()));
      this.matches.set(result.matches);
      this.editions.set(result.editions);
      this.onlineFailed.set(result.onlineFailed);
      this.step.set(result.matches.length ? 'matches' : 'covers');
    });
  }

  protected choose(book: Book) {
    void this.router.navigate(['/livro', book.id]);
  }

  protected notListed() {
    this.step.set('covers');
  }

  // 3. Escolha da capa -----------------------------------------------------------

  protected chooseEdition(edition: OnlineEdition) {
    void this.withBusy('Baixando a capa...', async () => {
      const image = await this.catalog.fetchCover(edition.coverUrl);
      this.coverImage.set(await resizeImage(image, 900, 0.88));
      this.fillForm(edition);
    });
  }

  protected usePhoto() {
    this.coverImage.set(this.photo());
    this.fillForm(null);
  }

  /** Tira uma nova foto só para usar como capa (por exemplo, quando não há capa online). */
  protected onCoverPhoto(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Preparando a capa...', async () => {
      this.coverImage.set(await resizeImage(file, 900, 0.88));
      this.fillForm(null);
    });
  }

  protected noCover() {
    this.coverImage.set('');
    this.fillForm(null);
  }

  private fillForm(edition: OnlineEdition | null) {
    this.form.set({
      title: this.title().trim(),
      subtitle: edition?.subtitle || this.subtitle,
      authors: edition?.authors.length ? edition.authors.join(', ') : this.authors(),
      publisher: edition?.publisher ?? '',
      year: edition?.year ?? null,
      isbn: edition?.isbn ?? '',
      pages: edition?.pages || null,
      edition: '',
    });
    this.isbnMatch.set(null);
    this.cardRead.set(false);
    this.step.set('form');
  }

  // 4. Ficha catalográfica (opcional) e dados --------------------------------------

  protected onCard(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Lendo a ficha catalográfica...', async () => {
      const image = await resizeImage(file, 1600, 0.9);
      const { draft, match } = await this.catalog.readCatalogCard(image);
      // Os dados da ficha descrevem a edição exata e prevalecem sobre a busca online.
      this.form.update((f) => ({
        title: draft.title || f.title,
        subtitle: draft.subtitle || f.subtitle,
        authors: draft.authors.length ? draft.authors.join(', ') : f.authors,
        publisher: draft.publisher || f.publisher,
        year: draft.year || f.year,
        isbn: draft.isbn || f.isbn,
        pages: draft.pages || f.pages,
        edition: draft.edition || f.edition,
      }));
      this.isbnMatch.set(match);
      this.cardRead.set(true);
    });
  }

  protected update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected back() {
    const step = this.step();
    this.error.set('');
    if (step === 'form') this.step.set(this.editions().length || this.photo() ? 'covers' : 'confirm');
    else if (step === 'covers') this.step.set(this.matches().length ? 'matches' : 'confirm');
    else if (step === 'matches') this.step.set('confirm');
    else this.step.set('photo');
  }

  /** "Lido" pede a data de conclusão antes de salvar. */
  protected askFinishedDate() {
    this.finishedDate.set(isoDate());
    this.readDialog()?.nativeElement.showModal();
  }

  protected confirmFinishedDate() {
    this.readDialog()?.nativeElement.close();
    this.save('read');
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
          authors: splitAuthors(f.authors),
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
