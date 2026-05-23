// Детектор объявления «объект закрыт / не работает / ремонт».
// Возвращает null или { notice, range? } для дальнейшего использования.

const { normalizeText, parseDateRange } = require('../_lib/timeParse');

const TRIGGER_RE = /(закрыт|не\s+работает|приостанов|ремонтн|техническ|отключени[еия]\s+(горяч|холодн|вод)|плановое\s+отключени)/iu;

// Третий аргумент `plainText` — заранее очищенный текст root'а (с пробелами
// между блочными элементами). Если не передан — читаем напрямую через
// $root.text(), как раньше. Это нужно, потому что cheerio склеивает соседние
// <p>/<span> без пробелов: «года» + «плавательный» → «годаплавательный».
function detect($, $root, plainText) {
  const text = plainText != null ? plainText : normalizeText($root.text());
  if (!TRIGGER_RE.test(text)) return null;

  // Берём предложение/абзац с триггером, чтобы не тащить весь HTML в notice.
  const sentences = text.split(/(?<=[\.\!?])\s+/);
  const matched = sentences.filter(s => TRIGGER_RE.test(s));
  const notice = (matched.join(' ') || text).slice(0, 280);

  const range = parseDateRange(notice) || parseDateRange(text);
  return { notice, range };
}

module.exports = { detect, TRIGGER_RE };
