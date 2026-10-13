import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  limit,
} from 'firebase/firestore';
import { AuthService } from './auth.service';
import { callFunction, db } from './firebase';
import { Invite, Recommendation, ShelfEntry, UserProfile } from './models';

@Injectable({ providedIn: 'root' })
export class SocialService {
  private auth = inject(AuthService);

  readonly profile = signal<UserProfile | null>(null);
  readonly connections = signal<UserProfile[]>([]);
  readonly receivedInvites = signal<Invite[]>([]);
  readonly sentInvites = signal<Invite[]>([]);
  readonly recommendations = signal<Recommendation[]>([]);

  readonly unseenCount = computed(
    () => this.receivedInvites().length + this.recommendations().filter((r) => !r.seen).length,
  );

  constructor() {
    effect((onCleanup) => {
      const user = this.auth.state() === 'ready' ? this.auth.user() : null;
      this.profile.set(null);
      this.connections.set([]);
      this.receivedInvites.set([]);
      this.sentInvites.set([]);
      this.recommendations.set([]);
      if (!user) return;
      const email = (user.email ?? '').toLowerCase();

      const unsubs = [
        onSnapshot(doc(db, 'users', user.uid), (snap) => {
          const profile = snap.exists() ? (snap.data() as UserProfile) : null;
          this.profile.set(profile);
          void this.loadConnections(profile?.connections ?? []);
        }),
        onSnapshot(
          query(
            collection(db, 'invites'),
            where('toEmail', '==', email),
            where('status', '==', 'pending'),
          ),
          (snap) => this.receivedInvites.set(snap.docs.map((d) => ({ ...(d.data() as Invite), id: d.id }))),
        ),
        onSnapshot(
          query(
            collection(db, 'invites'),
            where('fromUid', '==', user.uid),
            where('status', '==', 'pending'),
          ),
          (snap) => this.sentInvites.set(snap.docs.map((d) => ({ ...(d.data() as Invite), id: d.id }))),
        ),
        onSnapshot(
          query(
            collection(db, 'recommendations'),
            where('toUid', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(50),
          ),
          (snap) =>
            this.recommendations.set(
              snap.docs.map((d) => ({ ...(d.data() as Recommendation), id: d.id })),
            ),
        ),
      ];
      onCleanup(() => unsubs.forEach((u) => u()));
    });
  }

  private async loadConnections(uids: string[]) {
    if (!uids.length) {
      this.connections.set([]);
      return;
    }
    const profiles: UserProfile[] = [];
    for (let i = 0; i < uids.length; i += 30) {
      const chunk = uids.slice(i, i + 30);
      const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)));
      profiles.push(...snap.docs.map((d) => d.data() as UserProfile));
    }
    this.connections.set(profiles.sort((a, b) => a.name.localeCompare(b.name)));
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  async invite(email: string): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    const toEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw new Error('Informe um email válido.');
    }
    if (toEmail === user.email?.toLowerCase()) {
      throw new Error('Você não pode convidar a si mesmo.');
    }
    if (this.connections().some((c) => c.email.toLowerCase() === toEmail)) {
      throw new Error('Vocês já estão conectados.');
    }
    if (this.sentInvites().some((i) => i.toEmail === toEmail)) {
      throw new Error('Já existe um convite pendente para este email.');
    }
    await addDoc(collection(db, 'invites'), {
      fromUid: user.uid,
      fromName: user.displayName ?? user.email,
      fromEmail: user.email,
      fromPhoto: user.photoURL ?? '',
      toEmail,
      status: 'pending',
      createdAt: Date.now(),
    });
  }

  cancelInvite(invite: Invite): Promise<void> {
    return updateDoc(doc(db, 'invites', invite.id), { status: 'declined' });
  }

  respondInvite(invite: Invite, accept: boolean): Promise<unknown> {
    return callFunction('respondInvite', { inviteId: invite.id, accept });
  }

  removeConnection(uid: string): Promise<unknown> {
    return callFunction('removeConnection', { uid });
  }

  async recommend(entry: Pick<ShelfEntry, 'bookId' | 'title' | 'authors' | 'coverUrl'>, toUids: string[], note: string) {
    const user = this.auth.user();
    if (!user || !toUids.length) return;
    const batch = writeBatch(db);
    for (const toUid of toUids) {
      batch.set(doc(collection(db, 'recommendations')), {
        fromUid: user.uid,
        fromName: user.displayName ?? user.email,
        toUid,
        bookId: entry.bookId,
        title: entry.title,
        authors: entry.authors,
        coverUrl: entry.coverUrl ?? '',
        note: note.trim(),
        seen: false,
        createdAt: Date.now(),
      });
    }
    await batch.commit();
  }

  async markRecommendationsSeen(): Promise<void> {
    const unseen = this.recommendations().filter((r) => !r.seen);
    if (!unseen.length) return;
    const batch = writeBatch(db);
    unseen.forEach((r) => batch.update(doc(db, 'recommendations', r.id), { seen: true }));
    await batch.commit();
  }
}
