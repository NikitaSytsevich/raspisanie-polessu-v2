// Каталог объектов: id → URL источника + парсер.
// URL'ы синхронизированы с app/data.jsx (FACILITIES).

const iceArena   = require('./iceArena');
const sportsPool = require('./sportsPool');
const smallPool  = require('./smallPool');
const rowingBase = require('./rowingBase');

const FACILITIES = [
  {
    id: 'ice_arena',
    name: 'Ледовая арена',
    sourceUrl: 'https://www.polessu.by/%D0%BB%D0%B5%D0%B4%D0%BE%D0%B2%D0%B0%D1%8F-%D0%B0%D1%80%D0%B5%D0%BD%D0%B0-%D0%BF%D0%BE%D0%BB%D0%B5%D1%81%D0%B3%D1%83',
    parse: iceArena.parse,
  },
  {
    id: 'sports_pool',
    name: 'Большой бассейн',
    sourceUrl: 'https://www.polessu.by/%D0%B1%D0%BE%D0%BB%D1%8C%D1%88%D0%BE%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD',
    parse: sportsPool.parse,
  },
  {
    id: 'small_pool',
    name: 'Малый бассейн',
    sourceUrl: 'https://www.polessu.by/%D0%BC%D0%B0%D0%BB%D1%8B%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD',
    parse: smallPool.parse,
  },
  {
    id: 'rowing_base',
    name: 'Гребная база',
    sourceUrl: 'https://www.polessu.by/%D1%80%D0%B0%D1%81%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D0%B5-%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%8B-%D1%82%D1%80%D0%B5%D0%BD%D0%B0%D0%B6%D0%B5%D1%80%D0%BD%D0%BE%D0%B3%D0%BE-%D0%B7%D0%B0%D0%BB%D0%B0-%D0%B8-%D0%B7%D0%B0%D0%BB%D0%B0-%D1%88%D1%82%D0%B0%D0%BD%D0%B3%D0%B8-%D0%B3%D1%80%D0%B5%D0%B1%D0%BD%D0%B0%D1%8F-%D0%B1%D0%B0%D0%B7%D0%B0-%E2%84%961',
    parse: rowingBase.parse,
  },
];

module.exports = { FACILITIES };
