import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/firebase';
import { ReadingLog } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { readingStats } from '../core/stats';
import { formatDate, formatNumber } from '../core/text';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="page">
      <div class="page-head">
        <a routerLink="/" class="icon-btn" aria-label="Voltar"><app-icon name="back" /></a>
        <h1>Páginas lidas</h1>
      </div>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      } @else if (logs() === null) {
        <div class="spinner" role="status" aria-label="Carregando"></div>
      } @else {
        <div class="tiles">
          <div class="card tile wide">
            <span class="label">Total</span>
            <strong>{{ fmt(stats().total) }}</strong>
            <span class="muted small">inclui releituras</span>
          </div>
          <div class="card tile wide">
            <span class="label">Páginas únicas</span>
            <strong>{{ fmt(stats().unique) }}</strong>
            <span class="muted small">sem contar releituras</span>
          </div>
          <div class="card tile">
            <span class="label">Média por mês</span>
            <strong>{{ fmt(stats().perMonth) }}</strong>
          </div>
          <div class="card tile">
            <span class="label">Média por dia</span>
            <strong>{{ fmt(stats().perDay) }}</strong>
          </div>
        </div>
        @if (stats().since; as since) {
          <p class="muted small">Médias calculadas desde o primeiro registro, em {{ fmtDate(since) }}.</p>
        }

        <section class="section">
          <h2>Por ano</h2>
          @if (stats().years.length) {
            <table>
              <thead>
                <tr>
                  <th scope="col">Ano</th>
                  <th scope="col">Páginas</th>
                  <th scope="col">Por mês</th>
                  <th scope="col">Por dia</th>
                  <th scope="col">Livros</th>
                </tr>
              </thead>
              <tbody>
                @for (y of stats().years; track y.year) {
                  <tr>
                    <th scope="row">{{ y.year }}</th>
                    <td>{{ fmt(y.pages) }}</td>
                    <td>{{ fmt(y.perMonth) }}</td>
                    <td>{{ fmt(y.perDay) }}</td>
                    <td>{{ y.books }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="muted">Registre suas leituras para ver as estatísticas por ano.</p>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .tile { display: flex; flex-direction: column; gap: 2px; }
    .tile strong { font-family: var(--serif); font-size: 1.7rem; color: var(--olive-900); }
    .tile.wide strong { font-size: 2.1rem; }
    .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-variant-numeric: tabular-nums; }
    th, td { text-align: right; padding: 10px 6px; border-bottom: 1px solid var(--line); }
    th:first-child { text-align: left; }
    thead th { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
  `,
})
export class StatsPage {
  private shelf = inject(ShelfService);
  protected readonly fmt = formatNumber;
  protected readonly fmtDate = formatDate;
  protected readonly logs = signal<ReadingLog[] | null>(null);
  protected readonly error = signal('');
  protected readonly stats = computed(() => readingStats(this.shelf.entries(), this.logs() ?? []));

  constructor() {
    this.shelf
      .loadLogs()
      .then((logs) => this.logs.set(logs))
      .catch((error) => this.error.set(errorMessage(error)));
  }
}
