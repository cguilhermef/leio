import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import OpenAI from 'openai';
import { matchesAuthor, rankEditions, workKey } from './ranking';

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

/** Limita o uso diário da OpenAI por usuário, para controlar custos (RN-08). */
async function consumeAiQuota(
  uid: string,
  message = 'Você atingiu o limite diário de leituras de fotos. Tente amanhã ou preencha manualmente.',
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiUsage/${uid}_${day}`);
  const limit = AI_DAILY_LIMIT.value();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get('count') as number | undefined) ?? 0;
    if (count >= limit) {
      throw new HttpsError('resource-exhausted', message);
    }
    tx.set(ref, { uid, day, count: count + 1 }, { merge: true });
  });
}

/** Pede ao modelo uma resposta em JSON no formato do schema, a partir de texto e de uma imagem opcional. */
async function askModel<T>(
  instructions: string,
  image: { url: string; detail: 'high' | 'low' } | null,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
  const response = await client.responses.create({
    model: OPENAI_MODEL.value(),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: instructions },
          ...(image ? [{ type: 'input_image' as const, image_url: image.url, detail: image.detail }] : []),
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
  });
  return JSON.parse(response.output_text) as T;
}

async function extractFromImage<T>(
  image: string,
  instructions: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<T> {
  try {
    return await askModel<T>(instructions, { url: image, detail: 'high' }, schemaName, schema);
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
  edition?: string;
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

const FETCH_ATTEMPTS = 4;

/**
 * Busca JSON, tentando de novo quando o serviço falha temporariamente (5xx, 429), com espera
 * crescente (0,5 s, 1 s, 2 s). O Google Books devolve 503 em boa parte das chamadas, mas
 * costuma responder em uma das tentativas seguintes.
 */
async function fetchJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) return response.json();
    const transient = response.status >= 500 || response.status === 429;
    if (!transient || attempt === FETCH_ATTEMPTS) throw new Error(`HTTP ${response.status} em ${new URL(url).host}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
}

/**
 * Busca no Google Books em etapas, da consulta mais precisa para a mais ampla, parando na
 * primeira que trouxer edições do livro. Os filtros intitle/inauthor usam aspas: sem elas, o
 * Google aplica o filtro só à primeira palavra (em "O portador do fogo", apenas a "O").
 * Se uma consulta falha mesmo depois das novas tentativas, o Google está fora do ar: as
 * consultas seguintes falhariam também, então desiste logo.
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

  for (const q of queries) {
    let editions: OnlineEdition[];
    try {
      editions = await googleBooksQuery(q);
    } catch (error) {
      console.warn('Google Books', q, error);
      throw new Error('Google Books indisponível');
    }
    // Descarta resultados de outros livros/autores que as consultas mais amplas trazem.
    const found = rankEditions(editions, title, authors);
    if (found.length) return found;
  }
  console.info('Google Books sem resultados', { title, authors });
  return [];
}

/** Consulta o Google Books. Sem `withoutCover`, descarta volumes sem imagem de capa. */
async function googleBooksQuery(
  q: string,
  { maxResults = 20, withoutCover = false } = {},
): Promise<OnlineEdition[]> {
  const params = new URLSearchParams({
    q,
    maxResults: String(maxResults),
    printType: 'books',
    key: GOOGLE_BOOKS_API_KEY.value(),
  });
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
  return ((data.items ?? []) as any[])
    .map((item): OnlineEdition | null => {
      const info = item.volumeInfo ?? {};
      const links = info.imageLinks ?? {};
      const image: string | undefined = links.large ?? links.medium ?? links.small ?? links.thumbnail;
      if (!image && !withoutCover) return null;
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
        coverUrl: image ? image.replace(/^http:/, 'https:').replace('&edge=curl', '') : '',
      };
    })
    .filter((e): e is OnlineEdition => e !== null);
}

const OPEN_LIBRARY_FIELDS =
  'title,subtitle,author_name,publisher,first_publish_year,isbn,number_of_pages_median,cover_i';

