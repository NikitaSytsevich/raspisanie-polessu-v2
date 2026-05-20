// ──────────────────────────────────────────────────────────────────
// app/main.jsx — root App + theme wiring
// ──────────────────────────────────────────────────────────────────

const { useState: _ms, useEffect: _me } = React;

function App() {
  const [settings, setSettings] = _ms(() => window.Data.loadSettings());

  // Resolve "system" theme to dark/light
  _me(() => {
    const apply = () => {
      let theme = settings.theme;
      if (theme === 'system') {
        theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(theme);
    };
    apply();
    if (settings.theme === 'system') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [settings.theme]);

  function handleThemeChange(t) {
    setSettings(window.Data.saveSettings({ theme: t }));
  }

  const screens = {
    home:     () => <window.HomeScreen/>,
    changes:  () => <window.ChangesScreen/>,
    editor:   (props) => <window.EditorScreen {...props}/>,
    settings: () => <window.SettingsScreen onThemeChange={handleThemeChange}/>,
  };

  // home/settings/changes — без аргументов, монтируем при старте и держим
  // в DOM, чтобы переход на них был мгновенным (без mount-лага и без
  // повторного fetchSchedule). editor зависит от props (shiftId/date) —
  // остаётся transient (mount при push, unmount при pop).
  const persistent = ['home', 'settings', 'changes'];

  return (
    <window.UI.ToastHost>
      <window.Router screens={screens} initial="home" persistent={persistent}/>
    </window.UI.ToastHost>
  );
}

ReactDOM.createRoot(document.getElementById('app-root')).render(<App/>);
