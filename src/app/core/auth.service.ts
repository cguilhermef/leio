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

  constructor() {
    onAuthStateChanged(auth, (user) => void this.handleUser(user));
  }

  private async handleUser(user: User | null) {
    if (!user) {
      this.user.set(null);
      this.state.set('signedOut');
      return;
    }
    this.state.set('loading');
    try {
      const token = await user.getIdTokenResult();
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
    } catch (error) {
      console.error(error);
      this.user.set(user);
      this.state.set('error');
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
