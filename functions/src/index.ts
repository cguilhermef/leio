import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import OpenAI from 'openai';

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5 });

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const OPENAI_MODEL = defineString('OPENAI_MODEL', { default: 'gpt-5-mini' });
const MAX_USERS = defineInt('MAX_USERS', { default: 50 });
const AI_DAILY_LIMIT = defineInt('AI_DAILY_LIMIT', { default: 40 });

const MAX_IMAGE_LENGTH = 6_000_000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function normalize(text: string | undefined | null): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function requireUser(request: CallableRequest): { uid: string; email: string } {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  return { uid: request.auth.uid, email: String(request.auth.token.email ?? '').toLowerCase() };
}

function requireAllowed(request: CallableRequest): { uid: string; email: string } {
  const user = requireUser(request);
  if (request.auth?.token['allowed'] !== true) {
    throw new HttpsError('permission-denied', 'Acesso não liberado.');
  }
  return user;
}

function requireImage(data: unknown): string {
  const image = (data as { image?: unknown })?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    throw new HttpsError('invalid-argument', 'Envie uma imagem válida.');
  }
  if (image.length > MAX_IMAGE_LENGTH) {
    throw new HttpsError('invalid-argument', 'A imagem é muito grande.');
  }
  return image;
}

/** Limita o uso diário da OpenAI por usuário, para controlar custos. */
async function consumeAiQuota(uid: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiUsage/${uid}_${day}`);
  const limit = AI_DAILY_LIMIT.value();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get('count') as number | undefined) ?? 0;
    if (count >= limit) {
      throw new HttpsError(
        'resource-exhausted',
        'Você atingiu o limite diário de leituras de fotos. Tente amanhã ou preencha manualmente.',
      );
    }
    tx.set(ref, { uid, day, count: count + 1 }, { merge: true });
  });
}

async function extractFromImage<T>(
  image: string,
  instructions: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
  try {
    const response = await client.responses.create({
      model: OPENAI_MODEL.value(),
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: instructions },
            { type: 'input_image', image_url: image, detail: 'high' },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
    });
    return JSON.parse(response.output_text) as T;
  } catch (error) {
    console.error('OpenAI error', error);
    throw new HttpsError('unavailable', 'Não foi possível ler a imagem agora. Tente novamente.');
  }
}

interface BookDoc {
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  year?: number | null;
  isbn?: string;
  pages: number;
  coverUrl?: string;
  titleKey: string;
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((t) => t.length > 1));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => b.has(t) && shared++);
  return shared / Math.max(a.size, b.size);
}

/** Procura no catálogo livros com título (e, se houver, autor) parecidos. */
async function findSimilarBooks(title: string, authors: string[]) {
  const key = normalize(title);
  if (!key) return [];
  const prefix = key.split(' ').slice(0, 2).join(' ');
  const snap = await db
    .collection('books')
    .where('titleKey', '>=', prefix)
    .where('titleKey', '<', prefix + '')
    .limit(40)
    .get();

  const titleTokens = tokens(title);
  const authorTokens = tokens(authors.join(' '));
  return snap.docs
    .map((doc) => {
      const book = doc.data() as BookDoc;
      const titleScore = book.titleKey === key ? 1 : overlap(titleTokens, tokens(book.title));
      const authorScore = authorTokens.size ? overlap(authorTokens, tokens(book.authors.join(' '))) : 0.5;
      return { book: { ...book, id: doc.id }, score: titleScore * 0.75 + authorScore * 0.25 };
    })
    .filter((m) => m.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((m) => m.book);
}

// ---------------------------------------------------------------------------
// Cadastro e limite de usuários
// ---------------------------------------------------------------------------

/**
 * Chamado no primeiro login. Cria o perfil e libera o acesso enquanto houver vagas
 * (MAX_USERS). A liberação fica registrada como custom claim `allowed`.
 */
export const registerUser = onCall(async (request) => {
  const { uid, email } = requireUser(request);
  const userRef = db.doc(`users/${uid}`);
  const limitRef = db.doc('meta/limits');
  const authUser = await getAuth().getUser(uid);

  const allowed = await db.runTransaction(async (tx) => {
    const [userSnap, limitSnap] = await Promise.all([tx.get(userRef), tx.get(limitRef)]);
    if (userSnap.exists) return true;
    const count = (limitSnap.get('count') as number | undefined) ?? 0;
    if (count >= MAX_USERS.value()) return false;
    tx.set(userRef, {
      uid,
      name: authUser.displayName ?? email,
      email,
      photoURL: authUser.photoURL ?? '',
      connections: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(limitRef, { count: count + 1 }, { merge: true });
    return true;
  });

  if (allowed) {
    await getAuth().setCustomUserClaims(uid, { ...(authUser.customClaims ?? {}), allowed: true });
  }
  return { allowed };
});

// ---------------------------------------------------------------------------
// Reconhecimento de capa e ficha catalográfica
// ---------------------------------------------------------------------------

const COVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isBookCover', 'title', 'subtitle', 'authors'],
  properties: {
    isBookCover: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
  },
};

const COVER_PROMPT = `Esta é a foto da capa de um livro. Identifique o título, o subtítulo (se houver)
e os autores exatamente como aparecem na capa, com acentuação correta e capitalização normal
(não tudo em maiúsculas). Ignore selos, frases promocionais, nomes de editora e de tradutores.
Escreva os nomes dos autores na ordem natural (Nome Sobrenome). Se a imagem não for a capa de um
livro, retorne isBookCover = false e campos vazios.`;

export const identifyCover = onCall({ secrets: [OPENAI_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const { uid } = requireAllowed(request);
  const image = requireImage(request.data);
  await consumeAiQuota(uid);

  const result = await extractFromImage<{
    isBookCover: boolean;
    title: string;
    subtitle: string;
    authors: string[];
  }>(image, COVER_PROMPT, 'book_cover', COVER_SCHEMA);

  if (!result.isBookCover || !result.title.trim()) {
    throw new HttpsError(
      'invalid-argument',
      'Não conseguimos identificar um livro nesta foto. Tente outra foto ou preencha manualmente.',
    );
  }
  const matches = await findSimilarBooks(result.title, result.authors);
  return { title: result.title, subtitle: result.subtitle, authors: result.authors, matches };
});

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isCatalogCard', 'title', 'subtitle', 'authors', 'publisher', 'year', 'isbn', 'pages', 'edition'],
  properties: {
    isCatalogCard: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    publisher: { type: 'string' },
    year: { type: ['integer', 'null'] },
    isbn: { type: 'string' },
    pages: { type: ['integer', 'null'] },
    edition: { type: 'string' },
  },
};

const CARD_PROMPT = `Esta é a foto da ficha catalográfica (dados de catalogação na publicação, CIP)
de um livro, normalmente no verso da folha de rosto. Extraia:
- title e subtitle: título principal e subtítulo (o subtítulo vem após ":" no título).
- authors: autores, na ordem natural "Nome Sobrenome" (a ficha costuma trazer "Sobrenome, Nome").
  Não inclua tradutores, ilustradores ou organizadores, a menos que não haja autor.
- publisher: editora. year: ano de publicação desta edição.
- isbn: prefira o ISBN-13, apenas dígitos (e X, se houver).
- pages: número de páginas (por exemplo "320 p." vira 320).
- edition: edição, como "2. ed.", se houver.
Use string vazia ou null quando a informação não existir. Se a imagem não for uma ficha
catalográfica, retorne isCatalogCard = false.`;

export const readCatalogCard = onCall({ secrets: [OPENAI_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const { uid } = requireAllowed(request);
  const image = requireImage(request.data);
  await consumeAiQuota(uid);

  const result = await extractFromImage<{
    isCatalogCard: boolean;
    title: string;
    subtitle: string;
    authors: string[];
    publisher: string;
    year: number | null;
    isbn: string;
    pages: number | null;
    edition: string;
  }>(image, CARD_PROMPT, 'catalog_card', CARD_SCHEMA);

  if (!result.isCatalogCard) {
    throw new HttpsError(
      'invalid-argument',
      'Não encontramos uma ficha catalográfica nesta foto. Tente novamente ou preencha manualmente.',
    );
  }

  const isbn = result.isbn.replace(/[^0-9Xx]/g, '').toUpperCase();
  let match: (BookDoc & { id: string }) | null = null;
  if (isbn) {
    const snap = await db.collection('books').where('isbn', '==', isbn).limit(1).get();
    if (!snap.empty) match = { ...(snap.docs[0].data() as BookDoc), id: snap.docs[0].id };
  }

  const { isCatalogCard: _ignored, ...draft } = result;
  return { draft: { ...draft, isbn, pages: draft.pages ?? 0 }, match };
});

// ---------------------------------------------------------------------------
// Conexões entre perfis
// ---------------------------------------------------------------------------

/** Aceita ou recusa um convite. Ao aceitar, os dois perfis passam a se seguir. */
export const respondInvite = onCall(async (request) => {
  const { uid, email } = requireAllowed(request);
  const { inviteId, accept } = (request.data ?? {}) as { inviteId?: string; accept?: boolean };
  if (!inviteId) throw new HttpsError('invalid-argument', 'Convite inválido.');

  const inviteRef = db.doc(`invites/${inviteId}`);
  await db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    if (!invite.exists || invite.get('toEmail') !== email) {
      throw new HttpsError('not-found', 'Convite não encontrado.');
    }
    if (invite.get('status') !== 'pending') return;
    const fromUid = invite.get('fromUid') as string;

    tx.update(inviteRef, {
      status: accept ? 'accepted' : 'declined',
      toUid: uid,
      respondedAt: FieldValue.serverTimestamp(),
    });
    if (accept && fromUid !== uid) {
      tx.update(db.doc(`users/${uid}`), { connections: FieldValue.arrayUnion(fromUid) });
      tx.update(db.doc(`users/${fromUid}`), { connections: FieldValue.arrayUnion(uid) });
    }
  });
  return { ok: true };
});

export const removeConnection = onCall(async (request) => {
  const { uid } = requireAllowed(request);
  const other = (request.data as { uid?: string })?.uid;
  if (!other) throw new HttpsError('invalid-argument', 'Perfil inválido.');
  const batch = db.batch();
  batch.update(db.doc(`users/${uid}`), { connections: FieldValue.arrayRemove(other) });
  batch.update(db.doc(`users/${other}`), { connections: FieldValue.arrayRemove(uid) });
  await batch.commit();
  return { ok: true };
});
