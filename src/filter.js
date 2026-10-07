const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tender matches if any keyword is in title/description OR any CPV code starts with a prefix.
function buildMatcher({ keywords, cpvPrefixes }) {
  if (!keywords.length && !cpvPrefixes.length) return () => true;
  const kw = keywords.length
    ? new RegExp(`\\b(${keywords.map(escapeRegex).join('|')})\\b`, 'i')
    : null;
  return (n) =>
    (kw && kw.test(`${n.title} ${n.description}`)) ||
    n.cpv.split(', ').some((c) => cpvPrefixes.some((p) => c.startsWith(p)));
}

// Whole-term regex that also works for terms like "c#", "c++", "node.js" and ".net",
// where \b fails because the term starts or ends with punctuation.
const termRegex = (terms) => new RegExp(`(?<![a-z0-9])(${terms.map(escapeRegex).join('|')})(?![a-z0-9#+])`, 'i');

// Returns text => true if any term occurs.
function buildTermMatcher(terms) {
  if (!terms.length) return () => false;
  const re = termRegex(terms);
  return (text) => re.test(text);
}

// Returns text => the terms that occur, in list order.
function buildTermLister(terms) {
  const res = terms.map((t) => [t, termRegex([t])]);
  return (text) => res.filter(([, re]) => re.test(text)).map(([t]) => t);
}

module.exports = { buildMatcher, buildTermMatcher, buildTermLister };