function openLibraryEdition(doc: any): OnlineEdition {
  return {
    source: 'openlibrary',
    title: doc.title ?? '',
    subtitle: doc.subtitle ?? '',
    authors: doc.author_name ?? [],
    publisher: doc.publisher?.[0] ?? '',
    year: doc.first_publish_year ?? null,
    isbn: (doc.isbn ?? []).find((i: string) => i.length === 13) ?? doc.isbn?.[0] ?? '',
    pages: doc.number_of_pages_median ?? 0,
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '',
  };
}

async function searchOpenLibrary(title: string, authors: string[]): Promise<OnlineEdition[]> {
  const params = new URLSearchParams({ title, limit: '10', fields: OPEN_LIBRARY_FIELDS });
  if (authors[0]) params.set('author', authors[0]);
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  return ((data.docs ?? []) as any[]).filter((doc) => doc.cover_i).map(openLibraryEdition);
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

  let onlineFailed = false;
  const [matches, google, openLibrary] = await Promise.all([
    findSimilarBooks(cleanTitle, cleanAuthors),
    searchGoogleBooks(cleanTitle, cleanAuthors).catch((error) => {
      onlineFailed = true;
      console.warn('Google Books', error);
      return [] as OnlineEdition[];
    }),
    searchOpenLibrary(cleanTitle, cleanAuthors).catch((error) => {
      console.warn('Open Library', error);
      return [] as OnlineEdition[];
    }),
  ]);
  // Avisa o app quando o Google Books falhou (e não apenas veio vazio), para sugerir nova
  // tentativa. Ele é a fonte principal: a Open Library sozinha costuma trazer capas de outras
  // edições ou nenhuma, então o aviso vale mesmo que ela tenha respondido.

  // Mais relevantes primeiro; no empate, Google Books (melhor para edições brasileiras).
  const seen = new Set<string>();
  const editions = rankEditions([...google, ...openLibrary], cleanTitle, cleanAuthors)
    .filter((e) => !seen.has(e.coverUrl) && seen.add(e.coverUrl))
    .slice(0, 12);
  return { matches, editions, onlineFailed };
});

/** Livros do catálogo do Leio com o autor buscado (o catálogo é pequeno o bastante para varrer). */
async function findBooksByAuthor(author: string) {
  const snap = await db
    .collection('books')
    .select('title', 'subtitle', 'authors', 'publisher', 'year', 'isbn', 'pages', 'coverUrl', 'titleKey')
    .limit(3000)
    .get();
  return snap.docs
    .map((doc) => ({ ...(doc.data() as BookDoc), id: doc.id }))
    .filter((book) => matchesAuthor(book.authors ?? [], author))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    .slice(0, 30);
}

async function searchOpenLibraryByAuthor(author: string): Promise<OnlineEdition[]> {
  const params = new URLSearchParams({ author, sort: 'editions', limit: '40', fields: OPEN_LIBRARY_FIELDS });
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  return ((data.docs ?? []) as any[]).map(openLibraryEdition);
}

/**
 * Lista as obras de um autor: as que já estão no catálogo do Leio e, uma por obra, as
 * encontradas online (preferindo a edição com capa).
 */
