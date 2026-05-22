// ──────────────────────────────────────────────────────────────────
// app/router.jsx — стек-роутер БЕЗ анимаций переходов.
//
// Версия 6 — persistent + transient экраны + корректная forward-навигация.
//
// PERSISTENT экраны (по списку, по умолчанию ['home']):
//   • Монтируются один раз на старте приложения и остаются в DOM.
//   • Переходы между ними — только переключение классов .is-top / .is-beneath
//     (мгновенно, без mount-лага).
//   • Подходит для экранов без props (главная, настройки, и т.п.).
//
// TRANSIENT экраны:
//   • Монтируются при push и unmount-ятся при pop.
//   • Принимают произвольные props (editor с конкретным shiftId/date).
//   • При forward-навигации (back→forward) восстанавливаются из
//     history.state.props.
//
// История браузера:
//   • mount → history.replaceState({__rs, name, depth, props})
//   • push  → history.pushState({__rs, name, depth, props})
//   • pop / системный back → history.back() + suppressPopRef
//   • popstate сравнивает state.depth с длиной стека:
//       targetDepth < cur.length → back  (укоротить стек)
//       targetDepth > cur.length → forward (восстановить экран из state)
//       без __rs → sentinel: блокируем выход с корня
//
// Экспорт:
//   window.useRouter() → { route, push, pop, replace, depth }
//   window.Router → <Router screens={{...}} initial="home"
//                            persistent={['home','settings',...]} />
// ──────────────────────────────────────────────────────────────────

const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

const RouterCtx = createContext(null);
const useRouter = () => useContext(RouterCtx);

let __idCounter = 0;
function makeId() { return 't_' + Date.now() + '_' + (++__idCounter); }
function persistentId(name) { return 'p_' + name; }

