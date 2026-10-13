/** Classificação de edições encontradas online por relevância ao título e autor buscados. */

const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma', 'no', 'na', 'nos', 'nas', 'the', 'of',
  'and', 'an', 'el', 'la', 'los', 'las', 'le', 'les', 'livro', 'volume', 'vol',
]);

export function normalize(text: string | undefined | null): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Palavras iguais, ou uma prefixo da outra (tolera "Bernar" x "Bernard", plurais). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Fração das palavras buscadas que aparecem no texto encontrado. */
function coverage(query: string[], found: string[]): number {
  if (!query.length) return 0;
  return query.filter((q) => found.some((f) => sameWord(q, f))).length / query.length;
}

export interface Rankable {
  title: string;
  subtitle: string;
  authors: string[];
}

export interface Scored<T> {
  item: T;
  titleScore: number;
  authorScore: number;
}

export function score<T extends Rankable>(item: T, title: string, authors: string[]): Scored<T> {
  const titleScore = coverage(words(title), words(`${item.title} ${item.subtitle}`));
  const queryAuthors = words(authors.join(' '));
  const authorScore = queryAuthors.length ? coverage(queryAuthors, words(item.authors.join(' '))) : 1;
  return { item, titleScore, authorScore };
}

/**
 * Mantém só as edições que correspondem ao livro buscado e ordena as mais relevantes primeiro.
 * Exige a maior parte das palavras do título e, quando o autor é conhecido, ao menos parte do
 * nome dele (edições sem autor cadastrado são aceitas, com prioridade menor).
 */
export function rankEditions<T extends Rankable>(items: T[], title: string, authors: string[]): T[] {
  const hasAuthor = words(authors.join(' ')).length > 0;
  return items
    .map((item) => score(item, title, authors))
    .filter((s) => s.titleScore >= 0.6)
    .filter((s) => !hasAuthor || s.authorScore > 0 || s.item.authors.length === 0)
    .sort((a, b) => b.authorScore - a.authorScore || b.titleScore - a.titleScore)
    .map((s) => s.item);
}