export const searchAuthor = onCall({ secrets: [GOOGLE_BOOKS_API_KEY] }, async (request) => {
  requireAllowed(request);
  const author = String((request.data as { author?: string })?.author ?? '').trim().slice(0, 120);
  if (!author) throw new HttpsError('invalid-argument', 'Informe o nome do autor.');

  let failedSources = 0;
  const [matches, google, openLibrary] = await Promise.all([
    findBooksByAuthor(author),
    googleBooksQuery(`inauthor:"${author.replace(/"/g, '')}"`, { maxResults: 40, withoutCover: true }).catch(
      (error) => {
        failedSources++;
        console.warn('Google Books (autor)', error);
        return [] as OnlineEdition[];
      },
    ),
    searchOpenLibraryByAuthor(author).catch((error) => {
      failedSources++;
      console.warn('Open Library (autor)', error);
      return [] as OnlineEdition[];
    }),
  ]);

  const known = new Set(matches.map((book) => workKey(book.title)));
  const works = new Map<string, OnlineEdition>();
  for (const edition of [...google, ...openLibrary]) {
    const key = workKey(edition.title);
    if (!key || known.has(key) || !matchesAuthor(edition.authors, author)) continue;
    const current = works.get(key);
    if (!current || (!current.coverUrl && edition.coverUrl)) works.set(key, edition);
  }
  return { matches, works: [...works.values()].slice(0, 40), onlineFailed: failedSources === 2 };
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
// Edição de livros: editores alteram direto; os demais enviam sugestões para aprovação
// ---------------------------------------------------------------------------

type BookChanges = Partial<
  Pick<BookDoc, 'title' | 'subtitle' | 'authors' | 'publisher' | 'year' | 'isbn' | 'pages' | 'edition' | 'coverUrl'>
>;

const TEXT_FIELDS = ['subtitle', 'publisher', 'edition'] as const;
/**
 * Campos copiados nas estantes e indicações, que precisam acompanhar a edição do livro.
 * As páginas ficam de fora: são da edição que cada leitor tem (RN-07).
 */
const SHELF_FIELDS = ['title', 'authors', 'coverUrl'] as const;
const RECOMMENDATION_FIELDS = ['title', 'authors', 'coverUrl'] as const;

/** Editores têm o custom claim `role: 'editor'`, definido pelo script `npm run editor`. */
function isEditor(request: CallableRequest): boolean {
  return request.auth?.token['role'] === 'editor';
}

function invalid(message: string): never {
  throw new HttpsError('invalid-argument', message);
}

/** Valida e limpa os campos enviados; só os campos presentes são considerados. */
function sanitizeChanges(raw: unknown): BookChanges {
  const data = (raw ?? {}) as Record<string, unknown>;
  const changes: BookChanges = {};
  if ('title' in data) {
    const title = String(data['title'] ?? '').trim();
    if (!title || title.length > 300) invalid('Informe um título válido.');
    changes.title = title;
  }
  for (const key of TEXT_FIELDS) {
    if (key in data) changes[key] = String(data[key] ?? '').trim().slice(0, 300);
  }
  if ('authors' in data) {
    if (!Array.isArray(data['authors'])) invalid('Autores inválidos.');
    changes.authors = (data['authors'] as unknown[])
      .map((a) => String(a).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20);
  }
  if ('year' in data) {
    const year = data['year'] === null || data['year'] === '' ? null : Number(data['year']);
    if (year !== null && (!Number.isInteger(year) || year < 0 || year > 2100)) invalid('Ano inválido.');
    changes.year = year;
  }
  if ('isbn' in data) {
    const isbn = String(data['isbn'] ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
    if (isbn && !validIsbn(isbn)) invalid('ISBN inválido. Confira os dígitos.');
    changes.isbn = isbn;
  }
  if ('pages' in data) {
    const pages = Number(data['pages'] ?? 0);
    if (!Number.isInteger(pages) || pages < 0 || pages >= 20000) invalid('Número de páginas inválido.');
    changes.pages = pages;
  }
  return changes;
}

/** Confere o dígito verificador de um ISBN-10 ou ISBN-13 (já sem hífens). */
function validIsbn(isbn: string): boolean {
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, c, i) => acc + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  return false;
}

/** Endereço público de uma capa enviada pelo app para o Storage (`covers/...`). */
async function uploadedCoverUrl(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !/^covers\/[\w.-]+$/.test(path)) invalid('Capa inválida.');
  const file = getStorage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) invalid('A capa enviada não foi encontrada. Tente novamente.');
  return getDownloadURL(file);
}

async function deleteUploadedCover(path: string | undefined) {
  if (!path) return;
  await getStorage().bucket().file(path).delete({ ignoreNotFound: true }).catch((error) => {
    console.warn('Capa não apagada', path, error);
  });
}

