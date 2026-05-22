// ──────────────────────────────────────────────────────────────────
// app/ui.jsx — shared primitives (status bar, header, labels, etc)
// ──────────────────────────────────────────────────────────────────

const { useState: _us, useEffect: _ue, useRef: _ur } = React;

// Имитация iOS status bar убрана — в web-приложении не нужна.
// Компонент оставлен как no-op, чтобы не править все экраны.
function StatusBar() { return null; }

function IconBtn({ icon, title, onClick, danger = false, children, className = '' }) {
  return (
    <button
      className={`icon-btn ${danger ? 'is-danger' : ''} ${className}`.trim()}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children || <span className="material-symbols-outlined">{icon}</span>}
    </button>
  );
}

function AppHeader({ left, title, meta, metaImportant = false, right, onBrandClick }) {
  const brandInner = (
    <>
      <span className="brand-name">{title}</span>
      {meta && (
        <span className={`brand-meta ${metaImportant ? 'is-important' : ''}`}>
          <span className="pulse"/>
          <span>{meta}</span>
        </span>
      )}
    </>
  );
  return (
    <header className="app-header">
      {left}
      {onBrandClick ? (
        <button
          type="button"
          className="brand is-clickable"
          onClick={onBrandClick}
          title="О приложении"
          aria-label="О приложении"
        >
          {brandInner}
        </button>
      ) : (
        <div className="brand">{brandInner}</div>
      )}
      {right}
    </header>
  );
}

function SecLabel({ children, hint, count }) {
  return (
    <div className="sec-label">
      <span>{children}</span>
      {count != null && <span className="count">{count}</span>}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// Имитация iOS home-indicator убрана — в web-приложении не нужна.
function HomeIndicator() { return null; }

// ── Toast / Snackbar ────────────────────────────────────────────
const ToastCtx = React.createContext({ show: () => {} });
function useToast() { return React.useContext(ToastCtx); }

function ToastHost({ children }) {
  const [msg, setMsg] = _us(null);
  const timer = _ur(null);
  const show = React.useCallback((text, opts = {}) => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ text, ...opts });
    timer.current = setTimeout(() => setMsg(null), opts.duration || 2400);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className={`toast ${msg ? 'is-on' : ''}`} role="status" aria-live="polite">
        {msg && <span className="toast-text">{msg.text}</span>}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Pull-to-refresh wrapper ────────────────────────────────────
function PullToRefresh({ onRefresh, children, scrollRef }) {
  const [pulled, setPulled] = _us(0);
  const [refreshing, setRefreshing] = _us(false);
  const startY = _ur(null);
  // Зеркала state в ref — чтобы touch-обработчики не перевешивались на
  // каждое движение пальца (раньше deps были [pulled, refreshing], эффект
  // снимал/ставил listener'ы по 30+ раз в секунду во время свайпа).
  const pulledRef = _ur(0);
  const refreshingRef = _ur(false);
  const onRefreshRef = _ur(onRefresh);
  onRefreshRef.current = onRefresh;
  function setPulledBoth(v) { pulledRef.current = v; setPulled(v); }
  function setRefreshingBoth(v) { refreshingRef.current = v; setRefreshing(v); }

  _ue(() => {
    const node = scrollRef?.current;
    if (!node) return;
    function onStart(e) {
      if (node.scrollTop > 4) return;
      const t = e.touches[0];
      startY.current = t.clientY;
    }
    function onMove(e) {
      if (startY.current == null) return;
      const t = e.touches[0];
      const dy = t.clientY - startY.current;
      if (dy > 0 && node.scrollTop <= 0) {
        setPulledBoth(Math.min(dy * 0.55, 80));
        if (e.cancelable && dy > 8) e.preventDefault();
      }
    }
    async function onEnd() {
      if (startY.current == null) return;
      const wasPulled = pulledRef.current;
      startY.current = null;
      if (wasPulled > 50 && !refreshingRef.current) {
        setRefreshingBoth(true);
        setPulledBoth(46);
        try { await onRefreshRef.current?.(); } catch {}
        setRefreshingBoth(false);
        setPulledBoth(0);
      } else {
        setPulledBoth(0);
      }
    }
    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove',  onMove,  { passive: false });
    node.addEventListener('touchend',   onEnd);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove',  onMove);
      node.removeEventListener('touchend',   onEnd);
    };
  }, [scrollRef]);

  const progress = Math.min(1, pulled / 50);
  const ready    = pulled > 50 && !refreshing;
  const rot      = refreshing ? 0 : pulled * 4;
  const opacity  = Math.min(1, pulled / 28);
  // Плавный возврат / «оседание» на 46px — только когда палец отпущен или идёт
  // обновление. Во время активного потягивания транзишн выключен, чтобы
  // позиция следовала за пальцем 1-в-1.
  const settled  = pulled === 0 || refreshing;
  const ptrTransition = settled
    ? 'transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 220ms ease'
    : 'opacity 160ms ease';
  const contentTransition = settled
    ? 'transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)'
    : 'none';
  return (
    <>
      <div
        className={`ptr ${ready ? 'is-ready' : ''} ${refreshing ? 'is-refreshing' : ''}`}
        style={{
          transform: `translateX(-50%) translateY(${pulled - 30}px) rotate(${rot}deg)`,
          opacity,
          transition: ptrTransition,
          ['--ptr-progress']: progress,
        }}
      >
        <span className={`material-symbols-outlined ${refreshing ? 'spin' : ''}`}>refresh</span>
      </div>
      <div style={{ transform: `translateY(${pulled * 0.45}px)`, transition: contentTransition }}>
        {children}
      </div>
    </>
  );
}

// ── Confirm sheet (общий компонент для editor и settings) ──────
// Раньше жил в editor.jsx, а settings.jsx использовал нативный confirm()
// и UX рвался — теперь единая шторка с заголовком, иконкой и dangerCTA.
function ConfirmSheet({ icon = 'help', title, body, confirm = 'Подтвердить', cancel = 'Отмена', danger = false, onConfirm, onCancel }) {
  _ue(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="confirm-root" role="dialog" aria-modal="true" aria-labelledby="cfm-title">
      <div className="confirm-backdrop" onClick={onCancel}/>
      <div className="confirm-sheet">
        <div className={`confirm-icon ${danger ? 'is-danger' : ''}`}>
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <h2 id="cfm-title" className="confirm-title">{title}</h2>
        {body && <p className="confirm-body">{body}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>{cancel}</button>
          <button type="button" className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

window.UI = { StatusBar, IconBtn, AppHeader, SecLabel, HomeIndicator, ToastHost, useToast, PullToRefresh, ConfirmSheet };
