import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/firebase';
import { ShelfEntry } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { isoDate } from '../core/text';

/** Folha para registrar a página atual de um livro em leitura. */
@Component({
  selector: 'app-log-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <dialog #dialog class="sheet" (close)="entry.set(null)">
      @if (entry(); as e) {
        <form (ngSubmit)="save(e)">
          <h2>Em que página você está?</h2>
          <p class="muted">{{ e.title }}</p>
          <p class="muted small">
            @if (e.status === 'reading' && e.currentPage) {
              Último registro: página {{ e.currentPage }}{{ e.pages ? ' de ' + e.pages : '' }}.
            } @else {
              Primeiro registro desta leitura: contamos a partir da página 0.
            }
          </p>
          <div class="row" style="margin-top: 16px">
            <label class="field">
              <span>Página atual</span>
              <input class="input" type="number" inputmode="numeric" name="page" required
                [min]="min()" [max]="e.pages || null" [(ngModel)]="page" autofocus />
            </label>
            <label class="field">
              <span>Data</span>
              <input class="input" type="date" name="date" required [max]="today" [(ngModel)]="date" />
            </label>
          </div>
          @if (page() !== null && page()! > min()) {
            <p class="muted small">{{ page()! - min() }} páginas lidas neste registro.</p>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <div class="actions">
            <button type="submit" class="btn" [disabled]="busy() || page() === null">Registrar</button>
            <button type="button" class="btn secondary" (click)="close()">Cancelar</button>
          </div>
        </form>
      }
    </dialog>
  `,
})
export class LogDialog {
  private shelf = inject(ShelfService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly finished = output<ShelfEntry>();

  protected readonly entry = signal<ShelfEntry | null>(null);
  protected readonly page = signal<number | null>(null);
  protected readonly date = signal(isoDate());
  protected readonly min = signal(0);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly today = isoDate();

  open(entry: ShelfEntry) {
    this.entry.set(entry);
    this.min.set(entry.status === 'reading' ? entry.currentPage : 0);
    this.page.set(null);
    this.date.set(isoDate());
    this.error.set('');
    this.dialog().nativeElement.showModal();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  async save(entry: ShelfEntry) {
    const page = Number(this.page());
    if (!Number.isFinite(page) || page < 0) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { finished } = await this.shelf.logPage(entry, page, this.date());
      this.close();
      if (finished) this.finished.emit(entry);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