function currentValue(book: BookDoc, key: keyof BookChanges): unknown {
  const value = book[key];
  if (key === 'authors') return value ?? [];
  if (key === 'year') return value ?? null;
  if (key === 'pages') return value ?? 0;
  return value ?? '';
}

/** Mantém só os campos que de fato mudam em relação ao livro atual. */
function changedFields(book: BookDoc, changes: BookChanges): BookChanges {
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (JSON.stringify(value) !== JSON.stringify(currentValue(book, key as keyof BookChanges))) {
      diff[key] = value;
    }
  }
  return diff as BookChanges;
}

function pick<K extends string>(source: Record<string, unknown>, keys: readonly K[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in source).map((k) => [k, source[k]]));
}

/**
 * Aplica a edição no catálogo e nas cópias do livro nas estantes e indicações. Uma nova
 * contagem de páginas só chega às estantes em "Lerei" que ainda têm a contagem anterior do
 * catálogo; as demais guardam a edição que o leitor leu ou ajustou (RN-07).
 */
async function applyBookEdit(bookId: string, changes: BookChanges, uid: string, previous: BookDoc) {
  const update: Record<string, unknown> = { ...changes, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };
  if (changes.title) update['titleKey'] = normalize(changes.title);
  await db.doc(`books/${bookId}`).update(update);

  const shelfFields = pick(changes, SHELF_FIELDS);
  const recommendationFields = pick(changes, RECOMMENDATION_FIELDS);
  const pagesChanged = changes.pages !== undefined;
  if (!Object.keys(shelfFields).length && !pagesChanged) return;
  const [shelves, recommendations] = await Promise.all([
    db.collectionGroup('shelf').where('bookId', '==', bookId).get(),
    Object.keys(recommendationFields).length
      ? db.collection('recommendations').where('bookId', '==', bookId).get()
      : null,
  ]);
  const previousPages = previous.pages ?? 0;
  const writer = db.bulkWriter();
  shelves.docs.forEach((doc) => {
    const fields = { ...shelfFields };
    if (pagesChanged && doc.get('status') === 'toread' && (doc.get('pages') ?? 0) === previousPages) {
      fields['pages'] = changes.pages;
    }
    if (Object.keys(fields).length) void writer.update(doc.ref, fields);
  });
  recommendations?.docs.forEach((doc) => void writer.update(doc.ref, recommendationFields));
  await writer.close();
}

// ---------------------------------------------------------------------------
// Moderação das sugestões de edição (RN-09)
// ---------------------------------------------------------------------------

type EditDecision = { status: 'approved' | 'rejected' | 'pending'; reason: string };

const MODERATION_MODEL = 'omni-moderation-latest';

const TEXT_LABELS: Record<Exclude<keyof BookChanges, 'coverUrl'>, string> = {
  title: 'Título',
  subtitle: 'Subtítulo',
  authors: 'Autores',
  publisher: 'Editora',
  year: 'Ano',
  isbn: 'ISBN',
  pages: 'Páginas',
  edition: 'Edição',
};

function fieldText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

/** Campos de texto alterados, no formato "Campo: antes → depois". */
function describeChanges(book: BookDoc, changes: BookChanges): string {
  return (Object.keys(TEXT_LABELS) as (keyof typeof TEXT_LABELS)[])
    .filter((key) => key in changes)
    .map((key) => `${TEXT_LABELS[key]}: "${fieldText(currentValue(book, key))}" → "${fieldText(changes[key])}"`)
    .join('\n');
}

/**
 * Passa o texto e a capa novos pela moderação da OpenAI. Devolve `null` se a moderação
 * não respondeu, para que a sugestão vá ao editor.
 */
