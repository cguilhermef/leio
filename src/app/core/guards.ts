import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService, AuthState } from './auth.service';

function whenSettled(allow: (state: AuthState) => true | string): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return toObservable(auth.state).pipe(
      filter((state) => state !== 'loading'),
      take(1),
      map((state) => {
        const result = allow(state);
        return result === true ? true : router.parseUrl(result);
      }),
    );
  };
}

export const readyGuard = whenSettled((state) =>
  state === 'ready' ? true : state === 'signedOut' ? '/entrar' : '/acesso',
);

export const signedOutGuard = whenSettled((state) =>
  state === 'signedOut' ? true : state === 'ready' ? '/' : '/acesso',
);

export const accessGuard = whenSettled((state) =>
  state === 'blocked' || state === 'error' ? true : state === 'ready' ? '/' : '/entrar',
);