function Router({ screens, persistent = [], initial = 'home', initialProps = {} }) {
  const persistentSet = persistent; // массив имён, обычно ['home','settings','changes']
  const isPersistent = (name) => persistentSet.includes(name);

  function makeEntry(name, props = {}) {
    const p = isPersistent(name);
    return {
      id: p ? persistentId(name) : makeId(),
      name,
      props: p ? {} : props,
      persistent: p,
    };
  }

  const [stack, setStack] = useState(() => {
    const hashName = (window.location.hash || '').replace('#', '').trim();
    const startName = hashName && screens[hashName] ? hashName : initial;
    return [makeEntry(startName, initialProps)];
  });
  const top = stack[stack.length - 1];

  // Зеркало state для popstate-обработчика.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  // popstate, который мы сами спровоцировали (history.back) — игнорируем.
  const suppressPopRef = useRef(false);

  // ── История браузера ────────────────────────────────────────────
  useEffect(() => {
    if (!history.state || !history.state.__rs) {
      history.replaceState(
        { __rs: true, name: top.name, depth: 1, props: top.props || {} },
        '',
        '#' + top.name
      );
    }
    function onPopState() {
      if (suppressPopRef.current) {
        suppressPopRef.current = false;
        return;
      }
      const s = history.state;
      if (s && s.__rs && typeof s.depth === 'number' && screens[s.name]) {
        const targetDepth = s.depth;
        const cur = stackRef.current;
        if (targetDepth < cur.length) {
          // BACK: укоротить стек до targetDepth.
          const next = cur.slice(0, targetDepth);
          if (next.length >= 1) {
            stackRef.current = next;
            setStack(next);
          }
          return;
        }
        if (targetDepth > cur.length) {
          // FORWARD: восстановить экран из history.state.
          // Если screen persistent — добавляем persistent entry (он всё равно
          // уже mounted, просто меняем top).
          // Если transient — создаём новый instance с props из history.
          const entry = makeEntry(s.name, s.props || {});
          // Для persistent: если он уже в стеке (например, ниже), переместим наверх.
          const cur2 = stackRef.current;
          let next;
          if (entry.persistent) {
            const idx = cur2.findIndex(e => e.name === entry.name);
            if (idx >= 0 && idx !== cur2.length - 1) {
              next = [...cur2.slice(0, idx), ...cur2.slice(idx + 1), cur2[idx]];
            } else if (idx === cur2.length - 1) {
              return; // уже наверху
            } else {
              next = [...cur2, entry];
            }
          } else {
            next = [...cur2, entry];
          }
          stackRef.current = next;
          setStack(next);
          return;
        }
        // targetDepth === cur.length — тот же уровень. Обычно ничего не
        // делаем, но после router.replace(...) текущий слот истории мог
        // получить depth=1 поверх старого editor(d=2), и тогда системный
        // back переходит на home(d=1) — здесь оказываемся с тем же depth,
        // но другим именем экрана. В этой ветке заменяем top entry.
        if (cur.length > 0 && cur[cur.length - 1].name !== s.name) {
          const entry = makeEntry(s.name, s.props || {});
          let next;
          if (entry.persistent) {
            const idx = cur.findIndex(e => e.name === entry.name);
            if (idx >= 0) {
              if (idx === cur.length - 1) return;
              next = [...cur.slice(0, idx), ...cur.slice(idx + 1), cur[idx]];
            } else {
              next = [...cur.slice(0, -1), entry];
            }
          } else {
            next = [...cur.slice(0, -1), entry];
          }
          stackRef.current = next;
          setStack(next);
        }
        return;
      }
      // Нет нашего state — попытка покинуть приложение.
      if (stackRef.current.length <= 1) {
        // Стартовая страница — sentinel-блок: возвращаем себя в историю.
        const cur = stackRef.current[0];
        history.pushState(
          { __rs: true, name: cur.name, depth: 1, props: cur.props || {} },
          '',
          '#' + cur.name
        );
        return;
      }
      // Внутренний pop на не-корне с unknown history.state — просто откатываем.
      const next = stackRef.current.slice(0, -1);
      stackRef.current = next;
      setStack(next);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ── Navigation API ──────────────────────────────────────────────
  const push = useCallback((name, props = {}) => {
    if (!screens[name]) return;
    const cur = stackRef.current;
    const entry = makeEntry(name, props);

    let next;
    if (entry.persistent) {
      const idx = cur.findIndex(e => e.name === name);
      if (idx === cur.length - 1) return; // уже наверху, no-op
      if (idx >= 0) {
        // Перенести существующий persistent наверх (без ремаунта — id тот же).
        next = [...cur.slice(0, idx), ...cur.slice(idx + 1), cur[idx]];
      } else {
        next = [...cur, entry];
      }
    } else {
      next = [...cur, entry];
    }
    stackRef.current = next;
    history.pushState(
      { __rs: true, name, depth: next.length, props: entry.persistent ? {} : props },
      '',
      '#' + name
    );
    setStack(next);
  }, [screens]);

  const pop = useCallback(() => {
    const cur = stackRef.current;
    if (cur.length <= 1) {
      // Стэк пуст / в нём ровно один экран. Раньше тут был тихий return,
      // из-за чего pop() из editor (открытого через router.replace из recent-row)
      // ничего не делал — экран «висел». Теперь fallback на initial (home).
      const onlyTop = cur[0];
      if (onlyTop && onlyTop.name !== initial && screens[initial]) {
        const entry = makeEntry(initial);
        const next = [entry];
        stackRef.current = next;
        history.replaceState(
          { __rs: true, name: entry.name, depth: 1, props: {} },
          '',
          '#' + entry.name
        );
        setStack(next);
      }
      return;
    }
    suppressPopRef.current = true;
    history.back();
    const next = cur.slice(0, -1);
    stackRef.current = next;
    setStack(next);
  }, [initial, screens]);

  const replace = useCallback((name, props = {}) => {
    if (!screens[name]) return;
    const entry = makeEntry(name, props);
    const next = [entry];
    stackRef.current = next;
    history.replaceState(
      { __rs: true, name, depth: 1, props: entry.persistent ? {} : props },
      '',
      '#' + name
    );
    setStack(next);
  }, [screens]);

  // ── Render ──────────────────────────────────────────────────────
  // Persistent экраны рендерятся ВСЕ и ВСЕГДА (по списку persistent),
  // в фиксированном порядке. Transient экраны рендерятся только если они в стеке,
  // в порядке стека.
  //
  // Текущий top (.is-top) — это последний элемент стека. Всё остальное .is-beneath
  // (display:none в CSS, но React-state сохраняется).
  const ctx = { route: top, push, pop, replace, depth: stack.length };

  const transientInStack = stack.filter(e => !e.persistent);
  // top по id, чтобы корректно сравнивать persistent (тот же id всегда) и transient.
  const topId = top.id;

  return (
    <RouterCtx.Provider value={ctx}>
      <div className="router-stack">
        {persistentSet.map(name => {
          if (!screens[name]) return null;
          const Screen = screens[name];
          const id = persistentId(name);
          const isTop = id === topId;
          return (
            <div
              key={id}
              className={`router-screen ${isTop ? 'is-top' : 'is-beneath'}`}
            >
              <Screen />
            </div>
          );
        })}
        {transientInStack.map(entry => {
          const Screen = screens[entry.name];
          const isTop = entry.id === topId;
          return (
            <div
              key={entry.id}
              className={`router-screen ${isTop ? 'is-top' : 'is-beneath'}`}
            >
              <Screen {...entry.props} />
            </div>
          );
        })}
      </div>
    </RouterCtx.Provider>
  );
}

window.useRouter = useRouter;
window.Router = Router;
