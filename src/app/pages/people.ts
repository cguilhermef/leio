import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/firebase';
import { Invite, UserProfile } from '../core/models';
import { SocialService } from '../core/social.service';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-people',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <div class="page">
      <div class="page-head"><h1>Pessoas</h1></div>

      <form class="card" (ngSubmit)="invite()">
        <label class="field">
          <span>Compartilhar meu perfil com</span>
          <input class="input" type="email" name="email" placeholder="email@exemplo.com"
            autocomplete="email" [(ngModel)]="email" required />
        </label>
        <p class="muted small">
          A pessoa recebe um convite no Leio. Quando aceitar, vocês passam a ver os livros um do outro
          e podem trocar indicações.
        </p>
        <div class="actions">
          <button type="submit" class="btn" [disabled]="busy() || !email()">Enviar convite</button>
        </div>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        @if (message()) {
          <p class="muted">{{ message() }}</p>
        }
      </form>

      @if (social.receivedInvites().length) {
        <section class="section">
          <div class="section-head"><h2>Convites recebidos</h2></div>
          <a routerLink="/notificacoes">Responder convites ({{ social.receivedInvites().length }})</a>
        </section>
      }

      <section class="section">
        <div class="section-head"><h2>Conexões</h2></div>
        @if (social.connections().length) {
          <ul class="list-plain">
            @for (person of social.connections(); track person.uid) {
              <li>
                @if (person.photoURL) {
                  <img class="avatar" [src]="person.photoURL" alt="" referrerpolicy="no-referrer" />
                } @else {
                  <span class="avatar"></span>
                }
                <a class="grow plain" [routerLink]="['/pessoas', person.uid]">
                  <strong>{{ person.name }}</strong><br />
                  <span class="muted small">{{ person.email }}</span>
                </a>
                <button type="button" class="icon-btn" title="Remover conexão" aria-label="Remover conexão"
                  (click)="remove(person)" [disabled]="busy()">
                  <app-icon name="close" [size]="18" />
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Você ainda não tem conexões. Convide alguém pelo email.</p>
        }
      </section>

      @if (social.sentInvites().length) {
        <section class="section">
          <div class="section-head"><h2>Convites enviados</h2></div>
          <ul class="list-plain">
            @for (inv of social.sentInvites(); track inv.id) {
              <li>
                <span class="grow">{{ inv.toEmail }}<br /><span class="muted small">Aguardando resposta</span></span>
                <button type="button" class="btn small secondary" (click)="cancel(inv)" [disabled]="busy()">Cancelar</button>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `.plain { color: inherit; text-decoration: none; }`,
})
export class PeoplePage {
  protected social = inject(SocialService);
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');

  private async run(action: () => Promise<unknown>, success = '') {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
      this.message.set(success);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async invite() {
    const email = this.email();
    await this.run(() => this.social.invite(email), `Convite enviado para ${email}.`);
    if (!this.error()) this.email.set('');
  }

  protected cancel(invite: Invite) {
    void this.run(() => this.social.cancelInvite(invite));
  }

  protected remove(person: UserProfile) {
    if (!confirm(`Remover a conexão com ${person.name}? Vocês deixarão de ver os livros um do outro.`)) return;
    void this.run(() => this.social.removeConnection(person.uid));
  }
}
