// Parses the counts YouTube prints in any UI language: "1.8M", "83 тыс.
// просмотров", "1,234 views", "57K", "No views".

const NO_VIEWS = /^(no views|нет просмотров|ei katselukertoja)/i;

// Short abbreviations must not be followed by a letter, so "katselukertaa"
// is not read as "k" and "views" never matches anything.
const NL = '(?![a-zа-яё])';
const MULTIPLIERS: Array<[RegExp, number]> = [
  [new RegExp(`^(b${NL}|bn${NL}|md${NL}|billion|млрд|mrd)`), 1e9],
  [new RegExp(`^(m${NL}|mln|million|млн|milj|mio|mill)`), 1e6],
  [new RegExp(`^(k${NL}|t${NL}|tsd${NL}|mil${NL}|tys${NL}|thousand|тыс|tuhat)`), 1e3],
];

export function parseCount(text: string): number | null {
  const s = text.replace(/[  ]/g, ' ').trim();
  if (NO_VIEWS.test(s)) return 0;
  const m = s.match(/(\d[\d\s.,]*)\s*([^\d\s]*)/);
  if (!m) return null;
  const suffix = m[2].toLowerCase();
  const mult = MULTIPLIERS.find(([re]) => re.test(suffix));
  if (mult) {
    // "1.8M", "1,8 млн": the separator is a decimal point.
    return parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) * mult[1];
  }
  // "1,234 views", "1 234 просмотра": separators group thousands.
  return parseInt(m[1].replace(/\D/g, ''), 10);
}
