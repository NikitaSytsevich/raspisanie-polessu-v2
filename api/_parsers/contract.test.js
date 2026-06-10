// Контрактный тест: каждый парсер прогоняется по КАЖДОЙ фикстуре, включая
// чужие. Парсер не обязан понять чужую страницу, но обязан:
//   • не бросить исключение;
//   • если вернул ok — отдать валидные сессии: ISO-даты, start < end,
//     даты в окне правдоподобия, без дублей;
//   • если вернул ok:false — назвать строковый reason.
// Один файл ловит регрессии этого класса во всех парсерах сразу.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FACILITIES } = require('./index');
const { isoOffset } = require('../_lib/timeParse');

const FIX_DIR = path.join(__dirname, '__fixtures__');
// Среда; в окно [−7, +45] попадают даты всех фикстур (май–июнь 2026).
const TODAY = '2026-05-20';
const MIN_DATE = isoOffset(TODAY, -7);
const MAX_DATE = isoOffset(TODAY, 45);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const fixtures = fs.readdirSync(FIX_DIR).filter(n => n.endsWith('.html'));

for (const fac of FACILITIES) {
  for (const name of fixtures) {
    test(`contract: ${fac.id} × ${name}`, () => {
      const html = fs.readFileSync(path.join(FIX_DIR, name), 'utf-8');
      const out = fac.parse(html, { todayIso: TODAY });

      assert.ok(out && typeof out.ok === 'boolean', 'результат должен иметь boolean ok');
      if (!out.ok) {
        assert.equal(typeof out.reason, 'string', 'у неуспеха должен быть строковый reason');
        return;
      }

      assert.ok(Array.isArray(out.sessions) && out.sessions.length > 0,
        'ok-результат обязан содержать непустые sessions');

      const seen = new Set();
      for (const s of out.sessions) {
        assert.match(s.date, ISO_DATE_RE, `date не ISO: ${s.date}`);
        assert.match(s.start, TIME_RE, `start не HH:MM: ${s.start}`);
        assert.match(s.end, TIME_RE, `end не HH:MM: ${s.end}`);
        assert.ok(s.start < s.end, `инвертированный слот: ${s.date} ${s.start}–${s.end}`);
        assert.ok(s.date >= MIN_DATE && s.date <= MAX_DATE,
          `дата вне окна правдоподобия [${MIN_DATE}..${MAX_DATE}]: ${s.date}`);
        assert.equal(typeof s.activity, 'string', 'activity должна быть строкой');

        const k = `${s.date}|${s.start}|${s.end}|${s.activity}`;
        assert.ok(!seen.has(k), `дубликат сессии: ${k}`);
        seen.add(k);
      }

      if (out.closureRanges) {
        assert.ok(Array.isArray(out.closureRanges), 'closureRanges должен быть массивом');
        for (const r of out.closureRanges) {
          assert.match(r.from, ISO_DATE_RE, `closure from не ISO: ${r.from}`);
          assert.match(r.to, ISO_DATE_RE, `closure to не ISO: ${r.to}`);
          assert.ok(r.from <= r.to, `closure-диапазон инвертирован: ${r.from}..${r.to}`);
          assert.equal(typeof r.notice, 'string');
        }
      }
    });
  }
}
