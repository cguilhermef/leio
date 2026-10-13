import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BookForm } from '../core/book-form';

/** Campos de dados do livro (título, autores, editora...), usados no cadastro e na edição. */
@Component({
  selector: 'app-book-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <label class="field">
      <span>Título</span>
      <input class="input" required [ngModel]="value().title" (ngModelChange)="set('title', $event)" [ngModelOptions]="standalone" />
    </label>
    <label class="field">
      <span>Subtítulo</span>
      <input class="input" [ngModel]="value().subtitle" (ngModelChange)="set('subtitle', $event)" [ngModelOptions]="standalone" />
    </label>
    <label class="field">
      <span>Autores (separados por vírgula)</span>
      <input class="input" [ngModel]="value().authors" (ngModelChange)="set('authors', $event)" [ngModelOptions]="standalone" />
    </label>
    <div class="row">
      <label class="field">
        <span>Páginas (do impresso)</span>
        <input class="input" type="number" min="1" inputmode="numeric"
          [ngModel]="value().pages" (ngModelChange)="set('pages', $event)" [ngModelOptions]="standalone" />
      </label>
      <label class="field">
        <span>Ano</span>
        <input class="input" type="number" inputmode="numeric"
          [ngModel]="value().year" (ngModelChange)="set('year', $event)" [ngModelOptions]="standalone" />
      </label>
    </div>
    <label class="field">
      <span>Editora</span>
      <input class="input" [ngModel]="value().publisher" (ngModelChange)="set('publisher', $event)" [ngModelOptions]="standalone" />
    </label>
    <div class="row">
      <label class="field">
        <span>ISBN</span>
        <input class="input" inputmode="numeric" [ngModel]="value().isbn" (ngModelChange)="set('isbn', $event)" [ngModelOptions]="standalone" />
      </label>
      <label class="field">
        <span>Edição</span>
        <input class="input" [ngModel]="value().edition" (ngModelChange)="set('edition', $event)" [ngModelOptions]="standalone" />
      </label>
    </div>
  `,
  styles: `:host { display: block; }`,
})
export class BookFields {
  readonly value = model.required<BookForm>();
  protected readonly standalone = { standalone: true };

  protected set<K extends keyof BookForm>(key: K, value: BookForm[K]) {
    this.value.update((form) => ({ ...form, [key]: value }));
  }
}
