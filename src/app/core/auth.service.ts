import { Injectable, computed, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { auth, callFunction } from './firebase';

export type AuthState = 'loading' | 'signedOut' | 'blocked' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);
  readonly state = signal<AuthState>('loading');
  readonly uid = computed(() => this.user()?.uid ?? '');
  /** Custom claim `role` (por exemplo, 'editor'), definido pelo script `npm run editor`. */
  readonly role = signal('');

  constructor() {
    onAuthStateChanged(auth, (user) => void this.handleUser(user));
  }

  private async handleUser(user: User | null) {
    this.role.set('');
    if (!user) {
      this.user.set(null);
      this.state.set('signedOut');
      return;
    }
    this.state.set('loading');
    try {
      const token = await user.getIdTokenResult();
      this.role.set(String(token.claims['role'] ?? ''));
      if (!token.claims['allowed']) {
        const { allowed } = await callFunction<object, { allowed: boolean }>('registerUser', {});
        if (!allowed) {
          this.user.set(user);
          this.state.set('blocked');
          return;
        }
        await user.getIdToken(true);
      }
      this.user.set(user);
      this.state.set('ready');
      void this.refreshRole(user);
    } catch (error) {
      console.error(error);
      this.user.set(user);
      this.state.set('error');
    }
  }

  /**
   * O token em cache pode ser anterior a uma mudança de papel. Renova em segundo plano para que
   * o papel novo valha já na próxima abertura do app (offline, mantém o papel do token atual).
   */
  private async refreshRole(user: User) {
    try {
      const token = await user.getIdTokenResult(true);
      if (this.user() === user) this.role.set(String(token.claims['role'] ?? ''));
    } catch {
      // sem conexão
    }
  }

  async signIn(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw error;
    }
  }

  retry(): void {
    void this.handleUser(auth.currentUser);
  }

  signOut(): Promise<void> {
    return signOut(auth);
  }
}