async function isFlagged(text: string, coverUrl: string | undefined): Promise<boolean | null> {
  const input: OpenAI.ModerationMultiModalInput[] = [];
  if (text) input.push({ type: 'text', text });
  if (coverUrl) input.push({ type: 'image_url', image_url: { url: coverUrl } });
  if (!input.length) return false;
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
    const response = await client.moderations.create({ model: MODERATION_MODEL, input });
    return response.results.some((r) => r.flagged);
  } catch (error) {
    console.error('Moderação indisponível', error);
    return null;
  }
}

const EDIT_REVIEW_PROMPT = `Você revisa sugestões de edição de um catálogo colaborativo de livros.
Decida se a alteração pode ser aplicada sem revisão humana.

Aplique (apply = true) só quando a alteração parecer uma correção ou complemento legítimo do mesmo
livro: erro de digitação ou acento, nome de autor completado, subtítulo, editora, ano, edição,
ISBN ou número de páginas plausíveis, ou capa que seja de fato a capa de um livro compatível com o
título e os autores.

Mande para revisão (apply = false) se houver qualquer dúvida: texto sem sentido, piada, propaganda,
links, dados pessoais, troca por outro livro (título ou autores muito diferentes), mudança grande
no número de páginas sem motivo aparente, ou imagem que não seja a capa de um livro ou não combine
com o título.

Em "reason", explique a decisão em uma frase curta, em português, para o editor do catálogo.`;

