import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BookForm, EMPTY_BOOK_FORM, draftFromForm, formFromBook, mergeCatalogCard } from '../core/book-form';
import { CatalogService, OnlineEdition } from '../core/catalog.service';
import { EditsService } from '../core/edits.service';
import { errorMessage } from '../core/firebase';
import { resizeImage } from '../core/image';
import { Book } from '../core/models';
import { BookCover } from '../shared/book-cover';
import { BookFields } from '../shared/book-fields';
import { Icon } from '../shared/icon';

/**
 * Edição dos dados e da capa de um livro do catálogo. Editores salvam direto; os demais
 * enviam uma sugestão que um editor aprova.
 */
@Component({
  selector: 'app-edit-book',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BookCover, BookFields, Icon],
  template: `
    <div class="page">
      <div class="page-head">
        <button type="button" class="icon-btn" aria-label="Voltar" (click)="location.back()" [disabled]="!!busy()">
          <app-icon name="back" />
        </button>
        <h1>{{ edits.isEditor() ? 'Editar livro' : 'Sugerir edição' }}</h1>
      </div>

      @if (!loaded()) {
        <div class="spinner" role="status" aria-label="Carregando"></div>
      } @else if (!book()) {
        <p class="muted">Livro não encontrado.</p>
      } @else if (sent()) {
        <section class="card done">
          <app-icon name="check" [size]="32" />
          <h2>Sugestão enviada</h2>
          <p class="muted">As alterações passam a valer depois que um editor aprovar.</p>
          <a class="btn" [routerLink]="['/livro', id()]">Voltar ao livro</a>
        </section>
      } @else if (busy()) {
        <div class="card working">
          <div class="spinner" role="status"></div>
          <p>{{ busy() }}</p>
        </div>
      } @else {
        @if (!edits.isEditor()) {
          <p class="muted intro">Sua sugestão é revisada por um editor antes de valer para todos.</p>
        }

        <section class="card cover-card">
          <div class="cover-row">
            <app-book-cover class="cover" [url]="newCover() || book()!.coverUrl" [title]="form().title" />
            <div class="cover-actions">
              <p class="small muted">{{ newCover() ? 'Nova capa escolhida.' : 'Capa atual.' }}</p>
              <button type="button" class="btn small secondary" (click)="searchCovers()">
                <app-icon name="search" [size]="16" /> Buscar capas online
              </button>
              <label class="btn small secondary">
                <app-icon name="camera" [size]="16" /> Fotografar capa
                <input class="sr-only" type="file" accept="image/*" capture="environment" (change)="onCoverPhoto($event)" />
              </label>
              @if (newCover()) {
                <button type="button" class="btn small secondary" (click)="newCover.set('')">Manter a capa atual</button>
              }
            </div>
          </div>
          @if (searched()) {
            @if (visibleEditions().length) {
              <ul class="covers">
                @for (ed of visibleEditions(); track ed.coverUrl) {
                  <li>
                    <button type="button" (click)="chooseEdition(ed)" [attr.aria-label]="'Escolher capa: ' + ed.title + (ed.publisher ? ', ' + ed.publisher : '')">
                      <img class="cover-img" [src]="ed.coverUrl" alt="" loading="lazy"
                        (load)="checkCover($event, ed)" (error)="hideCover(ed)" />
                      <span class="cover-title">{{ ed.title }}</span>
                      <span class="cover-meta">{{ ed.publisher }}{{ ed.publisher && ed.year ? ', ' : '' }}{{ ed.year ?? '' }}</span>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="muted small">Nenhuma capa encontrada online para este título e autor.</p>
            }
          }
        </section>

        <div class="card card-step">
          @if (cardRead()) {
            <p class="small"><app-icon name="check" [size]="16" /> Dados da ficha catalográfica aplicados.</p>
          } @else {
            <p class="small muted">Fotografe a ficha catalográfica para preencher os dados da edição.</p>
            <label class="btn small secondary">
              <app-icon name="camera" [size]="16" /> Fotografar ficha
              <input class="sr-only" type="file" accept="image/*" capture="environment" (change)="onCard($event)" />
            </label>
          }
        </div>

        <form (ngSubmit)="save()">
          <app-book-fields [(value)]="form" />
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <div class="actions">
            <button type="submit" class="btn">{{ edits.isEditor() ? 'Salvar alterações' : 'Enviar sugestão' }}</button>
            <button type="button" class="btn secondary" (click)="location.back()">Cancelar</button>
          </div>
        </form>
      }

      @if (error() && (busy() || !book())) {
        <p class="error">{{ error() }}</p>
      }
    </div>
  `,
  styles: `
    .intro { margin-bottom: 12px; }
    .working, .done { text-align: center; color: var(--muted); }
    .working .spinner { margin: 12px auto; }
    .done { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--olive-700); }
    .cover-card { margin-bottom: 16px; }
    .cover-row { display: flex; gap: 14px; align-items: flex-start; }
    .cover { width: 96px; flex: none; }
    .cover-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .card-step { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-bottom: 16px; }
    .card-step app-icon { vertical-align: -3px; color: var(--olive-700); }
  `,
})
export class EditBookPage {
  private catalog = inject(CatalogService);
  protected edits = inject(EditsService);
  private router = inject(Router);
  protected location = inject(Location);

