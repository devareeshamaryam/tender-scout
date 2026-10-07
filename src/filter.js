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

module.exports = { buildMatcher };
