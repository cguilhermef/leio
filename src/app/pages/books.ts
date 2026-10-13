import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ShelfStatus } from '../core/models';
import { ShelfService } from '../core/shelf.service';
import { BookCollection } from '../shared/book-collection';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-books',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BookCollection, RouterLink, Icon],
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Meus livros</h1>
        <a routerLink="/adicionar" class="btn small"><app-icon name="plus" [size]="18" /> Adicionar</a>
      </div>
      @if (shelf.loaded()) {
        @for (f of [filter()]; track f) {
          <app-book-collection [entries]="shelf.entries()" [initialFilter]="f"
            emptyText="Nenhum livro nesta lista. Use Adicionar para cadastrar um livro." />
        }
      } @else {
        <div class="spinner" role="status" aria-label="Carregando"></div>
      }
    </div>
  `,
})
export class BooksPage {
  protected shelf = inject(ShelfService);
  private route = inject(ActivatedRoute);

  protected readonly filter = toSignal(
    this.route.queryParamMap.pipe(
      map((params): ShelfStatus | 'all' => {
        const status = params.get('status');
        return status === 'read' || status === 'reading' || status === 'toread' ? status : 'all';
      }),
    ),
    { initialValue: 'all' as const },
  );
}
