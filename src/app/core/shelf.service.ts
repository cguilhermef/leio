import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  QueryConstraint,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
  setDoc,
  arrayRemove,
  arrayUnion,
} from 'firebase/firestore';
import { AuthService } from './auth.service';
import { db } from './firebase';
import { Book, Goal, LogKind, ReadingLog, ShelfEntry, ShelfStatus } from './models';
import { isoDate } from './text';
import { weekStart } from './stats';

@Injectable({ providedIn: 'root' })
export class ShelfService {
  private auth = inject(AuthService);

  readonly entries = signal<ShelfEntry[]>([]);
  readonly loaded = signal(false);
  readonly goal = signal<Goal | null>(null);
  readonly weekLogs = signal<ReadingLog[]>([]);

  readonly byId = computed(() => new Map(this.entries().map((e) => [e.bookId, e])));
  readonly reading = computed(() =>
    this.entries()
      .filter((e) => e.status === 'reading')
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );
  readonly lastRead = computed(() =>
    this.entries()
      .filter((e) => e.status === 'read' && e.finishedDates?.length)
      .sort((a, b) => lastDate(b).localeCompare(lastDate(a)) || b.updatedAt - a.updatedAt)
      .slice(0, 2),
  );

  constructor() {
    effect((onCleanup) => {
      const uid = this.auth.state() === 'ready' ? this.auth.uid() : '';
      this.entries.set([]);
      this.goal.set(null);
      this.weekLogs.set([]);
      this.loaded.set(false);
      if (!uid) return;

      const year = new Date().getFullYear();
      const unsubs = [
        onSnapshot(collection(db, 'users', uid, 'shelf'), (snap) => {
          this.entries.set(snap.docs.map((d) => normalizeEntry(d.data() as ShelfEntry)));
          this.loaded.set(true);
        }),
        onSnapshot(doc(db, 'users', uid, 'goals', String(year)), (snap) => {
          this.goal.set(snap.exists() ? { books: 0, excluded: [], ...(snap.data() as Partial<Goal>), year } : null);
        }),
        onSnapshot(
          query(collection(db, 'users', uid, 'logs'), where('date', '>=', weekStart())),
          (snap) => this.weekLogs.set(snap.docs.map((d) => d.data() as ReadingLog)),
        ),
      ];
      onCleanup(() => unsubs.forEach((u) => u()));
    });
  }

  private get uid(): string {
    const uid = this.auth.uid();
    if (!uid) throw new Error('Usuário não autenticado.');
    return uid;
  }

  private entryRef(bookId: string) {
    return doc(db, 'users', this.uid, 'shelf', bookId);
  }

  private newLog(entry: ShelfEntry, fromPage: number, toPage: number, pages: number, kind: LogKind, date: string) {
    const ref = doc(collection(db, 'users', this.uid, 'logs'));
    const log: ReadingLog = {
      bookId: entry.bookId,
      title: entry.title,
      date,
      fromPage,
      toPage,
      pages,
      kind,
      createdAt: Date.now(),
    };
    return { ref, log };
  }

  async loadLogs(...constraints: QueryConstraint[]): Promise<ReadingLog[]> {
    const snap = await getDocs(
      query(collection(db, 'users', this.uid, 'logs'), ...constraints, orderBy('date', 'desc')),
    );
    return snap.docs.map((d) => ({ ...(d.data() as ReadingLog), id: d.id }));
  }

  loadBookLogs(bookId: string): Promise<ReadingLog[]> {
    return this.loadLogs(where('bookId', '==', bookId));
  }

  /** Adiciona um livro do catálogo à estante. */
  async add(book: Book, status: ShelfStatus, finishedDate = isoDate()): Promise<void> {
    const now = Date.now();
    const entry: ShelfEntry = {
      bookId: book.id,
      title: book.title,
      authors: book.authors,
      coverUrl: book.coverUrl ?? '',
      pages: book.pages || 0,
      status,
      currentPage: 0,
      maxPage: 0,
      pagesRead: 0,
      reads: 0,
      finishedDates: [],
      addedAt: now,
      updatedAt: now,
    };
    const batch = writeBatch(db);
    if (status === 'read') {
      Object.assign(entry, {
        currentPage: entry.pages,
        maxPage: entry.pages,
        pagesRead: entry.pages,
        reads: 1,
        finishedDates: [finishedDate],
      });
      if (entry.pages > 0) {
        const { ref, log } = this.newLog(entry, 0, entry.pages, entry.pages, 'finish', finishedDate);
        batch.set(ref, log);
      }
    }
    batch.set(this.entryRef(book.id), entry);
    await batch.commit();
  }

  /**
   * Registra a página em que o leitor está. A diferença em relação à última página
   * informada vira páginas lidas na data escolhida. Ao chegar na última página, o livro
   * é marcado como lido.
   */
  async logPage(
    entry: ShelfEntry,
    page: number,
    date = isoDate(),
    positions?: number,
  ): Promise<{ finished: boolean }> {
    const from = entry.status === 'reading' ? entry.currentPage : 0;
    const to = entry.pages > 0 ? Math.min(page, entry.pages) : page;
    if (to < from) {
      throw new Error(`A página informada é anterior à última registrada (${from}).`);
    }
    const finished = entry.pages > 0 && to >= entry.pages;
    const delta = to - from;
    const batch = writeBatch(db);
    const update: Partial<ShelfEntry> = {
      status: finished ? 'read' : 'reading',
      currentPage: to,
      maxPage: Math.max(entry.maxPage, to),
      pagesRead: entry.pagesRead + delta,
      updatedAt: Date.now(),
    };
    if (positions && positions !== entry.positions) update.positions = positions;
    if (finished) {
      update.reads = entry.reads + 1;
      update.finishedDates = [...entry.finishedDates, date];
    }
    if (delta > 0) {
      const { ref, log } = this.newLog(entry, from, to, delta, finished ? 'finish' : 'progress', date);
      batch.set(ref, log);
    }
    batch.update(this.entryRef(entry.bookId), update);
    await batch.commit();
    return { finished };
  }

