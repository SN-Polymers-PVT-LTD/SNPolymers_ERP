const { ToWords } = require('to-words');

// currency:false → plain Indian-numbering (lakh/crore) word conversion, no
// "Rupees"/"Only" — those wrap this output in the Bulk NEFT letter's static
// "Total = ( ... Only )" cell text, not here.
const toWords = new ToWords({ localeCode: 'en-IN' });

/**
 * amount (rupees, may include paise) → Indian-numbering words, e.g.
 * 249980 → "Two Lakh Forty Nine Thousand Nine Hundred Eighty".
 * A non-zero paise remainder is appended as "... and N Paise".
 */
function numberToIndianWords(amount) {
  const num = Math.abs(Number(amount) || 0);
  const rupees = Math.trunc(num);
  const paise = Math.round((num - rupees) * 100);

  const rupeeWords = toWords.convert(rupees, { currency: false });
  if (paise > 0) {
    const paiseWords = toWords.convert(paise, { currency: false });
    return `${rupeeWords} and ${paiseWords} Paise`;
  }
  return rupeeWords;
}

module.exports = { numberToIndianWords };
