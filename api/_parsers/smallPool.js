// Парсер «Малый бассейн». Сейчас тоже закрыт.
const { genericParse } = require('./_common');

function parse(html, ctx) {
  return genericParse(html, ctx);
}

module.exports = { parse };
