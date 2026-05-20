// Парсер «Ледовая арена». Сейчас страница в режиме «закрыта на ремонт».
// Когда расписание вернётся, у арены типично 4 типа сессий:
// массовое катание, хоккей, секции, заливка льда.
const { genericParse } = require('./_common');

function parse(html, ctx) {
  return genericParse(html, ctx);
}

module.exports = { parse };
