// ──────────────────────────────────────────────────────────────────
// app/settings.jsx — settings screen
//
// Структура: hero → вкладки (Общие / Данные / Связь) → панель вкладки.
//   • Общие  — тема оформления + «о приложении».
//   • Данные — статистика, экспорт (.ics / JSON), импорт, удаление.
//   • Связь  — Telegram-бот с ключом синхронизации + источники расписаний.
// Инструкторы здесь больше не редактируются — каталог целиком живёт
// в редакторе смен (чипы «с кем работаю» с инлайн-добавлением).
// ──────────────────────────────────────────────────────────────────

const { useState: _ss, useRef: _sr } = React;

const SETTINGS_TABS = [
  { id: 'general', icon: 'tune',     label: 'Общие'  },
  { id: 'data',    icon: 'database', label: 'Данные' },
  { id: 'sync',    icon: 'send',     label: 'Связь'  },
];

const THEME_NAMES = { dark: 'тёмная', light: 'светлая', system: 'системная' };

function SettingsScreen({ onThemeChange }) {
  const router = window.useRouter();
  const toast = window.UI.useToast();
  const [settings, setSettings] = _ss(() => window.Data.loadSettings());
  const [confirmDelete, setConfirmDelete] = _ss(false);
  const [tab, setTab] = _ss('general');
  const [syncKey, setSyncKey] = _ss(() => window.Data.loadSettings().botSyncKey || '');
  const [syncBusy, setSyncBusy] = _ss(false);
  const scrollRef = _sr(null);

  // Экран persistent (живёт в DOM постоянно), так что выбранная вкладка
  // переживает уходы с экрана. Панели разной высоты — при переключении
  // возвращаемся к началу, чтобы не оказаться на «дне» короткой панели.
  function switchTab(id) {
    if (id === tab) return;
    setTab(id);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  // Экспорт смен в системный календарь (.ics). Время в UTC: Минск =
  // UTC+3 без сезонных переходов, см. buildICS в _logic.js.
  function handleExportICS() {
    try {
      if (!window.Data.loadShifts().length) {
        toast.show('Смен пока нет — нечего экспортировать');
        return;
      }
      const blob = new Blob([window.Data.exportICS()], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raspisanie-${new Date().toISOString().slice(0, 10)}.ics`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
      toast.show('Календарь .ics скачан');
    } catch (e) {
      toast.show('Не удалось сохранить файл');
    }
  }

  function setTheme(t) {
    const next = window.Data.saveSettings({ theme: t });
    setSettings(next);
    onThemeChange?.(t);
  }

  function handleExport() {
    try {
      const blob = new Blob([window.Data.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raspisanie-${new Date().toISOString().slice(0, 10)}.json`;
      // Firefox требует, чтобы anchor был в DOM; iOS Safari может проигнорить
      // click сразу после revokeObjectURL — поэтому ревок делаем в setTimeout.
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
      toast.show('JSON скачан');
    } catch (e) {
      toast.show('Не удалось сохранить файл');
    }
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const res = window.Data.importJSON(text);
        const parts = [];
        if (res.importedShifts) parts.push(`${res.importedShifts} ${pluralizeShifts(res.importedShifts)}`);
        if (res.skippedShifts)  parts.push(`пропущено ${res.skippedShifts}`);
        if (!res.importedShifts && !res.skippedShifts && res.importedChanges) parts.push('журнал сверок');
        toast.show(parts.length ? `Загружено: ${parts.join(', ')}` : 'Файл прочитан, но смен не найдено');
      } catch (e) {
        toast.show('Не удалось прочитать файл');
      }
    };
    input.click();
  }

  // Local plural — settings не импортирует pluralizeShifts из home, поэтому
  // дублируем (всего 5 строк, не повод выносить в data).
  function pluralizeShifts(n) {
    const last = n % 10, last2 = n % 100;
    if (last === 1 && last2 !== 11) return 'смена';
    if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'смены';
    return 'смен';
  }

  // Сохранить ключ и сразу проверить его пробным синком. Пустой ключ —
  // отключение синхронизации (бот перестанет видеть смены после
  // следующего обновления списка на сервере).
  async function handleSaveSyncKey() {
    const key = syncKey.trim();
    window.Data.saveSettings({ botSyncKey: key });
    if (!key) {
      toast.show('Синхронизация с ботом выключена');
      return;
    }
    setSyncBusy(true);
    const r = await window.Data.syncShiftsToBot();
    setSyncBusy(false);
    if (r.ok) toast.show('Связано! Смены отправлены боту');
    else if (r.reason === 'bad_key') toast.show('Ключ не подошёл — проверьте его');
    else if (r.reason === 'not_configured') toast.show('Синк не настроен на сервере');
    else toast.show('Нет сети — попробуем при следующем изменении смен');
  }

  function handleDelete() {
    setConfirmDelete(true);
  }
  function performDelete() {
    window.Data.clearShifts();
    window.Data.saveSiteChanges([]);
    setConfirmDelete(false);
    toast.show('История удалена');
  }

  return (
    <div className="screen settings-screen">
      <window.UI.StatusBar/>

      <window.UI.AppHeader
        left={<window.UI.IconBtn icon="arrow_back" title="Назад" onClick={() => router.pop()}/>}
        title="Настройки"
        meta="тема · данные · бот"
      />

      <div className="screen-scroll" ref={scrollRef}>
        <section className="hero">
          <p className="hero-kicker">Расписание</p>
          <h1 className="hero-title">Под&nbsp;<em>себя</em>.</h1>
          <p className="hero-meta">
            Все настройки и история смен живут <strong>только в этом браузере</strong>.
            Перенос на другое устройство&nbsp;— через JSON во вкладке «Данные».
          </p>
        </section>

        <nav className="set-tabs" role="tablist" aria-label="Разделы настроек">
          {SETTINGS_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`set-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => switchTab(t.id)}
            >
              <span className="material-symbols-outlined">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {tab === 'general' && (
          <div className="set-pane" key="general">
            <window.UI.SecLabel hint={`сейчас — ${THEME_NAMES[settings.theme] || THEME_NAMES.dark}`}>Тема</window.UI.SecLabel>
            <div className="theme-row">
              {[
                { value: 'light',  name: 'Светлая',   hint: 'днём' },
                { value: 'dark',   name: 'Тёмная',    hint: 'вечером' },
                { value: 'system', name: 'Системная', hint: 'авто' },
              ].map(t => (
                <button
                  key={t.value}
                  type="button"
                  className={`theme-card ${settings.theme === t.value ? 'is-active' : ''}`}
                  onClick={() => setTheme(t.value)}
                >
                  <span className={`theme-swatch ${t.value}`}>
                    {t.value === 'system' && <span className="split"/>}
                  </span>
                  <span className="name">{t.name}</span>
                  <span className="hint">{t.hint}</span>
                </button>
              ))}
            </div>

            <window.UI.SecLabel>О приложении</window.UI.SecLabel>
            <section className="about">
              <p className="about-kicker">Где живут данные</p>
              <p>
                Смены, журнал проверок и настройки хранятся <strong>локально</strong>&nbsp;—
                в этом браузере. Сервер только парсит сайт ПолесГУ и возвращает свежее
                расписание; он не знает <strong>кто вы</strong> и <strong>что вы записали</strong>.
              </p>
              <p>
                Чтобы перенести на другое устройство&nbsp;— <strong>скачайте JSON</strong>{' '}
                и загрузите его там. Это и есть «облако».
              </p>
              <div className="meta">
                <span>Расписание <strong>v1.5</strong></span>
                <span>часовой пояс <strong>Europe/Minsk</strong></span>
              </div>
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="set-pane" key="data">
            <window.UI.SecLabel hint="резерв и экспорт">Данные</window.UI.SecLabel>
            <section className="list">
              <a className="row" onClick={() => router.push('stats')}>
                <span className="ic"><span className="material-symbols-outlined">bar_chart</span></span>
                <div className="body">
                  <p className="lbl">Статистика часов</p>
                  <span className="hint">отработано за неделю и месяц · CSV</span>
                </div>
                <span className="material-symbols-outlined chev">chevron_right</span>
              </a>
              <a className="row" onClick={handleExportICS}>
                <span className="ic"><span className="material-symbols-outlined">event</span></span>
                <div className="body">
                  <p className="lbl">Экспорт в календарь (.ics)</p>
                  <span className="hint">смены — в календарь телефона</span>
                </div>
                <span className="material-symbols-outlined chev">chevron_right</span>
              </a>
              <a className="row" onClick={handleExport}>
                <span className="ic"><span className="material-symbols-outlined">download</span></span>
                <div className="body">
                  <p className="lbl">Скачать JSON</p>
                  <span className="hint">резервная копия графика и истории</span>
                </div>
                <span className="material-symbols-outlined chev">chevron_right</span>
              </a>
              <a className="row" onClick={handleImport}>
                <span className="ic"><span className="material-symbols-outlined">upload</span></span>
                <div className="body">
                  <p className="lbl">Загрузить JSON</p>
                  <span className="hint">заменить текущий график файлом</span>
                </div>
                <span className="material-symbols-outlined chev">chevron_right</span>
              </a>
            </section>

            <window.UI.SecLabel hint="необратимо">Опасная зона</window.UI.SecLabel>
            <section className="list">
              <a className="row is-danger" onClick={handleDelete}>
                <span className="ic"><span className="material-symbols-outlined">delete</span></span>
                <div className="body">
                  <p className="lbl">Удалить историю</p>
                  <span className="hint">очистит все смены и журнал проверок</span>
                </div>
                <span className="material-symbols-outlined chev">chevron_right</span>
              </a>
            </section>
          </div>
        )}

        {tab === 'sync' && (
          <div className="set-pane" key="sync">
            <window.UI.SecLabel hint="@Raspisanie_polessu_bot">Telegram-бот</window.UI.SecLabel>
            <section className="list">
              <a className="row" href="https://t.me/Raspisanie_polessu_bot" target="_blank" rel="noopener">
                <span className="ic"><span className="material-symbols-outlined">send</span></span>
                <div className="body">
                  <p className="lbl">Открыть бота</p>
                  <span className="hint">/today, /tomorrow, /status, /subscribe</span>
                </div>
                <span className="material-symbols-outlined chev">open_in_new</span>
              </a>
              <div className="row is-static field-row">
                <input
                  className="field-input"
                  placeholder="Ключ синхронизации"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                  value={syncKey}
                  onChange={e => setSyncKey(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveSyncKey(); }}
                />
                <button
                  type="button"
                  className="field-btn"
                  onClick={handleSaveSyncKey}
                  disabled={syncBusy}
                >
                  <span className={`material-symbols-outlined ${syncBusy ? 'spin' : ''}`}>{syncBusy ? 'progress_activity' : 'sync'}</span>
                  <span>Связать</span>
                </button>
              </div>
              <p className="sync-note">
                С ключом приложение отправляет копию смен на сервер, и бот помечает
                изменения сайта, задевающие <strong>ваши</strong> смены
                («⚠️ ваша смена»). Без ключа бот шлёт только общие изменения.
              </p>
            </section>

            <window.UI.SecLabel hint="4 объекта">Источники</window.UI.SecLabel>
            <section className="list">
              {window.Data.FACILITIES.map(f => (
                <a key={f.id} className={`src-row ${f.id === 'rowing_base' ? 'tmpl' : 'ok'}`} href={f.sourceUrl} target="_blank" rel="noopener">
                  <span className="dot"/>
                  <span className="name">{f.name}</span>
                  <span className="status">{f.id === 'rowing_base' ? 'шаблон' : 'ок'}</span>
                </a>
              ))}
            </section>
          </div>
        )}

        <window.UI.HomeIndicator/>
      </div>

      {confirmDelete && (
        <window.UI.ConfirmSheet
          icon="delete"
          title="Удалить всю историю?"
          body="Сотрутся все смены и журнал проверок. Действие нельзя отменить."
          confirm="Удалить"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={performDelete}
        />
      )}
    </div>
  );
}

window.SettingsScreen = SettingsScreen;
