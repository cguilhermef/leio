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

/** Verdadeiro se as palavras diferem em no máximo uma letra (inserida, removida ou trocada). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Palavras iguais, uma prefixo da outra (tolera "Bernar" x "Bernard", plurais) ou com um
 * erro de digitação ("inteligence" x "intelligence").
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  return short.length >= 5 && oneEditApart(a, b);
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

/** Verdadeiro se todas as palavras do autor buscado aparecem entre os autores encontrados. */
export function matchesAuthor(authors: string[], author: string): boolean {
  return coverage(words(author), words(authors.join(' '))) === 1;
}

/** Título sem subtítulo, normalizado, para reconhecer edições da mesma obra. */
export function workKey(title: string): string {
  return words(title.split(/[:(]/)[0]).join(' ');
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
