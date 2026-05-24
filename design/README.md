# Прототипы для Claude Design

Эта папка — рабочее пространство для итераций дизайна через Claude Design.
В прод не уезжает (см. `.vercelignore`), `npm run build` её не трогает.

## Что внутри

### Отдельные мокапы экранов
Самодостаточные HTML с собственным CSS и `tweaks-panel` для live-редактирования
переменных в Claude Design. Источник для дизайн-итераций — править их, не настоящий
код `app/*.jsx`.

- `Главный экран.html` — соответствует [`app/home.jsx`](../app/home.jsx)
- `Настройки.html` — [`app/settings.jsx`](../app/settings.jsx)
- `Проверка сайта.html` — [`app/changes.jsx`](../app/changes.jsx)
- `Редактор смен.html` — [`app/editor.jsx`](../app/editor.jsx)

### Превью реального приложения
- `Расписание.html` — точка входа в живой `app/` через `babel-standalone` (без сборки).
  Подключает настоящие `../app/*.jsx` и `../app/styles.css`. Полезно убедиться,
  что после переноса дизайна в код всё сходится.

### Хелперы
- `tweaks-panel.jsx` — общая Tweaks-shell (slider/radio/stepper) + host-протокол
  Claude Design (`__activate_edit_mode` и т.д.). Подключается мокапами.
- `ios-frame.jsx` — рамка iOS 26 (status bar, nav bar, glass pill, list). Не подключён
  по умолчанию — добавляйте `<script type="text/babel" src="ios-frame.jsx"></script>`
  туда, где нужен device frame.

## Как итерировать

1. Открываете нужный HTML в Claude Design.
2. Меняете дизайн в мокапе (визуал, переменные через Tweaks).
3. Переносите изменения в соответствующий `app/<screen>.jsx` и `app/styles.css`.
4. Проверяете живьём через `Расписание.html` или `npm run build && node dev-server.js`.
