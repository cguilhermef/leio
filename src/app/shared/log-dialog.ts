import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/firebase';
import { ShelfEntry } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { positionToPage } from '../core/stats';
import { isoDate } from '../core/text';

type Mode = 'page' | 'position';

/**
 * Folha para registrar o progresso de um livro em leitura, pela página ou, para ebooks
 * sem números de página, pela posição do Kindle (convertida em página do impresso).
 */
@Component({
  selector: 'app-log-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <dialog #dialog class="sheet" (close)="entry.set(null)">
      @if (entry(); as e) {
        <form (ngSubmit)="save(e)">
          <h2>Onde você está?</h2>
          <p class="muted">{{ e.title }}</p>

          @if (e.pages) {
            <div class="mode" role="group" aria-label="Forma de registro">
              <button type="button" [class.active]="mode() === 'page'" (click)="mode.set('page')">Página</button>
              <button type="button" [class.active]="mode() === 'position'" (click)="mode.set('position')">Posição do Kindle</button>
            </div>
          }

          <p class="muted small">
            @if (e.status === 'reading' && e.currentPage) {
              Último registro: página {{ e.currentPage }}{{ e.pages ? ' de ' + e.pages : '' }}.
            } @else {
              Primeiro registro desta leitura: contamos a partir da página 0.
            }
          </p>

          @if (mode() === 'page') {
            <div class="row fields">
              <label class="field">
                <span>Página atual</span>
                <input class="input" type="number" inputmode="numeric" name="page" required
                  [min]="min()" [max]="e.pages || null" [(ngModel)]="page" />
              </label>
              <label class="field">
                <span>Data</span>
                <input class="input" type="date" name="date" required [max]="today" [(ngModel)]="date" />
              </label>
            </div>
          } @else {
            <div class="row fields">
              <label class="field">
                <span>Posição atual</span>
                <input class="input" type="number" inputmode="numeric" name="position" min="0"
                  [(ngModel)]="position" />
              </label>
              <label class="field">
                <span>Total de posições</span>
                <input class="input" type="number" inputmode="numeric" name="positions" min="1"
                  [(ngModel)]="positions" />
              </label>
            </div>
            <label class="field">
              <span>Data</span>
              <input class="input" type="date" name="date" required [max]="today" [(ngModel)]="date" />
            </label>
            <p class="muted small">
              O total aparece no Kindle como "Posição X de Y". Convertemos para as {{ e.pages }}
              páginas do livro impresso.
              @if (computedPage() !== null) {
                <strong>Equivale à página {{ computedPage() }}.</strong>
              }
            </p>
          }

          @if (targetPage() !== null && targetPage()! > min()) {
            <p class="muted small">{{ targetPage()! - min() }} páginas lidas neste registro.</p>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <div class="actions">
            <button type="submit" class="btn" [disabled]="busy() || targetPage() === null">Registrar</button>
            <button type="button" class="btn secondary" (click)="close()">Cancelar</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .mode {
      display: flex; padding: 4px; margin: 14px 0 8px; border-radius: 999px; background: var(--cream-200);
      button {
        flex: 1; min-height: 34px; border: 0; border-radius: 999px; background: transparent;
        color: var(--muted); font-weight: 600; cursor: pointer;
      }
      button.active { background: var(--surface); color: var(--olive-900); }
    }
    .fields { margin-top: 12px; }
  `,
})
export class LogDialog {
  private shelf = inject(ShelfService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly finished = output<ShelfEntry>();

  protected readonly entry = signal<ShelfEntry | null>(null);
  protected readonly mode = signal<Mode>('page');
  protected readonly page = signal<number | null>(null);
  protected readonly position = signal<number | null>(null);
  protected readonly positions = signal<number | null>(null);
  protected readonly date = signal(isoDate());
  protected readonly min = signal(0);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly today = isoDate();

  protected readonly computedPage = computed(() => {
    const entry = this.entry();
    const position = this.position();
    const positions = this.positions();
    if (!entry?.pages || position === null || !positions) return null;
    return positionToPage(Number(position), Number(positions), entry.pages);
  });

  protected readonly targetPage = computed(() => {
    if (this.mode() === 'position') return this.computedPage();
    const page = this.page();
    return page === null || (page as unknown) === '' ? null : Number(page);
  });

  open(entry: ShelfEntry) {
    this.entry.set(entry);
    this.min.set(entry.status === 'reading' ? entry.currentPage : 0);
    this.mode.set(entry.positions && entry.pages ? 'position' : 'page');
    this.page.set(null);
    this.position.set(null);
    this.positions.set(entry.positions ?? null);
    this.date.set(isoDate());
    this.error.set('');
    this.dialog().nativeElement.showModal();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  async save(entry: ShelfEntry) {
    const page = this.targetPage();
    if (page === null || !Number.isFinite(page) || page < 0) return;
    const positions = this.mode() === 'position' ? Number(this.positions()) || undefined : undefined;
    this.busy.set(true);
    this.error.set('');
    try {
      const { finished } = await this.shelf.logPage(entry, page, this.date(), positions);
      this.close();
      if (finished) this.finished.emit(entry);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
