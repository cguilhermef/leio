import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/firebase';
import { ShelfService } from '../core/shelf.service';
import { goalBooks, weeklyPlan } from '../core/stats';
import { authorsLabel, formatNumber } from '../core/text';
import { BookCover } from '../shared/book-cover';

@Component({
  selector: 'app-goal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BookCover],
  template: `
    <div class="page">
      <div class="page-head"><h1>Meta de {{ year }}</h1></div>

      <form class="card goal-form" (ngSubmit)="save()">
        <label class="field">
          <span>Quantos livros você quer ler este ano?</span>
          <input class="input" type="number" min="1" max="1000" name="books" inputmode="numeric"
            [(ngModel)]="booksInput" />
        </label>
        <button type="submit" class="btn" [disabled]="busy() || !booksInput()">Salvar</button>
      </form>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (plan(); as p) {
        <section class="section">
          <div class="summary">
            <div>
              <strong>{{ p.doneBooks }}</strong>
              <span class="muted small">de {{ p.goalBooks }} livros lidos</span>
            </div>
            <div>
              <strong>{{ fmt(p.weeklyPages) }}</strong>
              <span class="muted small">páginas por semana</span>
            </div>
          </div>
          <div class="progress big"><span [style.width.%]="percent()"></span></div>
          @if (p.remainingBooks > 0) {
            <p class="muted small explain">
              Faltam {{ p.remainingBooks }} {{ p.remainingBooks === 1 ? 'livro' : 'livros' }}:
              {{ fmt(p.pagesNeeded) }} páginas em {{ fmt(p.weeksLeft) }} semanas.
              O cálculo usa os livros que você está lendo e, em seguida, os da lista "Lerei".
              @if (p.missingBooks > 0) {
                Para {{ p.missingBooks }} {{ p.missingBooks === 1 ? 'livro ainda não escolhido' : 'livros ainda não escolhidos' }},
                usamos a média de páginas dos seus livros.
              }
            </p>
          } @else {
            <p class="explain">Meta cumprida. Parabéns!</p>
          }

          @if (p.plannedBooks.length) {
            <h2 class="subhead">Próximos para a meta</h2>
            <ul class="list-plain">
              @for (e of p.plannedBooks; track e.bookId) {
                <li>
                  <app-book-cover class="thumb" [url]="e.coverUrl" [title]="e.title" />
                  <a class="grow plain" [routerLink]="['/livro', e.bookId]">
                    <strong>{{ e.title }}</strong><br />
                    <span class="muted small">
                      {{ e.status === 'reading' ? 'Lendo, faltam ' + (e.pages - e.currentPage) + ' páginas' : 'Lerei, ' + e.pages + ' páginas' }}
                    </span>
                  </a>
                </li>
              }
            </ul>
          }
        </section>
      }

      <section class="section">
        <h2 class="subhead">Lidos em {{ year }}</h2>
        @if (finished().length) {
          <p class="muted small">Desmarque os livros que não devem contar para a meta.</p>
          <ul class="list-plain">
            @for (e of finished(); track e.bookId) {
              <li>
                <app-book-cover class="thumb" [url]="e.coverUrl" [title]="e.title" />
                <a class="grow plain" [routerLink]="['/livro', e.bookId]">
                  <strong>{{ e.title }}</strong><br />
                  <span class="muted small">{{ authorsLabel(e.authors) }}</span>
                </a>
                <label class="check">
                  <input type="checkbox" [checked]="!excluded().has(e.bookId)"
                    (change)="toggle(e.bookId, $any($event.target).checked)" />
                  <span class="sr-only">Contar na meta</span>
                </label>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Nenhum livro concluído este ano ainda.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .goal-form { display: flex; align-items: flex-end; gap: 12px; }
    .goal-form .field { flex: 1; margin: 0; }
    .summary { display: flex; gap: 12px; margin-bottom: 12px; }
    .summary div { flex: 1; display: flex; flex-direction: column; }
    .summary strong { font-family: var(--serif); font-size: 2.2rem; color: var(--olive-900); line-height: 1.1; }
    .progress.big { height: 10px; border-radius: 5px; }
    .explain { margin-top: 10px; }
    .subhead { margin: 24px 0 6px; }
    .thumb { width: 44px; flex: none; }
    .plain { color: inherit; text-decoration: none; }
    .check input { width: 22px; height: 22px; accent-color: var(--olive-700); }
  `,
})
export class GoalPage {
  private shelf = inject(ShelfService);
  protected readonly year = new Date().getFullYear();
  protected readonly fmt = formatNumber;
  protected readonly authorsLabel = authorsLabel;

  protected readonly booksInput = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly plan = computed(() => weeklyPlan(this.shelf.entries(), this.shelf.goal()));
  protected readonly finished = computed(() => goalBooks(this.shelf.entries(), this.year));
  protected readonly excluded = computed(() => new Set(this.shelf.goal()?.excluded ?? []));
  protected readonly percent = computed(() => {
    const p = this.plan();
    return p ? Math.min(100, Math.round((p.doneBooks / p.goalBooks) * 100)) : 0;
  });

  constructor() {
    effect(() => {
      const goal = this.shelf.goal();
      if (goal?.books && this.booksInput() === null) this.booksInput.set(goal.books);
    });
  }

  protected async save() {
    const books = Math.round(Number(this.booksInput()));
    if (!books || books < 1) return;
    await this.run(() => this.shelf.saveGoal(books));
  }

  protected toggle(bookId: string, included: boolean) {
    void this.run(() => this.shelf.setGoalInclusion(bookId, included));
  }

  private async run(action: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
