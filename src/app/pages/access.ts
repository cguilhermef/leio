import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-access',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="access">
      <h1>Leio</h1>
      @if (auth.state() === 'blocked') {
        <h2>Vagas esgotadas</h2>
        <p class="muted">
          O Leio está aberto, por enquanto, para um número limitado de pessoas e todas as vagas
          foram preenchidas. Tente novamente mais tarde.
        </p>
      } @else {
        <h2>Não foi possível entrar</h2>
        <p class="muted">Verifique sua conexão e tente novamente.</p>
        <button type="button" class="btn" (click)="auth.retry()">Tentar novamente</button>
      }
      <button type="button" class="btn secondary" (click)="auth.signOut()">Usar outra conta</button>
    </section>
  `,
  styles: `
    .access {
      max-width: 380px; min-height: 100dvh; margin: 0 auto; padding: 24px;
      display: flex; flex-direction: column; justify-content: center; gap: 16px; text-align: center;
    }
    h1 { font-size: 2.4rem; margin-bottom: 12px; }
  `,
})
export class AccessPage {
  protected auth = inject(AuthService);
}
