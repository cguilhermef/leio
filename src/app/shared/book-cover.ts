import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** Capa do livro; sem imagem, mostra um bloco com o título. */
@Component({
  selector: 'app-book-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url() && !failed()) {
      <img [src]="url()" [alt]="'Capa de ' + title()" loading="lazy" (error)="failed.set(true)" />
    } @else {
      <span class="placeholder">{{ title() }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      aspect-ratio: 2 / 3;
      border-radius: 6px;
      overflow: hidden;
      background: var(--olive-200);
      box-shadow: 0 1px 3px rgb(47 51 34 / 18%);
    }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .placeholder {
      display: flex; align-items: center; justify-content: center; text-align: center;
      height: 100%; padding: 8px; font-family: var(--serif); font-size: 0.8rem;
      color: var(--olive-900); overflow: hidden;
    }
  `,
})
export class BookCover {
  readonly url = input<string | undefined>('');
  readonly title = input('');
  protected readonly failed = signal(false);
}
