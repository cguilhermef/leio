import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * Mantém o PWA atualizado. Sem isso, o service worker continua servindo a versão antiga em
 * cache, que pode não ser compatível com as Cloud Functions recém-publicadas.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private sw = inject(SwUpdate);

  /** Há uma nova versão baixada, pronta para ser ativada. */
  readonly ready = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe(() => this.ready.set(true));
    // Versão em cache corrompida ou removida do servidor: recarregar é a única saída.
    this.sw.unrecoverable.subscribe(() => location.reload());
    // Procura atualizações ao abrir e sempre que o app volta para o primeiro plano.
    void this.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
  }

  private async check() {
    try {
      await this.sw.checkForUpdate();
    } catch {
      // Sem conexão: tentaremos de novo na próxima vez que o app ficar visível.
    }
  }

  async apply() {
    await this.sw.activateUpdate();
    location.reload();
  }
}
