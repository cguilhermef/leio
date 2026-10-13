/** Normaliza texto para comparação: minúsculas, sem acentos e sem pontuação. */
export function normalize(text: string | undefined | null): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchesQuery(query: string, ...fields: (string | string[] | undefined)[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = normalize(fields.flat().filter(Boolean).join(' '));
  return q.split(' ').every((term) => haystack.includes(term));
}

export function authorsLabel(authors: string[] | undefined): string {
  return (authors ?? []).join(', ');
}

/** Data local no formato AAAA-MM-DD. */
export function isoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string): string {
  return parseIsoDate(value).toLocaleDateString('pt-BR');
}