/** Pede ao modelo para decidir se a sugestão pode ser aplicada direto. `null` se ele não respondeu. */
async function reviewWithAi(book: BookDoc, changes: BookChanges): Promise<{ apply: boolean; reason: string } | null> {
  const context = [
    `Livro atual: "${book.title}", de ${fieldText(book.authors) || 'autor não informado'}.`,
    describeChanges(book, changes) || 'Nenhum campo de texto alterado.',
    changes.coverUrl ? 'A nova capa enviada está na imagem.' : 'A capa não foi alterada.',
  ].join('\n\n');
  try {
    return await askModel<{ apply: boolean; reason: string }>(
      `${EDIT_REVIEW_PROMPT}\n\n${context}`,
      changes.coverUrl ? { url: changes.coverUrl, detail: 'low' } : null,
      'edit_review',
      {
        type: 'object',
        additionalProperties: false,
        properties: { apply: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['apply', 'reason'],
      },
    );
  } catch (error) {
    console.error('Revisão por IA indisponível', error);
    return null;
  }
}

/**
 * Decide o destino de uma sugestão: recusada se a moderação marcar conteúdo impróprio,
 * aplicada se a IA a considerar uma correção legítima, ou pendente para um editor.
 */
async function moderateEdit(book: BookDoc, changes: BookChanges): Promise<EditDecision> {
  const text = (Object.keys(TEXT_LABELS) as (keyof typeof TEXT_LABELS)[])
    .filter((key) => key in changes && key !== 'year' && key !== 'pages')
    .map((key) => fieldText(changes[key]))
    .join('\n');
  const flagged = await isFlagged(text, changes.coverUrl);
  if (flagged) return { status: 'rejected', reason: 'A moderação automática marcou o conteúdo como impróprio.' };
  if (flagged === null) return { status: 'pending', reason: 'A moderação automática não respondeu.' };

  const review = await reviewWithAi(book, changes);
  if (!review) return { status: 'pending', reason: 'A revisão automática não respondeu.' };
  return { status: review.apply ? 'approved' : 'pending', reason: review.reason };
}

/**
 * Modera um livro recém-cadastrado pelo app (RN-10). Capa imprópria é removida; título,
 * autores ou outros textos impróprios fazem o livro ser apagado do catálogo e da estante
 * de quem o cadastrou (até aqui, só ele tem o livro).
 */
export const moderateNewBook = onDocumentCreated(
  { document: 'books/{bookId}', secrets: [OPENAI_API_KEY], timeoutSeconds: 120 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const bookId = snap.id;
    const book = snap.data() as BookDoc & { createdBy?: string };
    const text = [book.title, book.subtitle, fieldText(book.authors), book.publisher, book.edition]
      .filter(Boolean)
      .join('\n');
    const [textFlagged, coverFlagged] = await Promise.all([
      isFlagged(text, undefined),
      book.coverUrl ? isFlagged('', book.coverUrl) : Promise.resolve(false),
    ]);
    if (!textFlagged && !coverFlagged) {
      if (textFlagged === null || coverFlagged === null) console.warn('Livro novo sem moderação', bookId);
      return;
    }

    const owner = book.createdBy ?? '';
    const shelfRef = owner ? db.doc(`users/${owner}/shelf/${bookId}`) : null;
    const action = textFlagged ? 'deleted' : 'coverRemoved';
    if (textFlagged) {
      const logs = owner
        ? await db.collection(`users/${owner}/logs`).where('bookId', '==', bookId).get()
        : null;
      const writer = db.bulkWriter();
      void writer.delete(snap.ref);
      if (shelfRef) void writer.delete(shelfRef);
      logs?.docs.forEach((doc) => void writer.delete(doc.ref));
      await writer.close();
    } else {
      await snap.ref.update({ coverUrl: '' });
      if (shelfRef) await shelfRef.update({ coverUrl: '' }).catch(() => undefined);
    }
    await deleteUploadedCover(`covers/${bookId}.jpg`);
    await db.collection('moderationLog').add({
      bookId,
      title: book.title,
      createdBy: owner,
      action,
      textFlagged: !!textFlagged,
      coverFlagged: !!coverFlagged,
      createdAt: Date.now(),
    });
  },
);

/**
 * Edita um livro do catálogo (RN-06). Para editores, a alteração vale na hora; para os demais,
 * vira uma sugestão que a moderação automática aplica, recusa ou deixa para um editor (RN-09).
 * A nova capa, se houver, é enviada antes pelo app para o Storage e chega aqui como `coverPath`.
 */
export const editBook = onCall({ secrets: [OPENAI_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const { uid } = requireAllowed(request);
  const data = (request.data ?? {}) as { bookId?: string; changes?: unknown; coverPath?: string };
  const bookId = String(data.bookId ?? '');
  if (!bookId) invalid('Livro inválido.');
  const bookSnap = await db.doc(`books/${bookId}`).get();
  if (!bookSnap.exists) throw new HttpsError('not-found', 'Livro não encontrado.');
  const book = bookSnap.data() as BookDoc;

  const changes = sanitizeChanges(data.changes);
  if (data.coverPath) changes.coverUrl = await uploadedCoverUrl(data.coverPath);
  const diff = changedFields(book, changes);
  if (!Object.keys(diff).length) invalid('Nenhum dado foi alterado.');

  if (isEditor(request)) {
    await applyBookEdit(bookId, diff, uid, book);
    return { applied: true };
  }

  await consumeAiQuota(uid, 'Você atingiu o limite diário de edições. Tente novamente amanhã.');
  const [profile, decision] = await Promise.all([db.doc(`users/${uid}`).get(), moderateEdit(book, diff)]);
  const coverPath = diff.coverUrl ? data.coverPath : '';
  const now = Date.now();
  // Toda sugestão fica registrada, inclusive as aplicadas ou recusadas pela moderação automática.
  const editRef = await db.collection('bookEdits').add({
    bookId,
    bookTitle: book.title,
    fromUid: uid,
    fromName: (profile.get('name') as string | undefined) ?? '',
    changes: diff,
    before: Object.fromEntries(Object.keys(diff).map((k) => [k, currentValue(book, k as keyof BookChanges)])),
    coverPath,
    status: decision.status,
    aiReason: decision.reason,
    ...(decision.status === 'pending' ? {} : { reviewedBy: 'ai', reviewedAt: now }),
    createdAt: now,
  });

  if (decision.status === 'rejected') {
    await deleteUploadedCover(coverPath);
    throw new HttpsError(
      'failed-precondition',
      'A alteração não foi aceita porque a moderação automática encontrou conteúdo impróprio.',
    );
  }
  if (decision.status === 'pending') return { applied: false };
  try {
    await applyBookEdit(bookId, diff, uid, book);
  } catch (error) {
    console.error('Edição aprovada pela IA não aplicada', error);
    await editRef.update({ status: 'pending', reviewedBy: FieldValue.delete(), reviewedAt: FieldValue.delete() });
    return { applied: false };
  }
  return { applied: true };
});

/** Um editor aprova (aplicando as alterações) ou recusa uma sugestão de edição. */
export const reviewBookEdit = onCall(async (request) => {
  const { uid } = requireAllowed(request);
  if (!isEditor(request)) throw new HttpsError('permission-denied', 'Só editores revisam sugestões.');
  const { editId, approve } = (request.data ?? {}) as { editId?: string; approve?: boolean };
  if (!editId) invalid('Sugestão inválida.');

  const editRef = db.doc(`bookEdits/${editId}`);
  // Marca a sugestão como revisada antes de aplicar, para que dois editores não a apliquem juntos.
  const edit = await db.runTransaction(async (tx) => {
    const snap = await tx.get(editRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Sugestão não encontrada.');
    if (snap.get('status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'Esta sugestão já foi revisada.');
    }
    tx.update(editRef, { status: approve ? 'approved' : 'rejected', reviewedBy: uid, reviewedAt: Date.now() });
    return snap.data() as { bookId: string; changes: BookChanges; coverPath?: string };
  });

  if (!approve) {
    await deleteUploadedCover(edit.coverPath);
    return { ok: true };
  }
  try {
    const bookSnap = await db.doc(`books/${edit.bookId}`).get();
    if (!bookSnap.exists) throw new HttpsError('not-found', 'O livro desta sugestão não existe mais.');
    const book = bookSnap.data() as BookDoc;
    const diff = changedFields(book, edit.changes);
    if (Object.keys(diff).length) await applyBookEdit(edit.bookId, diff, uid, book);
  } catch (error) {
    await editRef.update({ status: 'pending', reviewedBy: FieldValue.delete(), reviewedAt: FieldValue.delete() });
    throw error;
  }
  return { ok: true };
});

/**
 * Um editor desfaz uma edição já aplicada (RN-11). Só voltam ao valor anterior os campos que
 * ainda estão com o valor da edição, para não apagar correções feitas depois dela.
 */
export const revertBookEdit = onCall(async (request) => {
  const { uid } = requireAllowed(request);
  if (!isEditor(request)) throw new HttpsError('permission-denied', 'Só editores desfazem edições.');
  const { editId } = (request.data ?? {}) as { editId?: string };
  if (!editId) invalid('Edição inválida.');

  const editRef = db.doc(`bookEdits/${editId}`);
  const edit = await db.runTransaction(async (tx) => {
    const snap = await tx.get(editRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Edição não encontrada.');
    if (snap.get('status') !== 'approved') {
      throw new HttpsError('failed-precondition', 'Só edições aplicadas podem ser desfeitas.');
    }
    tx.update(editRef, { status: 'reverted', revertedBy: uid, revertedAt: Date.now() });
    return snap.data() as { bookId: string; changes: BookChanges; before: BookChanges; coverPath?: string };
  });

  try {
    const bookSnap = await db.doc(`books/${edit.bookId}`).get();
    if (!bookSnap.exists) throw new HttpsError('not-found', 'O livro desta edição não existe mais.');
    const book = bookSnap.data() as BookDoc;
    const restore: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edit.changes)) {
      if (JSON.stringify(currentValue(book, key as keyof BookChanges)) === JSON.stringify(value)) {
        restore[key] = edit.before[key as keyof BookChanges];
      }
    }
    if (Object.keys(restore).length) await applyBookEdit(edit.bookId, restore as BookChanges, uid, book);
    if ('coverUrl' in restore) await deleteUploadedCover(edit.coverPath);
  } catch (error) {
    await editRef.update({ status: 'approved', revertedBy: FieldValue.delete(), revertedAt: FieldValue.delete() });
    throw error;
  }
  return { ok: true };
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
