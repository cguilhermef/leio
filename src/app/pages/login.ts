import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/firebase';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="login">
      <h1>Leio</h1>
      <p class="tagline">Anote os livros que você lê, acompanhe suas páginas e cumpra sua meta do ano.</p>
      <button type="button" class="btn block" (click)="signIn()" [disabled]="busy()">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        Entrar com Google
      </button>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </section>
  `,
  styles: `
    .login {
      max-width: 360px; min-height: 100dvh; margin: 0 auto; padding: 24px;
      display: flex; flex-direction: column; justify-content: center; gap: 20px; text-align: center;
    }
    h1 { font-size: 3rem; }
    .tagline { color: var(--muted); margin-bottom: 12px; }
    .btn svg { background: #fff; border-radius: 50%; padding: 2px; box-sizing: content-box; }
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  protected busy = signal(false);
  protected error = signal('');

  async signIn() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signIn();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
