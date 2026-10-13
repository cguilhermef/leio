import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/firebase';
import { ShelfEntry, UserProfile } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { SocialService } from '../core/social.service';
import { totalPages } from '../core/stats';
import { formatNumber } from '../core/text';
import { BookCollection } from '../shared/book-collection';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-person',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BookCollection, Icon],
  template: `
    <div class="page">
      <div class="page-head">
        <a routerLink="/pessoas" class="icon-btn" aria-label="Voltar"><app-icon name="back" /></a>
        @if (profile(); as p) {
          @if (p.photoURL) {
            <img class="avatar" [src]="p.photoURL" alt="" referrerpolicy="no-referrer" />
          }
          <h1>{{ p.name }}</h1>
        }
      </div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      } @else if (entries(); as list) {
        <p class="muted summary">{{ fmt(total()) }} páginas lidas, {{ list.length }} livros</p>
        <app-book-collection [entries]="list" emptyText="Nenhum livro nesta lista." />
      } @else {
        <div class="spinner" role="status" aria-label="Carregando"></div>
      }
    </div>
  `,
  styles: `.summary { margin-bottom: 16px; }`,
})
export class PersonPage {
  private shelf = inject(ShelfService);
  private social = inject(SocialService);

  readonly uid = input.required<string>();

  protected readonly fmt = formatNumber;
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly entries = signal<ShelfEntry[] | null>(null);
  protected readonly error = signal('');
  protected readonly total = computed(() => totalPages(this.entries() ?? []));

  constructor() {
    effect(() => {
      const uid = this.uid();
      this.entries.set(null);
      this.error.set('');
      Promise.all([this.social.getProfile(uid), this.shelf.loadShelfOf(uid)])
        .then(([profile, entries]) => {
          this.profile.set(profile);
          this.entries.set(entries);
        })
        .catch((error) => this.error.set(errorMessage(error)));
    });
  }
}
