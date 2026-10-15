import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EditsService } from '../core/edits.service';
import { errorMessage } from '../core/firebase';
import { BookChanges, BookEdit, Invite } from '../core/models';
import { SocialService } from '../core/social.service';
import { authorsLabel } from '../core/text';
import { BookCover } from '../shared/book-cover';
import { Icon } from '../shared/icon';

const FIELD_LABELS: Record<Exclude<keyof BookChanges, 'coverUrl'>, string> = {
  title: 'Título',
  subtitle: 'Subtítulo',
  authors: 'Autores',
  publisher: 'Editora',
  year: 'Ano',
  isbn: 'ISBN',
  pages: 'Páginas',
  edition: 'Edição',
};

function fieldText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined || value === 0 ? '' : String(value);
}

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BookCover, Icon],
  template: `
    <div class="page">
      <div class="page-head"><h1>Notificações</h1></div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (social.receivedInvites().length) {
        <section>
          <h2 class="subhead">Convites</h2>
          <ul class="list-plain">
            @for (inv of social.receivedInvites(); track inv.id) {
              <li class="invite">
                @if (inv.fromPhoto) {
                  <img class="avatar" [src]="inv.fromPhoto" alt="" referrerpolicy="no-referrer" />
                }
                <span class="grow">
                  <strong>{{ inv.fromName }}</strong> quer compartilhar os livros com você.
                  <span class="muted small block">{{ inv.fromEmail }}</span>
                </span>
                <span class="buttons">
                  <button type="button" class="btn small" (click)="respond(inv, true)" [disabled]="busy()">Aceitar</button>
                  <button type="button" class="btn small secondary" (click)="respond(inv, false)" [disabled]="busy()">Recusar</button>
                </span>
              </li>
            }
          </ul>
        </section>
      }

      @if (edits.pending().length) {
        <section class="section">
          <h2 class="subhead">Sugestões de edição</h2>
          <ul class="list-plain">
            @for (edit of edits.pending(); track edit.id) {
              <li class="edit">
                <span class="grow">
                  <span class="muted small block">{{ edit.fromName }} sugeriu para</span>
                  <a class="plain" [routerLink]="['/livro', edit.bookId]"><strong>{{ edit.bookTitle }}</strong></a>
                  @if (edit.changes.coverUrl) {
                    <span class="cover-diff">
                      <app-book-cover class="thumb" [url]="edit.before.coverUrl" [title]="edit.bookTitle" />
                      <app-icon name="back" class="arrow" [size]="16" />
                      <app-book-cover class="thumb" [url]="edit.changes.coverUrl" [title]="edit.bookTitle" />
                    </span>
                  }
                  <dl class="diff small">
                    @for (field of changedFields(edit); track field.label) {
                      <div>
                        <dt>{{ field.label }}</dt>
                        <dd><s class="muted">{{ field.before || 'vazio' }}</s> {{ field.after || 'vazio' }}</dd>
                      </div>
                    }
                  </dl>
                  @if (edit.aiReason) {
                    <span class="muted small block ai-reason">Revisão automática: {{ edit.aiReason }}</span>
                  }
                </span>
                <span class="buttons">
                  <button type="button" class="btn small" (click)="review(edit, true)" [disabled]="busy()">Aprovar</button>
                  <button type="button" class="btn small secondary" (click)="review(edit, false)" [disabled]="busy()">Recusar</button>
                </span>
              </li>
            }
          </ul>
        </section>
      }

      @if (edits.autoApplied().length) {
        <section class="section">
          <h2 class="subhead">Aplicadas automaticamente</h2>
          <ul class="list-plain">
            @for (edit of edits.autoApplied(); track edit.id) {
              <li class="edit">
                <span class="grow">
                  <span class="muted small block">{{ edit.fromName }} alterou</span>
                  <a class="plain" [routerLink]="['/livro', edit.bookId]"><strong>{{ edit.bookTitle }}</strong></a>
                  @if (edit.changes.coverUrl) {
                    <span class="cover-diff">
                      <app-book-cover class="thumb" [url]="edit.before.coverUrl" [title]="edit.bookTitle" />
                      <app-icon name="back" class="arrow" [size]="16" />
                      <app-book-cover class="thumb" [url]="edit.changes.coverUrl" [title]="edit.bookTitle" />
                    </span>
                  }
                  <dl class="diff small">
                    @for (field of changedFields(edit); track field.label) {
                      <div>
                        <dt>{{ field.label }}</dt>
                        <dd><s class="muted">{{ field.before || 'vazio' }}</s> {{ field.after || 'vazio' }}</dd>
                      </div>
                    }
                  </dl>
                  @if (edit.aiReason) {
                    <span class="muted small block ai-reason">Revisão automática: {{ edit.aiReason }}</span>
                  }
                </span>
                <span class="buttons">
                  <button type="button" class="btn small secondary" (click)="revert(edit)" [disabled]="busy()">Desfazer</button>
                </span>
              </li>
            }
          </ul>
        </section>
      }

      <section class="section">
        <h2 class="subhead">Indicações</h2>
        @if (social.recommendations().length) {
          <ul class="list-plain">
            @for (rec of social.recommendations(); track rec.id) {
              <li [class.unseen]="!rec.seen">
                <app-book-cover class="thumb" [url]="rec.coverUrl" [title]="rec.title" />
                <a class="grow plain" [routerLink]="['/livro', rec.bookId]">
                  <span class="muted small block">{{ rec.fromName }} indicou</span>
                  <strong>{{ rec.title }}</strong>
                  <span class="muted small block">{{ authorsLabel(rec.authors) }}</span>
                  @if (rec.note) {
                    <span class="note">"{{ rec.note }}"</span>
                  }
                </a>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Nenhuma indicação recebida ainda.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .subhead { margin-bottom: 6px; }
    .block { display: block; }
    .invite { flex-wrap: wrap; }
    .buttons { display: flex; gap: 6px; }
    .thumb { width: 48px; flex: none; }
    .plain { color: inherit; text-decoration: none; }
    .note { display: block; margin-top: 4px; font-family: var(--serif); font-style: italic; }
    .unseen strong { color: var(--olive-700); }
    .edit { flex-wrap: wrap; align-items: flex-start; }
    .cover-diff { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .arrow { transform: rotate(180deg); color: var(--muted); }
    .diff { margin: 8px 0 0; display: grid; gap: 4px; }
    .diff div { display: flex; gap: 6px; flex-wrap: wrap; }
    .diff dt { color: var(--muted); }
    .diff dt::after { content: ':'; }
    .diff dd { margin: 0; }
    .ai-reason { margin-top: 6px; }
  `,
})
export class NotificationsPage implements OnDestroy {
  protected social = inject(SocialService);
  protected edits = inject(EditsService);
  protected readonly authorsLabel = authorsLabel;
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnDestroy() {
    // Ao sair da tela, as indicações exibidas passam a contar como vistas.
    void this.social.markRecommendationsSeen();
  }

  /** Campos alterados pela sugestão (exceto a capa, mostrada à parte), com o valor antigo e o novo. */
  protected changedFields(edit: BookEdit): { label: string; before: string; after: string }[] {
    return (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[])
      .filter((key) => key in edit.changes)
      .map((key) => ({
        label: FIELD_LABELS[key],
        before: fieldText(edit.before[key]),
        after: fieldText(edit.changes[key]),
      }));
  }

  protected async review(edit: BookEdit, approve: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.edits.review(edit, approve);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async revert(edit: BookEdit) {
    if (!confirm(`Desfazer a edição de "${edit.bookTitle}"? Os campos voltam ao valor anterior.`)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.edits.revert(edit);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async respond(invite: Invite, accept: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.social.respondInvite(invite, accept);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
