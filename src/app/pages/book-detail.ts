import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CatalogService } from '../core/catalog.service';
import { EditsService } from '../core/edits.service';
import { errorMessage } from '../core/firebase';
import { Book, ReadingLog, STATUS_LABEL, ShelfEntry, ShelfStatus } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { SocialService } from '../core/social.service';
import { authorsLabel, formatDate, isoDate } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { Icon } from '../shared/icon';
import { LogDialog } from '../shared/log-dialog';

type DateAction = 'finish' | 'reread' | 'add-read' | 'edit-log';

@Component({
  selector: 'app-book-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BookCover, Icon, LogDialog],
  templateUrl: './book-detail.html',
  styleUrl: './book-detail.scss',
})
export class BookDetailPage {
  private catalog = inject(CatalogService);
  protected shelf = inject(ShelfService);
  protected social = inject(SocialService);
  protected edits = inject(EditsService);
  private router = inject(Router);
  protected location = inject(Location);

  /** Parâmetro de rota `:id` (via withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly statuses: ShelfStatus[] = ['reading', 'toread', 'read'];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly authorsLabel = authorsLabel;
  protected readonly fmtDate = formatDate;
  protected readonly today = isoDate();
  protected readonly year = new Date().getFullYear();

  protected readonly book = signal<Book | null>(null);
  protected readonly bookLoaded = signal(false);
  protected readonly logs = signal<ReadingLog[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');

  protected readonly entry = computed(() => this.shelf.byId().get(this.id()) ?? null);
  protected readonly title = computed(() => this.entry()?.title ?? this.book()?.title ?? '');
  protected readonly authors = computed(() => this.entry()?.authors ?? this.book()?.authors ?? []);
  protected readonly coverUrl = computed(() => this.entry()?.coverUrl || this.book()?.coverUrl || '');
  protected readonly pages = computed(() => this.entry()?.pages || this.book()?.pages || 0);
  protected readonly finishedThisYear = computed(() =>
    (this.entry()?.finishedDates ?? []).some((d) => d.startsWith(`${this.year}-`)),
  );
  protected readonly countsForGoal = computed(
    () => !(this.shelf.goal()?.excluded ?? []).includes(this.id()),
  );

  private readonly logDialog = viewChild.required(LogDialog);
  private readonly dateDialog = viewChild.required<ElementRef<HTMLDialogElement>>('dateDialog');
  private readonly recommendDialog = viewChild.required<ElementRef<HTMLDialogElement>>('recommendDialog');

  protected readonly dateAction = signal<DateAction>('finish');
  protected readonly date = signal(isoDate());
  protected readonly pagesInput = signal<number | null>(null);
  protected readonly recipients = signal<Set<string>>(new Set());
  protected readonly note = signal('');

  constructor() {
    effect(() => {
      const id = this.id();
      this.bookLoaded.set(false);
      this.catalog
        .get(id)
        .then((book) => this.book.set(book))
        .catch(() => this.book.set(null))
        .finally(() => this.bookLoaded.set(true));
    });
    effect(() => {
      const entry = this.entry();
      // Recarrega o histórico sempre que a entrada da estante muda.
      if (entry) {
        void entry.updatedAt;
        this.shelf.loadBookLogs(entry.bookId).then((logs) => this.logs.set(logs)).catch(() => {});
      } else {
        this.logs.set([]);
      }
    });
  }

  private async run(action: () => Promise<unknown>, success = '') {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
      this.message.set(success);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected progress(e: ShelfEntry): number {
    return e.pages ? Math.round((e.currentPage / e.pages) * 100) : 0;
  }

  protected openLog(entry: ShelfEntry) {
    this.logDialog().open(entry);
  }

  protected changeStatus(entry: ShelfEntry, status: ShelfStatus) {
    if (status === entry.status) return;
    if (status === 'read') {
      this.askDate('finish');
      return;
    }
    void this.run(() => this.shelf.setStatus(entry, status));
  }

  /** Registro cuja data está sendo corrigida. */
  private editingLog: ReadingLog | null = null;

  protected askDate(action: DateAction, initial = isoDate()) {
    this.dateAction.set(action);
    this.date.set(initial);
    this.dateDialog().nativeElement.showModal();
  }

  protected editLogDate(log: ReadingLog) {
    this.editingLog = log;
    this.askDate('edit-log', log.date);
  }

  protected async confirmDate() {
    const action = this.dateAction();
    const date = this.date();
    const entry = this.entry();
    this.dateDialog().nativeElement.close();
    if (action === 'add-read') {
      const book = this.book();
      if (book) await this.run(() => this.shelf.add(book, 'read', date), 'Livro adicionado como lido.');
    } else if (entry && action === 'finish') {
      await this.run(() => this.shelf.finish(entry, date), 'Leitura concluída.');
    } else if (entry && action === 'reread') {
      await this.run(() => this.shelf.addReread(entry, date), 'Releitura registrada.');
    } else if (entry && action === 'edit-log' && this.editingLog) {
      const log = this.editingLog;
      this.editingLog = null;
      await this.run(() => this.shelf.changeLogDate(entry, log, date), 'Data atualizada.');
    }
  }

  protected add(status: ShelfStatus) {
    const book = this.book();
    if (!book) return;
    if (status === 'read') {
      this.askDate('add-read');
      return;
    }
    void this.run(() => this.shelf.add(book, status), 'Livro adicionado.');
  }

  protected startReread(entry: ShelfEntry) {
    void this.run(() => this.shelf.startReading(entry), 'Nova leitura iniciada.');
  }

  protected savePages(entry: ShelfEntry) {
    const pages = Number(this.pagesInput());
    if (!pages || pages < 1) return;
    void this.run(() => this.shelf.setPages(entry, pages));
  }

  protected toggleGoal(included: boolean) {
    void this.run(() => this.shelf.setGoalInclusion(this.id(), included));
  }

  protected deleteLog(entry: ShelfEntry, log: ReadingLog) {
    if (!confirm('Apagar este registro de leitura? As páginas dele deixam de ser contadas.')) return;
    void this.run(() => this.shelf.deleteLog(entry, log));
  }

  protected async remove(entry: ShelfEntry) {
    if (!confirm(`Remover "${entry.title}" dos seus livros? O histórico de leitura será apagado.`)) return;
    await this.run(() => this.shelf.remove(entry));
    if (!this.error()) void this.router.navigateByUrl('/livros');
  }

  protected openRecommend() {
    this.recipients.set(new Set());
    this.note.set('');
    this.recommendDialog().nativeElement.showModal();
  }

  protected toggleRecipient(uid: string) {
    const next = new Set(this.recipients());
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    this.recipients.set(next);
  }

  protected async sendRecommendation() {
    const recipients = [...this.recipients()];
    this.recommendDialog().nativeElement.close();
    await this.run(
      () =>
        this.social.recommend(
          { bookId: this.id(), title: this.title(), authors: this.authors(), coverUrl: this.coverUrl() },
          recipients,
          this.note(),
        ),
      recipients.length === 1 ? 'Indicação enviada.' : 'Indicações enviadas.',
    );
  }

  protected logLabel(log: ReadingLog): string {
    if (log.kind === 'reread') return `Releitura completa: ${log.pages} páginas`;
    if (log.kind === 'finish' && log.fromPage === 0) return `Leitura completa: ${log.pages} páginas`;
    const base = `Páginas ${log.fromPage} a ${log.toPage} (${log.pages})`;
    return log.kind === 'finish' ? `${base}, concluído` : base;
  }
}
