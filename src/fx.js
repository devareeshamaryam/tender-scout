// Approximate GBP rates, used only to apply AWARD_MIN_GBP across currencies.
// Not for accounting - update occasionally if rates move a lot.
const GBP_PER_UNIT = {
  GBP: 1, EUR: 0.85, USD: 0.75, CHF: 0.92, NOK: 0.073, SEK: 0.078, DKK: 0.114,
  ISK: 0.0058, PLN: 0.2, CZK: 0.034, HUF: 0.0021, RON: 0.17, BGN: 0.435,
  SGD: 0.58, HKD: 0.096, SAR: 0.2, AED: 0.2, QAR: 0.2, KWD: 2.45,
};

// Returns the approximate GBP value, or null if value/currency is unknown.
function toGbp(amount, currency) {
  const rate = GBP_PER_UNIT[(currency || 'GBP').toUpperCase()];
  if (amount === '' || amount == null || Number.isNaN(Number(amount)) || !rate) return null;
  return Math.round(Number(amount) * rate);
}

module.exports = { toGbp };
