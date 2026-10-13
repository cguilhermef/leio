import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ShelfEntry } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { pagesSince, totalPages, uniquePages, weekStart, weeklyPlan } from '../core/stats';
import { authorsLabel, formatDate, formatNumber } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { Icon } from '../shared/icon';
import { LogDialog } from '../shared/log-dialog';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BookCover, Icon, LogDialog],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  protected auth = inject(AuthService);
  protected shelf = inject(ShelfService);

  protected readonly fmt = formatNumber;
  protected readonly fmtDate = formatDate;
  protected readonly authorsLabel = authorsLabel;

  protected readonly firstName = computed(() => (this.auth.user()?.displayName ?? '').split(' ')[0]);
  protected readonly total = computed(() => totalPages(this.shelf.entries()));
  protected readonly unique = computed(() => uniquePages(this.shelf.entries()));
  protected readonly plan = computed(() => weeklyPlan(this.shelf.entries(), this.shelf.goal()));
  protected readonly weekPages = computed(() => pagesSince(this.shelf.weekLogs(), weekStart()));
  protected readonly weekPercent = computed(() => {
    const plan = this.plan();
    if (!plan || !plan.weeklyPages) return 100;
    return Math.min(100, Math.round((this.weekPages() / plan.weeklyPages) * 100));
  });

  protected readonly justFinished = signal<ShelfEntry | null>(null);

  protected progress(e: ShelfEntry): number {
    return e.pages ? Math.round((e.currentPage / e.pages) * 100) : 0;
  }

  protected lastFinished(e: ShelfEntry): string {
    return [...e.finishedDates].sort().pop() ?? '';
  }
}
