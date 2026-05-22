<div align="center">

<img src="apple-touch-icon.png" alt="Расписание ПолесГУ" width="128" height="128" />

# Расписание ПолесГУ

**Парсер расписания спортивных объектов Полесского государственного университета.**
Тонкий React-фронтенд + одна Vercel-функция, которая ходит за расписанием на сайт ПолесГУ.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/raspisanie-polessu)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Hobby-000?logo=vercel&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-13%20passing-brightgreen)

</div>

---

## Что это

Когда тренер или администратор отвечает за смены на разных спортивных объектах ПолесГУ — нужно одновременно держать в голове свой график и следить за изменениями расписания, которые университет публикует у себя на сайте. Это приложение делает за вас и то, и другое:

- хранит ваши личные смены в браузере (никаких аккаунтов, никакого сервера для пользовательских данных);
- каждые 5 минут (через CDN-кеш Vercel) перетягивает свежее расписание со страниц `polessu.by` и кладёт в JSON;
- сравнивает с вашим графиком и подсвечивает расхождения прямо в карточке смены — «у вас 18:00–21:00, на сайте 18:30–19:30 + 19:30–20:30»;
- ведёт журнал проверок и помечает события, которые затрагивают именно ваши смены.

Работает с четырьмя объектами:

| ID            | Объект             | Источник                                                                                       |
|---------------|--------------------|-----------------------------------------------------------------------------------------------|
| `ice_arena`   | Ледовая арена      | [polessu.by/ледовая-арена](https://www.polessu.by/%D0%BB%D0%B5%D0%B4%D0%BE%D0%B2%D0%B0%D1%8F-%D0%B0%D1%80%D0%B5%D0%BD%D0%B0-%D0%BF%D0%BE%D0%BB%D0%B5%D1%81%D0%B3%D1%83) |
| `sports_pool` | Большой бассейн    | [polessu.by/большой-бассейн](https://www.polessu.by/%D0%B1%D0%BE%D0%BB%D1%8C%D1%88%D0%BE%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD) |
| `small_pool`  | Малый бассейн      | [polessu.by/малый-бассейн](https://www.polessu.by/%D0%BC%D0%B0%D0%BB%D1%8B%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD) |
| `rowing_base` | Гребная база №1    | [polessu.by/расписание-…-гребная-база-№1](https://www.polessu.by/%D1%80%D0%B0%D1%81%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D0%B5-%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%8B-%D1%82%D1%80%D0%B5%D0%BD%D0%B0%D0%B6%D0%B5%D1%80%D0%BD%D0%BE%D0%B3%D0%BE-%D0%B7%D0%B0%D0%BB%D0%B0-%D0%B8-%D0%B7%D0%B0%D0%BB%D0%B0-%D1%88%D1%82%D0%B0%D0%BD%D0%B3%D0%B8-%D0%B3%D1%80%D0%B5%D0%B1%D0%BD%D0%B0%D1%8F-%D0%B1%D0%B0%D0%B7%D0%B0-%E2%84%961) |

---

## Возможности

- **Личные смены** — добавление, редактирование, удаление.
- **Сопоставление со сайтом** — в каждой карточке смены видно, совпадает ли она с реальным сеансом на сайте, расходится по времени, или объект сейчас закрыт.
- **Журнал проверок** — события `add` / `mod` / `rem` группируются по объектам и датам, события, влияющие на ваши смены, отдельно подсвечены.
- **Импорт / экспорт JSON** — резервная копия для переноса на другое устройство.
- **PWA** — «Добавить на главный экран» на iPhone/Android даёт иконку и standalone-режим.
- **Темы** — светлая, тёмная, системная.
- **iOS-style навигация** — edge-swipe-back, push/pop с CSS-keyframes, без дёрганий.

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Vercel Hobby (free tier)                                   │
│  ┌───────────────────────┐    ┌──────────────────────────┐  │
│  │  Static (CDN)         │    │  Serverless              │  │
│  │  index.html           │    │  /api/schedule           │  │
│  │  app/*.jsx (Babel)    │    │     │                    │  │
│  │  styles, иконки       │    │     ├─ cheerio parser    │  │
│  └───────────────────────┘    │     ├─ closure detector  │  │
│                                │     └─ HTTP, 8s timeout  │  │
│                                └─────────┬────────────────┘  │
│                                          │                    │
└──────────────────────────────────────────┼────────────────────┘
                                           │
                                           ▼
                                  polessu.by × 4
                                  (HTML Drupal-нод)
```

- **Бекенд** — одна функция `api/schedule.js`. Параллельно тянет 4 страницы через `undici`, прогоняет через `cheerio`-парсеры, возвращает JSON с `schemaVersion: 3`. Кеш CDN на 5 минут (`s-maxage=300, stale-while-revalidate=600`).
- **Парсеры** — общий «табличный экстрактор» + детектор закрытия объекта на ремонт + индивидуальный inline-парсер для гребной базы (там расписание не в таблице, а в `<h1>`). Каждый парсер возвращает либо `{ ok: true, sessions }`, либо `{ ok: false, reason: 'closed' }`.
- **Фронтенд** — React 18, JSX собирается в `app/bundle.js` через **esbuild** (см. `scripts/build.js`). React/ReactDOM грузятся как UMD с unpkg, что выносится из бандла. PWA с service worker'ом (`sw.js`): app-shell cache-first, `/api/schedule` stale-while-revalidate, шрифты Google и React CDN — отдельные кеши.
- **Хранилище** — `localStorage` пользователя. Сервер не знает ни кто вы, ни что вы записали.
- **Diff** — считается на клиенте: текущий снапшот из API vs предыдущий из `localStorage`. События, пересекающиеся с вашими сменами, помечаются `affectsShiftId`.

---

## Стек

| Слой        | Технологии                                      |
|-------------|-------------------------------------------------|
| Фронт       | React 18 (UMD c CDN), esbuild, vanilla CSS, PWA |
| Бекенд      | Node.js 20, Vercel serverless, cheerio, undici  |
| Хостинг     | Vercel Hobby (free)                             |
| Хранилище   | `localStorage` (клиент), CDN-кеш (Vercel Edge)  |
| Тесты       | `node --test` (без зависимостей)                |

> Сборка — только `esbuild` (~10 мс на ребилд). React и ReactDOM external — грузятся UMD с unpkg, в бандл не попадают. На выходе ~21 KB JS gzip + ~10 KB CSS gzip.

---

## Быстрый старт

```bash
# Зависимости
npm i

# Сборка (esbuild → app/bundle.js + app/styles.min.css)
npm run build

# Локальный сервер (Node, без Vercel CLI)
node dev-server.js                # http://localhost:3000

# Watch-режим для разработки (пересборка на сохранении)
node scripts/build.js --watch

# Или через Vercel CLI
npx vercel dev
```

`dev-server.js` — это лёгкий shim на чистом Node, который раздаёт статику и проксирует `/api/schedule` на серверлес-функцию `api/schedule.js`. В прод он не уезжает.

> Не используйте `npm run dev` для Vercel CLI — при наличии скрипта `dev` Vercel считает его командой запуска и падает с «recursive invocation».

---

## Деплой на Vercel

1. Залейте репозиторий на GitHub.
2. На [vercel.com/new](https://vercel.com/new) импортируйте репо — Vercel сам определит, что `api/schedule.js` это функция, а всё остальное — статика.
3. Никаких env-переменных, никакой настройки. Просто Deploy.

Или через CLI:

```bash
npx vercel link        # выбрать имя проекта (только ASCII)
npx vercel --prod
```

После деплоя:

- `/` → `index.html` со статики CDN
- `/api/schedule` → 200, JSON, заголовок `cache-control: s-maxage=300, stale-while-revalidate=600`
- `/api/schedule?refresh=1` → 200, `no-store` — кеш обходится

---

## Тесты

```bash
npm test
```

13 тестов покрывают:

- Детектор «объект закрыт на ремонт» на сохранённых HTML-фикстурах текущего состояния `polessu.by`.
- Извлечение сессий из синтетической таблицы расписания.
- Inline-парсер гребной базы (Пн-Пт × 18:30 + 19:30).
- Исключение дат-выходных вида «1.05.2026 Выходной день».
- Утилиты: `parseTime`, `parseTimeRange`, `weekdayIndex`, `parseDateRange`, `nextDateForWeekday`.

```
✔ closure detector: ice arena (закрыта на ремонт)
✔ closure detector: большой бассейн (отключение горячей воды)
✔ closure detector: малый бассейн
✔ closure detector: не срабатывает на странице с расписанием
✔ rowingBase: исключает дату-выходной из расписания
✔ rowingBase: парсит инлайн-формат "Пн-Пт 18.30-19.30"
✔ sportsPool: фиксирует закрытие на ремонт
✔ sportsPool: парсит синтетическую таблицу
✔ parseTime, parseTimeRange, weekdayIndex, parseDateRange, nextDateForWeekday
ℹ tests 13  pass 13  fail 0
```

---

## Структура

```
.
├── api/
│   ├── schedule.js              # Vercel serverless entry
│   ├── _lib/
│   │   ├── fetcher.js           # undici + timeout
│   │   └── timeParse.js         # время, дни недели, даты
│   └── _parsers/
│       ├── _common.js           # универсальный табличный экстрактор
│       ├── closureNotice.js     # детектор «объект закрыт»
│       ├── iceArena.js
│       ├── sportsPool.js
│       ├── smallPool.js
│       ├── rowingBase.js        # inline-формат
│       ├── index.js             # facilityId → URL + parse
│       ├── __fixtures__/        # сохранённые HTML для тестов
│       └── *.test.js            # node --test
├── app/                         # фронт (React + Babel standalone)
│   ├── main.jsx                 # корневое приложение
│   ├── data.jsx                 # store + diff + парсер-адаптер
│   ├── router.jsx               # iOS-стек с edge-swipe
│   ├── ui.jsx                   # общие примитивы
│   ├── home.jsx                 # экран «Мой график»
│   ├── changes.jsx              # экран «Проверка сайта»
│   ├── editor.jsx               # редактор смены
│   ├── settings.jsx             # настройки + темы
│   └── styles.css               # все стили (одно место)
├── index.html                   # точка входа
├── dev-server.js                # локальный shim (не для прода)
├── vercel.json                  # rewrites + maxDuration
├── manifest.webmanifest         # PWA
└── apple-touch-icon.png + icon-*.png
```

---

## Как работает парсер

Каждая страница на `polessu.by` — это Drupal-нода с контентом внутри `<div class="field-item even" property="content:encoded">`. Парсер:

1. Извлекает корень контента.
2. Прогоняет через `closureNotice.detect()`. Если в тексте найдено `закрыт`, `не работает`, `отключение горячей воды`, `ремонтно-профилактические работы` рядом с диапазоном дат вида `DD.MM.YYYY-DD.MM.YYYY` или `с DD.MM по DD.MM` — возвращает `{ ok: false, reason: 'closed', notice, range }`.
3. Иначе ищет `<table>`. Распознаёт два layout'а:
   - **A:** Дни недели в шапке × слоты времени в строках.
   - **B:** Первая колонка — день недели, остальные — «HH:MM-HH:MM активность».
4. Конвертирует дни недели в ближайшие ISO-даты от `todayIso` (горизонт +7 дней).
5. Время нормализуется: `7.30`, `7:30`, `07-30`, `0730` → `07:30`.

У гребной базы — отдельный inline-парсер: расписание там не в таблице, а в `<h1>` тегах через `<br>`. Также он понимает исключения вроде `1.05.2026 Выходной день`.

---

## Безопасность и приватность

- Сервер хранит только CDN-кеш ответа `/api/schedule` (5 минут). Никаких логов, аналитики, куки.
- Пользовательские данные (смены, журнал проверок, настройки) живут **только в `localStorage` устройства**. Чтобы перенести — скачайте JSON в Настройках и загрузите на другом устройстве.
- Парсер ходит только на 4 фиксированных URL `polessu.by` — ничего больше.

---

## Формат JSON (импорт / экспорт) — version 4

Резервная копия лежит в одном файле. Скачивается через **Настройки → Скачать JSON**, загружается через **Настройки → Загрузить JSON** (либо в EmptyState при первом запуске).

### Структура верхнего уровня

```json
{
  "version": 4,
  "app": "Расписание",
  "exportedAt": "2026-05-23T14:30:00.000Z",
  "timezone": "Europe/Minsk",
  "shifts": [ /* … */ ],
  "siteChanges": { "history": [ /* … */ ] }
}
```

| Поле | Обязательно | Описание |
|---|---|---|
| `version` | да | Версия схемы. Текущая — `4`. |
| `app` | нет | Идентификатор приложения. Для логов. |
| `exportedAt` | нет | ISO-таймстемп создания файла. |
| `timezone` | нет | Зона, в которой считались даты. У нас всегда `Europe/Minsk`. |
| `shifts` | да | Массив смен пользователя. |
| `siteChanges.history` | нет | Журнал сверок с сайтом. При импорте сохраняется как есть. |

### Смена (`shifts[]`)

```json
{
  "id": "s1",
  "date": "2026-05-23",
  "facilityId": "sports_pool",
  "start": "15:00",
  "end": "21:00",
  "activity": "тренировка U-14",
  "source": "shift",
  "instructors": ["lapchuk_as"]
}
```

| Поле | Обязательно | Тип / формат | Что бывает |
|---|---|---|---|
| `id` | нет* | строка | Уникальный id смены. Если отсутствует — сгенерируется автоматически при импорте. |
| `date` | **да** | `YYYY-MM-DD` | Дата смены в зоне Минска. Валидация: точное соответствие шаблону. |
| `facilityId` | **да** | enum | `ice_arena` / `sports_pool` / `small_pool` / `rowing_base`. Другие значения отбрасываются. |
| `start` | **да** | `HH:MM` | Начало смены. |
| `end` | **да** | `HH:MM` | Конец смены. Должен быть строго позже `start`. |
| `activity` | нет | строка | Комментарий / название тренировки. Пустая строка по умолчанию. |
| `source` | нет | `"shift"` / `"site"` | Откуда смена. По умолчанию `"shift"`. |
| `instructors` | нет | `string[]` | id напарников: `lapchuk_as`, `krylychuk_ps`, `melnikova_ov`, `ivshin_my`, `moiseenko_vv`, `karavaychik_kv`. |

\* `id` формально опционален — отсутствие в файле компенсируется генерацией при импорте. Но в экспорте из приложения он всегда есть.

### Валидация при импорте

`Data.importJSON` фильтрует невалидные смены и возвращает `{ importedShifts, skippedShifts, importedChanges }`. Минимальные требования к смене для прохода:

```js
typeof s === 'object'
&& /^\d{4}-\d{2}-\d{2}$/.test(s.date)
&& ['ice_arena','sports_pool','small_pool','rowing_base'].includes(s.facilityId)
&& /^\d{2}:\d{2}$/.test(s.start)
&& /^\d{2}:\d{2}$/.test(s.end)
&& toMinutes(s.end) > toMinutes(s.start)
```

Всё, что не прошло, считается в `skippedShifts` — UI покажет в тосте `Загружено: 7 смен, пропущено 2`.

### Минимальный валидный файл

```json
{
  "version": 4,
  "shifts": [
    {
      "date": "2026-05-23",
      "facilityId": "sports_pool",
      "start": "15:00",
      "end": "21:00"
    }
  ]
}
```

Этого достаточно: `id` сгенерируется, остальные поля получат дефолты.

### Совместимость со старыми форматами

Файлы из ранних версий приложения (например `version: 7` со `staffShifts`, `weeklyDayOffWeekday`, полями `note`/`coworkers`) **не импортируются один-в-один**. Их нужно пересохранить в схему v4 (имена полей: `note` → `activity`, `coworkers` → `instructors`, лишние ключи `staffShifts`/`facilityName` отбросить). Эталонная структура — выше.

---

## Лицензия

MIT. Свободно используйте, изменяйте, форкайте. Это не аффилировано с ПолесГУ.

---

<div align="center">

Сделано как тонкая прослойка между сайтом университета и человеком, которому действительно нужно знать,
когда у него лёд, бассейн или штанга — и совпадает ли это с тем, что обещали.

</div>
