import { Book, BookDraft } from './models';

/** Dados do livro como editados no formulário (autores em texto, números opcionais). */
export interface BookForm {
  title: string;
  subtitle: string;
  authors: string;
  publisher: string;
  year: number | null;
  isbn: string;
  pages: number | null;
  edition: string;
}

export const EMPTY_BOOK_FORM: BookForm = {
  title: '',
  subtitle: '',
  authors: '',
  publisher: '',
  year: null,
  isbn: '',
  pages: null,
  edition: '',
};

export function splitAuthors(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function formFromBook(book: Book): BookForm {
  return {
    title: book.title,
    subtitle: book.subtitle ?? '',
    authors: book.authors.join(', '),
    publisher: book.publisher ?? '',
    year: book.year ?? null,
    isbn: book.isbn ?? '',
    pages: book.pages || null,
    edition: book.edition ?? '',
  };
}

export function draftFromForm(form: BookForm): BookDraft {
  return {
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    authors: splitAuthors(form.authors),
    publisher: form.publisher.trim(),
    year: form.year ? Number(form.year) : null,
    isbn: form.isbn.trim(),
    pages: Number(form.pages) || 0,
    edition: form.edition.trim(),
  };
}

/** Aplica os dados lidos da ficha catalográfica, que descrevem a edição exata e prevalecem. */
export function mergeCatalogCard(form: BookForm, card: BookDraft): BookForm {
  return {
    title: card.title || form.title,
    subtitle: card.subtitle || form.subtitle,
    authors: card.authors.length ? card.authors.join(', ') : form.authors,
    publisher: card.publisher || form.publisher,
    year: card.year || form.year,
    isbn: card.isbn || form.isbn,
    pages: card.pages || form.pages,
    edition: card.edition || form.edition,
  };
}
