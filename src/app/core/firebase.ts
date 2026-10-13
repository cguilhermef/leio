import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { environment } from '../../environments/environment';

export const firebaseApp = initializeApp(environment.firebase);
export const auth = getAuth(firebaseApp);
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, environment.functionsRegion);

export async function callFunction<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await httpsCallable<Req, Res>(functions, name)(data);
  return result.data;
}

/** Converte erros do Firebase em mensagens legíveis. */
export function errorMessage(error: unknown): string {
  const err = error as { code?: string; message?: string };
  switch (err?.code) {
    case 'functions/resource-exhausted':
      return err.message || 'Limite de uso atingido. Tente novamente mais tarde.';
    case 'functions/unavailable':
    case 'unavailable':
      return 'Sem conexão. Verifique sua internet e tente novamente.';
    case 'permission-denied':
    case 'functions/permission-denied':
      return 'Você não tem permissão para esta ação.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    default:
      return err?.message || 'Algo deu errado. Tente novamente.';
  }
}