  /** Marca a leitura atual como concluída, contando as páginas que faltavam. */
  async finish(entry: ShelfEntry, date = isoDate()): Promise<void> {
    if (entry.pages > 0) {
      await this.logPage({ ...entry, status: 'reading' }, entry.pages, date);
      return;
    }
    await setDoc(
      this.entryRef(entry.bookId),
      {
        status: 'read',
        reads: entry.reads + 1,
        finishedDates: [...entry.finishedDates, date],
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  }

  /** Registra mais uma leitura completa de um livro já lido. */
  async addReread(entry: ShelfEntry, date = isoDate()): Promise<void> {
    const batch = writeBatch(db);
    const { ref, log } = this.newLog(entry, 0, entry.pages, entry.pages, 'reread', date);
    if (entry.pages > 0) batch.set(ref, log);
    batch.update(this.entryRef(entry.bookId), {
      status: 'read',
      reads: entry.reads + 1,
      pagesRead: entry.pagesRead + entry.pages,
      maxPage: entry.pages,
      currentPage: entry.pages,
      finishedDates: [...entry.finishedDates, date],
      updatedAt: Date.now(),
    });
    await batch.commit();
  }

  /** Inicia uma nova leitura (releitura) acompanhando o progresso página a página. */
  async startReading(entry: ShelfEntry): Promise<void> {
    await setDoc(
      this.entryRef(entry.bookId),
      { status: 'reading', currentPage: 0, updatedAt: Date.now() },
      { merge: true },
    );
  }

  async setStatus(entry: ShelfEntry, status: ShelfStatus): Promise<void> {
    if (status === entry.status) return;
    if (status === 'read') return this.finish(entry);
    if (status === 'reading') return this.startReading(entry);
    await setDoc(
      this.entryRef(entry.bookId),
      { status, currentPage: 0, updatedAt: Date.now() },
      { merge: true },
    );
  }

  async setPages(entry: ShelfEntry, pages: number): Promise<void> {
    await setDoc(this.entryRef(entry.bookId), { pages, updatedAt: Date.now() }, { merge: true });
  }

  /** Remove o livro da estante, junto com seus registros de leitura. */
  async remove(entry: ShelfEntry): Promise<void> {
    const logs = await this.loadBookLogs(entry.bookId);
    const batch = writeBatch(db);
    logs.forEach((l) => batch.delete(doc(db, 'users', this.uid, 'logs', l.id!)));
    batch.delete(this.entryRef(entry.bookId));
    await batch.commit();
  }

  /** Apaga um registro de leitura e desfaz seu efeito nas páginas lidas. */
  async deleteLog(entry: ShelfEntry, log: ReadingLog): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', this.uid, 'logs', log.id!));
    const update: Record<string, unknown> = {
      pagesRead: Math.max(0, entry.pagesRead - log.pages),
      updatedAt: Date.now(),
    };
    if (log.kind === 'progress' && entry.status === 'reading' && entry.currentPage === log.toPage) {
      update['currentPage'] = log.fromPage;
    }
    if (log.kind !== 'progress') {
      const dates = [...entry.finishedDates];
      const index = dates.lastIndexOf(log.date);
      if (index >= 0) dates.splice(index, 1);
      update['finishedDates'] = dates;
      update['reads'] = Math.max(0, entry.reads - 1);
      if (log.kind === 'finish' && entry.reads <= 1) {
        update['status'] = 'reading';
        update['currentPage'] = log.fromPage;
        update['maxPage'] = log.fromPage;
      }
    }
    batch.update(this.entryRef(entry.bookId), update);
    await batch.commit();
  }

  async saveGoal(books: number): Promise<void> {
    const year = new Date().getFullYear();
    await setDoc(doc(db, 'users', this.uid, 'goals', String(year)), { books }, { merge: true });
  }

  async setGoalInclusion(bookId: string, included: boolean): Promise<void> {
    const year = new Date().getFullYear();
    await setDoc(
      doc(db, 'users', this.uid, 'goals', String(year)),
      { excluded: included ? arrayRemove(bookId) : arrayUnion(bookId) },
      { merge: true },
    );
  }

  /** Estante de outro usuário (permitida apenas entre conexões). */
  async loadShelfOf(uid: string): Promise<ShelfEntry[]> {
    const snap = await getDocs(collection(db, 'users', uid, 'shelf'));
    return snap.docs.map((d) => normalizeEntry(d.data() as ShelfEntry));
  }
}

function lastDate(entry: ShelfEntry): string {
  return [...(entry.finishedDates ?? [])].sort().pop() ?? '';
}

function normalizeEntry(entry: ShelfEntry): ShelfEntry {
  return {
    ...entry,
    authors: entry.authors ?? [],
    finishedDates: entry.finishedDates ?? [],
    currentPage: entry.currentPage ?? 0,
    maxPage: entry.maxPage ?? 0,
    pagesRead: entry.pagesRead ?? 0,
    reads: entry.reads ?? 0,
  };
}
