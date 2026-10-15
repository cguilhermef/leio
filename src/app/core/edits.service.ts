import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { callFunction, db } from './firebase';
import { BookEdit } from './models';

/** Papel de editor do catálogo e sugestões de edição pendentes de revisão. */
@Injectable({ providedIn: 'root' })
export class EditsService {
  private auth = inject(AuthService);

  /** Editores têm o custom claim `role: 'editor'`. */
  readonly isEditor = computed(() => this.auth.state() === 'ready' && this.auth.role() === 'editor');
  /** Sugestões aguardando revisão (só carregadas para editores). */
  readonly pending = signal<BookEdit[]>([]);

  constructor() {
    effect((onCleanup) => {
      this.pending.set([]);
      if (!this.isEditor()) return;
      const unsub = onSnapshot(
        query(
          collection(db, 'bookEdits'),
          where('status', '==', 'pending'),
          orderBy('createdAt', 'desc'),
          limit(50),
        ),
        (snap) => this.pending.set(snap.docs.map((d) => ({ ...(d.data() as BookEdit), id: d.id }))),
        (error) => console.error('Sugestões de edição', error),
      );
      onCleanup(unsub);
    });
  }

  review(edit: BookEdit, approve: boolean): Promise<unknown> {
    return callFunction('reviewBookEdit', { editId: edit.id, approve });
  }
}
