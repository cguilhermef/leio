export type ShelfStatus = 'read' | 'reading' | 'toread';

export const STATUS_LABEL: Record<ShelfStatus, string> = {
  read: 'Lido',
  reading: 'Lendo',
  toread: 'Lerei',
};

/** Livro do catálogo compartilhado (coleção `books`). */
export interface Book {
  id: string;
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
  createdBy: string;
  createdAt?: unknown;
}

export type BookDraft = Omit<Book, 'id' | 'titleKey' | 'createdBy' | 'createdAt'>;

/** Livro na estante de um usuário (`users/{uid}/shelf/{bookId}`). */
export interface ShelfEntry {
  bookId: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  pages: number;
  status: ShelfStatus;
  /** Página atual da leitura em andamento. */
  currentPage: number;
  /** Maior página já alcançada; base das "páginas únicas". */
  maxPage: number;
  /** Total de páginas lidas deste livro, somando releituras. */
  pagesRead: number;
  /** Quantidade de leituras concluídas. */
  reads: number;
  /** Datas (AAAA-MM-DD) em que cada leitura foi concluída. */
  finishedDates: string[];
  addedAt: number;
  updatedAt: number;
}

export type LogKind = 'progress' | 'finish' | 'reread';

/** Registro de leitura (`users/{uid}/logs/{id}`). */
export interface ReadingLog {
  id?: string;
  bookId: string;
  title: string;
  date: string;
  fromPage: number;
  toPage: number;
  pages: number;
  kind: LogKind;
  createdAt: number;
}

export interface Goal {
  year: number;
  books: number;
  /** Livros que o usuário escolheu não contar na meta. */
  excluded: string[];
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  connections: string[];
}

export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface Invite {
  id: string;
  fromUid: string;
  fromName: string;
  fromEmail: string;
  fromPhoto?: string;
  toEmail: string;
  status: InviteStatus;
  createdAt: number;
}

export interface Recommendation {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  bookId: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  note?: string;
  seen: boolean;
  createdAt: number;
}
