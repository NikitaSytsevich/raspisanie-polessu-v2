// Сравнение секретов за константное время. Обычный `===` прерывается на
// первом несовпавшем символе — по времени ответа теоретически можно
// подбирать секрет посимвольно. Хэшируем обе стороны (выравнивает длину,
// timingSafeEqual требует равные буферы) и сравниваем дайджесты.

const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { safeEqual };
