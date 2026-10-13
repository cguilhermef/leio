import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/firebase';
import { Invite } from '../core/models';
import { SocialService } from '../core/social.service';
import { authorsLabel } from '../core/text';
import { BookCover } from '../shared/book-cover';

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BookCover],
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
  `,
})
export class NotificationsPage implements OnDestroy {
  protected social = inject(SocialService);
  protected readonly authorsLabel = authorsLabel;
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnDestroy() {
    // Ao sair da tela, as indicações exibidas passam a contar como vistas.
    void this.social.markRecommendationsSeen();
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
