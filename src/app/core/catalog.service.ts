import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { AuthService } from './auth.service';
import { callFunction, db, storage } from './firebase';
import { Book, BookChanges, BookDraft } from './models';
import { normalize } from './text';

export interface CoverResult {
  title: string;
  subtitle: string;
  authors: string[];
}

/** Edição encontrada em catálogos online (Google Books, Open Library). */
export interface OnlineEdition {
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

export interface SearchResult {
  matches: Book[];
  editions: OnlineEdition[];
  /** As fontes online falharam (erro ou indisponibilidade), em vez de não terem resultados. */
  onlineFailed: boolean;
}

export interface CardResult {
  draft: BookDraft;
  match: Book | null;
}

export interface AuthorResult {
  /** Livros do autor que já estão no catálogo do Leio. */
  matches: Book[];
  /** Obras encontradas online, uma por título (a capa pode faltar). */
  works: OnlineEdition[];
  onlineFailed: boolean;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private auth = inject(AuthService);

  /** Lê título e autores da foto da capa com a OpenAI. */
  identifyCover(image: string): Promise<CoverResult> {
    return callFunction<{ image: string }, CoverResult>('identifyCover', { image });
  }

  /** Procura o livro no catálogo do Leio e capas/edições online. */
  search(title: string, authors: string[]): Promise<SearchResult> {
    return callFunction<{ title: string; authors: string[] }, SearchResult>('searchBook', { title, authors });
  }

  /** Baixa uma capa online (via Cloud Function) como data URL. */
  async fetchCover(url: string): Promise<string> {
    const { image } = await callFunction<{ url: string }, { image: string }>('fetchCover', { url });
    return image;
  }

  /** Lê a ficha catalográfica com a OpenAI. */
  readCatalogCard(image: string): Promise<CardResult> {
    return callFunction<{ image: string }, CardResult>('readCatalogCard', { image });
  }

  /** Lista as obras de um autor, no catálogo do Leio e online. */
  searchAuthor(author: string): Promise<AuthorResult> {
    return callFunction<{ author: string }, AuthorResult>('searchAuthor', { author });
  }

  /**
   * Edita o livro: para editores vale na hora (`applied`); para os demais vira uma sugestão
   * que aguarda aprovação. A nova capa, se houver, é enviada antes para o Storage.
   */
  async edit(bookId: string, changes: BookChanges, coverDataUrl?: string): Promise<{ applied: boolean }> {
    let coverPath: string | undefined;
    if (coverDataUrl) {
      coverPath = `covers/${bookId}-${Date.now()}.jpg`;
      await uploadString(ref(storage, coverPath), coverDataUrl, 'data_url', { contentType: 'image/jpeg' });
    }
    return callFunction<{ bookId: string; changes: BookChanges; coverPath?: string }, { applied: boolean }>(
      'editBook',
      { bookId, changes, coverPath },
    );
  }

  async get(bookId: string): Promise<Book | null> {
    const snap = await getDoc(doc(db, 'books', bookId));
    return snap.exists() ? ({ ...(snap.data() as Book), id: snap.id }) : null;
  }

  async create(draft: BookDraft, coverDataUrl?: string): Promise<Book> {
    const bookRef = doc(collection(db, 'books'));
    let coverUrl = draft.coverUrl ?? '';
    if (coverDataUrl) {
      const fileRef = ref(storage, `covers/${bookRef.id}.jpg`);
      await uploadString(fileRef, coverDataUrl, 'data_url', { contentType: 'image/jpeg' });
      coverUrl = await getDownloadURL(fileRef);
    }
    const book: Omit<Book, 'id'> = {
      title: draft.title.trim(),
      subtitle: draft.subtitle?.trim() ?? '',
      authors: draft.authors.map((a) => a.trim()).filter(Boolean),
      publisher: draft.publisher?.trim() ?? '',
      year: draft.year || null,
      isbn: (draft.isbn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase(),
      pages: Number(draft.pages) || 0,
      edition: draft.edition?.trim() ?? '',
      coverUrl,
      titleKey: normalize(draft.title),
      createdBy: this.auth.uid(),
    };
    await setDoc(bookRef, { ...book, createdAt: serverTimestamp() });
    return { ...book, id: bookRef.id };
  }
}
