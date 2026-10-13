import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { EditsService } from './core/edits.service';
import { SocialService } from './core/social.service';
import { UpdateService } from './core/update.service';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected auth = inject(AuthService);
  protected social = inject(SocialService);
  protected updates = inject(UpdateService);
  private edits = inject(EditsService);
  private router = inject(Router);

  /** Convites e indicações não vistos, mais sugestões de edição aguardando um editor. */
  protected readonly badge = computed(() => this.social.unseenCount() + this.edits.pending().length);

  protected readonly nav = [
    { path: '/', icon: 'home', label: 'Início', exact: true },
    { path: '/livros', icon: 'books', label: 'Livros', exact: false },
    { path: '/adicionar', icon: 'plus', label: 'Adicionar', exact: false },
    { path: '/meta', icon: 'target', label: 'Meta', exact: false },
    { path: '/pessoas', icon: 'users', label: 'Pessoas', exact: false },
  ];

  constructor() {
    // Redireciona quando o estado de autenticação muda depois da navegação inicial.
    effect(() => {
      const state = this.auth.state();
      const url = this.router.url;
      if (state === 'signedOut' && !url.startsWith('/entrar')) {
        void this.router.navigateByUrl('/entrar');
      } else if (state === 'ready' && (url.startsWith('/entrar') || url.startsWith('/acesso'))) {
        void this.router.navigateByUrl('/');
      } else if ((state === 'blocked' || state === 'error') && !url.startsWith('/acesso')) {
        void this.router.navigateByUrl('/acesso');
      }
    });
  }
}
