import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import OpenAI from 'openai';
import { rankEditions } from './ranking';

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5 });

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
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

const COVER_PROMPT = `Esta é a foto da capa de um livro, impressa ou na tela de um leitor digital como
o Kindle (possivelmente em preto e branco). Identifique o título, o subtítulo (se houver)
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
  return { title: result.title, subtitle: result.subtitle, authors: result.authors };
});

// ---------------------------------------------------------------------------
// Busca do livro: catálogo do Leio e capas online (Google Books, Open Library)
// ---------------------------------------------------------------------------

/** Edição encontrada online, com capa e dados para pré-preencher o cadastro. */
interface OnlineEdition {
  source: 'google' | 'openlibrary';
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  year: number | null;
  isbn: string;
  pages: number;
  coverUrl: string;
}

const COVER_HOSTS = ['books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org'];
const MAX_COVER_BYTES = 3 * 1024 * 1024;

function yearFrom(value: unknown): number | null {
  const match = String(value ?? '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).host}`);
  return response.json();
}

/**
 * Busca no Google Books em etapas, da consulta mais precisa para a mais ampla, até reunir
 * edições suficientes. Os filtros intitle/inauthor usam aspas: sem elas, o Google aplica o
 * filtro só à primeira palavra (em "O portador do fogo", apenas a "O").
 */
async function searchGoogleBooks(title: string, authors: string[]): Promise<OnlineEdition[]> {
  const clean = (text: string) => text.replace(/"/g, '').trim();
  const t = clean(title);
  const a = authors[0] ? clean(authors[0]) : '';
  const queries = [
    a ? `intitle:"${t}" inauthor:"${a}"` : `intitle:"${t}"`,
    a ? `"${t}" ${a}` : `"${t}"`,
    a ? `${t} ${a}` : t,
  ];

  const found: OnlineEdition[] = [];
  const seen = new Set<string>();
  let failures = 0;
  for (const q of queries) {
    try {
      // Descarta resultados de outros livros/autores que as consultas mais amplas trazem.
      for (const edition of rankEditions(await googleBooksQuery(q), title, authors)) {
        if (!seen.has(edition.coverUrl)) {
          seen.add(edition.coverUrl);
          found.push(edition);
        }
      }
    } catch (error) {
      failures++;
      console.warn('Google Books', q, error);
    }
    if (found.length >= 6) break;
  }
  if (failures === queries.length) throw new Error('Google Books indisponível');
  if (!found.length) console.info('Google Books sem resultados', { title, authors });
  return found;
}

async function googleBooksQuery(q: string): Promise<OnlineEdition[]> {
  const params = new URLSearchParams({
    q,
    maxResults: '20',
    printType: 'books',
    key: GOOGLE_BOOKS_API_KEY.value(),
  });
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
  return ((data.items ?? []) as any[])
    .map((item): OnlineEdition | null => {
      const info = item.volumeInfo ?? {};
      const links = info.imageLinks ?? {};
      const image: string | undefined = links.large ?? links.medium ?? links.small ?? links.thumbnail;
      if (!image) return null;
      const ids = (info.industryIdentifiers ?? []) as { type: string; identifier: string }[];
      const isbn = ids.find((i) => i.type === 'ISBN_13') ?? ids.find((i) => i.type === 'ISBN_10');
      return {
        source: 'google',
        title: info.title ?? '',
        subtitle: info.subtitle ?? '',
        authors: info.authors ?? [],
        publisher: info.publisher ?? '',
        year: yearFrom(info.publishedDate),
        isbn: isbn?.identifier ?? '',
        pages: info.pageCount ?? 0,
        coverUrl: image.replace(/^http:/, 'https:').replace('&edge=curl', ''),
      };
    })
    .filter((e): e is OnlineEdition => e !== null);
}

async function searchOpenLibrary(title: string, authors: string[]): Promise<OnlineEdition[]> {
  const params = new URLSearchParams({
    title,
    limit: '10',
    fields: 'title,subtitle,author_name,publisher,first_publish_year,isbn,number_of_pages_median,cover_i',
  });
  if (authors[0]) params.set('author', authors[0]);
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  return ((data.docs ?? []) as any[])
    .filter((doc) => doc.cover_i)
    .map((doc) => ({
      source: 'openlibrary' as const,
      title: doc.title ?? '',
      subtitle: doc.subtitle ?? '',
      authors: doc.author_name ?? [],
      publisher: doc.publisher?.[0] ?? '',
      year: doc.first_publish_year ?? null,
      isbn: (doc.isbn ?? []).find((i: string) => i.length === 13) ?? doc.isbn?.[0] ?? '',
      pages: doc.number_of_pages_median ?? 0,
      coverUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
    }));
}

/**
 * Procura o livro confirmado pelo usuário: primeiro no catálogo do Leio e depois em
 * catálogos online, para oferecer capas coloridas e dados da edição.
 */
export const searchBook = onCall({ secrets: [GOOGLE_BOOKS_API_KEY] }, async (request) => {
  requireAllowed(request);
  const { title, authors } = (request.data ?? {}) as { title?: string; authors?: string[] };
  const cleanTitle = String(title ?? '').trim().slice(0, 200);
  const cleanAuthors = (Array.isArray(authors) ? authors : []).map((a) => String(a).trim()).filter(Boolean);
  if (!cleanTitle) throw new HttpsError('invalid-argument', 'Informe o título do livro.');

  let failedSources = 0;
  const [matches, google, openLibrary] = await Promise.all([
    findSimilarBooks(cleanTitle, cleanAuthors),
    searchGoogleBooks(cleanTitle, cleanAuthors).catch((error) => {
      failedSources++;
      console.warn('Google Books', error);
      return [] as OnlineEdition[];
    }),
    searchOpenLibrary(cleanTitle, cleanAuthors).catch((error) => {
      failedSources++;
      console.warn('Open Library', error);
      return [] as OnlineEdition[];
    }),
  ]);
  // Avisa o app quando a busca online falhou (e não apenas veio vazia), para sugerir nova tentativa.
  const onlineFailed = failedSources === 2;

  // Mais relevantes primeiro; no empate, Google Books (melhor para edições brasileiras).
  const seen = new Set<string>();
  const editions = rankEditions([...google, ...openLibrary], cleanTitle, cleanAuthors)
    .filter((e) => !seen.has(e.coverUrl) && seen.add(e.coverUrl))
    .slice(0, 12);
  return { matches, editions, onlineFailed };
});

/** Baixa uma capa de um catálogo online permitido e devolve como data URL. */
export const fetchCover = onCall(async (request) => {
  requireAllowed(request);
  const url = String((request.data as { url?: string })?.url ?? '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpsError('invalid-argument', 'Endereço de capa inválido.');
  }
  if (parsed.protocol !== 'https:' || !COVER_HOSTS.includes(parsed.hostname)) {
    throw new HttpsError('invalid-argument', 'Endereço de capa não permitido.');
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(10_000) });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) {
    throw new HttpsError('unavailable', 'Não foi possível baixar a capa.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) throw new HttpsError('invalid-argument', 'A capa é muito grande.');
  return { image: `data:${type.split(';')[0]};base64,${bytes.toString('base64')}` };
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
