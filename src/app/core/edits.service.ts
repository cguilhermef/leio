import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { callFunction, db } from './firebase';
import { BookEdit } from './models';

/** Papel de editor do catálogo, sugestões pendentes e edições aplicadas pela moderação automática. */
@Injectable({ providedIn: 'root' })
export class EditsService {
  private auth = inject(AuthService);

  /** Editores têm o custom claim `role: 'editor'`. */
  readonly isEditor = computed(() => this.auth.state() === 'ready' && this.auth.role() === 'editor');
  /** Sugestões aguardando revisão (só carregadas para editores). */
  readonly pending = signal<BookEdit[]>([]);
  /** Últimas edições aplicadas pela moderação automática, que o editor pode desfazer (RN-11). */
  readonly autoApplied = signal<BookEdit[]>([]);

  constructor() {
    effect((onCleanup) => {
      this.pending.set([]);
      this.autoApplied.set([]);
      if (!this.isEditor()) return;
      const toEdits = (docs: { id: string; data: () => unknown }[]) =>
        docs.map((d) => ({ ...(d.data() as BookEdit), id: d.id }));
      const unsubs = [
        onSnapshot(
          query(
            collection(db, 'bookEdits'),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc'),
            limit(50),
          ),
          (snap) => this.pending.set(toEdits(snap.docs)),
          (error) => console.error('Sugestões de edição', error),
        ),
        onSnapshot(
          query(
            collection(db, 'bookEdits'),
            where('status', '==', 'approved'),
            where('reviewedBy', '==', 'ai'),
            orderBy('createdAt', 'desc'),
            limit(20),
          ),
          (snap) => this.autoApplied.set(toEdits(snap.docs)),
          (error) => console.error('Edições automáticas', error),
        ),
      ];
      onCleanup(() => unsubs.forEach((u) => u()));
    });
  }

  review(edit: BookEdit, approve: boolean): Promise<unknown> {
    return callFunction('reviewBookEdit', { editId: edit.id, approve });
  }

  revert(edit: BookEdit): Promise<unknown> {
    return callFunction('revertBookEdit', { editId: edit.id });
  }
}
