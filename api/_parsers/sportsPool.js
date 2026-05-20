// Парсер «Большой бассейн». Сейчас закрыт на профилактику горячей воды.
const { genericParse } = require('./_common');

function parse(html, ctx) {
  return genericParse(html, ctx);
}

module.exports = { parse };