  /** Parâmetro de rota `:id` (via withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly book = signal<Book | null>(null);
  protected readonly loaded = signal(false);
  protected readonly form = signal<BookForm>({ ...EMPTY_BOOK_FORM });
  /** Nova capa (data URL), se o usuário escolheu trocar. */
  protected readonly newCover = signal('');
  protected readonly cardRead = signal(false);
  protected readonly busy = signal('');
  protected readonly error = signal('');
  protected readonly sent = signal(false);

  protected readonly searched = signal(false);
  private readonly editions = signal<OnlineEdition[]>([]);
  /** Capas que não carregaram ou são apenas o aviso de "imagem indisponível". */
  private readonly hiddenCovers = signal(new Set<string>());
  protected readonly visibleEditions = computed(() =>
    this.editions().filter((e) => !this.hiddenCovers().has(e.coverUrl)),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      this.loaded.set(false);
      this.catalog
        .get(id)
        .then((book) => {
          this.book.set(book);
          if (book) this.form.set(formFromBook(book));
        })
        .catch((error) => this.error.set(errorMessage(error)))
        .finally(() => this.loaded.set(true));
    });
  }

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

  protected searchCovers() {
    const draft = draftFromForm(this.form());
    void this.withBusy('Procurando capas...', async () => {
      const result = await this.catalog.search(draft.title, draft.authors);
      this.editions.set(result.editions);
      this.hiddenCovers.set(new Set());
      this.searched.set(true);
      if (result.onlineFailed) this.error.set('A busca online não respondeu agora. Tente novamente em instantes.');
    });
  }

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
      this.newCover.set(await resizeImage(image, 900, 0.88));
      this.searched.set(false);
    });
  }

  protected onCoverPhoto(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Preparando a capa...', async () => {
      this.newCover.set(await resizeImage(file, 900, 0.88));
    });
  }

  protected onCard(event: Event) {
    const file = this.fileFrom(event);
    if (!file) return;
    void this.withBusy('Lendo a ficha catalográfica...', async () => {
      const image = await resizeImage(file, 1600, 0.9);
      const { draft } = await this.catalog.readCatalogCard(image);
      this.form.update((f) => mergeCatalogCard(f, draft));
      this.cardRead.set(true);
    });
  }

  protected save() {
    const draft = draftFromForm(this.form());
    if (!draft.title) {
      this.error.set('Informe o título do livro.');
      return;
    }
    const isEditor = this.edits.isEditor();
    void this.withBusy(isEditor ? 'Salvando...' : 'Enviando sugestão...', async () => {
      const { applied } = await this.catalog.edit(this.id(), draft, this.newCover() || undefined);
      if (applied) void this.router.navigate(['/livro', this.id()], { replaceUrl: true });
      else this.sent.set(true);
    });
  }
}
