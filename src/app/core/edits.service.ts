import { Injectable, effect, inject, signal } from '@angular/core';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { callFunction, db } from './firebase';
import { BookEdit } from './models';

/** Papel de editor do catálogo e sugestões de edição pendentes de revisão. */
@Injectable({ providedIn: 'root' })
export class EditsService {
  private auth = inject(AuthService);

  readonly isEditor = signal(false);
  /** Sugestões aguardando revisão (só carregadas para editores). */
  readonly pending = signal<BookEdit[]>([]);

  constructor() {
    effect((onCleanup) => {
      const uid = this.auth.state() === 'ready' ? this.auth.uid() : '';
      this.isEditor.set(false);
      if (!uid) return;
      const unsub = onSnapshot(
        doc(db, 'meta', 'roles'),
        (snap) => this.isEditor.set(((snap.get('editors') as string[] | undefined) ?? []).includes(uid)),
        () => this.isEditor.set(false),
      );
      onCleanup(unsub);
    });

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
