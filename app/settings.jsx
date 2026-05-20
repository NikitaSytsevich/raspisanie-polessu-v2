// ──────────────────────────────────────────────────────────────────
// app/settings.jsx — settings screen
// ──────────────────────────────────────────────────────────────────

const { useState: _ss, useEffect: _se } = React;

function SettingsScreen({ onThemeChange }) {
  const router = window.useRouter();
  const toast = window.UI.useToast();
  const [settings, setSettings] = _ss(() => window.Data.loadSettings());

  function setTheme(t) {
    const next = window.Data.saveSettings({ theme: t });
    setSettings(next);
    onThemeChange?.(t);
  }

  function handleExport() {
    const blob = new Blob([window.Data.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raspisanie-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.show('JSON скачан');
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
        window.Data.importJSON(text);
        toast.show('JSON загружен');
      } catch (e) {
        toast.show('Не удалось прочитать файл');
      }
    };
    input.click();
  }

  function handleDelete() {
    if (!confirm('Удалить весь график и журнал проверок? Это действие нельзя отменить.')) return;
    window.Data.clearShifts();
    window.Data.saveSiteChanges([]);
    toast.show('История удалена');
  }

  return (
    <div className="screen settings-screen">
      <window.UI.StatusBar/>

      <window.UI.AppHeader
        left={<window.UI.IconBtn icon="arrow_back" title="Назад" onClick={() => router.pop()}/>}
        title="Настройки"
        meta="тема, резерв"
      />

      <div className="screen-scroll">
        <section className="hero">
          <p className="hero-kicker">Расписание</p>
          <h1 className="hero-title">Под&nbsp;<em>себя</em>.</h1>
          <p className="hero-meta">
            Все настройки и история смен живут <strong>только в этом браузере</strong>.
            Чтобы перенести&nbsp;— скачайте JSON и загрузите на другом устройстве.
          </p>
        </section>

        <window.UI.SecLabel hint={`сейчас — ${settings.theme === 'dark' ? 'тёмная' : 'светлая'}`}>Тема</window.UI.SecLabel>
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

        <window.UI.SecLabel>Данные</window.UI.SecLabel>
        <section className="list">
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
          <a className="row is-danger" onClick={handleDelete}>
            <span className="ic"><span className="material-symbols-outlined">delete</span></span>
            <div className="body">
              <p className="lbl">Удалить историю</p>
              <span className="hint">очистит все смены и журнал проверок</span>
            </div>
            <span className="material-symbols-outlined chev">chevron_right</span>
          </a>
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

        <window.UI.SecLabel>О приложении</window.UI.SecLabel>
        <section className="about">
          <p className="about-kicker">Где живут данные</p>
          <p>
            Смены, журнал проверок и настройки хранятся <strong>локально</strong>&nbsp;—
            в этом браузере. Сервер только парсит сайт ПолесГУ и возвращает свежее
            расписание; он не знает <strong>кто вы</strong> и <strong>что вы записали</strong>.
          </p>
          <p>
            Чтобы перенести на другое устройство&nbsp;— <strong>скачайте JSON</strong>
            и загрузите его там. Это и есть «облако».
          </p>
          <div className="meta">
            <span>Расписание <strong>v1.4</strong></span>
            <span>часовой пояс <strong>Europe/Minsk</strong></span>
          </div>
        </section>

        <window.UI.HomeIndicator/>
      </div>
    </div>
  );
}

window.SettingsScreen = SettingsScreen;
