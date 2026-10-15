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
import { BookForm, EMPTY_BOOK_FORM, draftFromForm, mergeCatalogCard, splitAuthors } from '../core/book-form';
import { CatalogService, OnlineEdition } from '../core/catalog.service';
import { errorMessage } from '../core/firebase';
import { resizeImage } from '../core/image';
import { Book, ShelfStatus } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { authorsLabel, isoDate } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { BookFields } from '../shared/book-fields';
import { Icon } from '../shared/icon';

/**
 * Etapas do cadastro:
 * photo -> confirm (nome identificado) -> matches (já no catálogo) -> covers (capa online) -> form.
 * Buscando só pelo autor, confirm -> works (livros do autor) e, escolhida a obra, segue para matches.
 */
type Step = 'photo' | 'confirm' | 'works' | 'matches' | 'covers' | 'form';

@Component({
  selector: 'app-add-book',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BookCover, BookFields, Icon],
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
  /** Busca só pelo autor: livros dele no catálogo e obras encontradas online. */
  protected readonly authorBooks = signal<Book[]>([]);
  protected readonly works = signal<OnlineEdition[]>([]);
  protected readonly searchedAuthor = signal('');
  protected readonly editions = signal<OnlineEdition[]>([]);
  protected readonly onlineFailed = signal(false);
  /** Capas que não carregaram ou são apenas o aviso de "imagem indisponível". */
  private readonly hiddenCovers = signal(new Set<string>());
  protected readonly visibleEditions = computed(() =>
    this.editions().filter((e) => !this.hiddenCovers().has(e.coverUrl)),
  );
  protected readonly isbnMatch = signal<Book | null>(null);
  protected readonly cardRead = signal(false);
  protected readonly form = signal<BookForm>({ ...EMPTY_BOOK_FORM });
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

  /** Com título, procura o livro; só com o autor, lista os livros dele. */
  protected submitSearch() {
    this.searchedAuthor.set('');
    if (this.title().trim()) {
      this.search();
      return;
    }
    const author = this.authors().trim();
    if (!author) {
      this.error.set('Informe o título ou o autor do livro.');
      return;
    }
    void this.withBusy('Procurando livros do autor...', async () => {
      const result = await this.catalog.searchAuthor(author);
      this.searchedAuthor.set(author);
      this.authorBooks.set(result.matches);
      this.works.set(result.works);
      this.onlineFailed.set(result.onlineFailed);
      this.step.set('works');
    });
  }

  protected chooseWork(work: OnlineEdition) {
    this.title.set(work.title);
    this.subtitle = work.subtitle;
    this.authors.set(work.authors.join(', '));
    this.search();
  }

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
      this.hiddenCovers.set(new Set());
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

  protected hideCover(edition: OnlineEdition) {
    this.hiddenCovers.update((set) => new Set(set).add(edition.coverUrl));
  }

  /** Esconde imagens minúsculas, que são marcadores de "sem capa" dos catálogos. */
  protected checkCover(event: Event, edition: OnlineEdition) {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth < 40 || img.naturalHeight < 40) this.hideCover(edition);
  }

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
      this.form.update((f) => mergeCatalogCard(f, draft));
      this.isbnMatch.set(match);
      this.cardRead.set(true);
    });
  }

  protected back() {
    const step = this.step();
    // Quem chegou pela busca por autor volta para a lista de livros dele.
    const searchStep: Step = this.searchedAuthor() ? 'works' : 'confirm';
    this.error.set('');
    if (step === 'form') this.step.set(this.editions().length || this.photo() ? 'covers' : searchStep);
    else if (step === 'covers') this.step.set(this.matches().length ? 'matches' : searchStep);
    else if (step === 'matches') this.step.set(searchStep);
    else if (step === 'works') this.step.set('confirm');
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

  /** "Não lembro": salva como lido sem data de conclusão. */
  protected saveWithoutDate() {
    this.finishedDate.set('');
    this.confirmFinishedDate();
  }

  protected save(status: ShelfStatus) {
    const draft = draftFromForm(this.form());
    if (!draft.title) {
      this.error.set('Informe o título do livro.');
      return;
    }
    void this.withBusy('Salvando...', async () => {
      const book = await this.catalog.create(draft, this.coverImage() || undefined);
      await this.shelf.add(book, status, this.finishedDate());
      void this.router.navigate(['/livro', book.id]);
    });
  }
}
