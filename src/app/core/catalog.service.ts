import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { AuthService } from './auth.service';
import { callFunction, db, storage } from './firebase';
import { Book, BookDraft } from './models';
import { normalize } from './text';

export interface CoverResult {
  title: string;
  subtitle: string;
  authors: string[];
  matches: Book[];
}

export interface CardResult {
  draft: BookDraft;
  match: Book | null;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private auth = inject(AuthService);

  /** Lê a capa com a OpenAI e procura o livro no catálogo. */
  identifyCover(image: string): Promise<CoverResult> {
    return callFunction<{ image: string }, CoverResult>('identifyCover', { image });
  }

  /** Lê a ficha catalográfica com a OpenAI. */
  readCatalogCard(image: string): Promise<CardResult> {
    return callFunction<{ image: string }, CardResult>('readCatalogCard', { image });
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
