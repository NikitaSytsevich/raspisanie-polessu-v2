// ──────────────────────────────────────────────────────────────────
// app/ui.jsx — shared primitives (status bar, header, labels, etc)
// ──────────────────────────────────────────────────────────────────

const { useState: _us, useEffect: _ue, useRef: _ur } = React;

// Имитация iOS status bar убрана — в web-приложении не нужна.
// Компонент оставлен как no-op, чтобы не править все экраны.
function StatusBar() { return null; }

function IconBtn({ icon, title, onClick, danger = false, children }) {
  return (
    <button
      className={`icon-btn ${danger ? 'is-danger' : ''}`}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children || <span className="material-symbols-outlined">{icon}</span>}
    </button>
  );
}

function AppHeader({ left, title, meta, metaImportant = false, right }) {
  return (
    <header className="app-header">
      {left}
      <div className="brand">
        <span className="brand-name">{title}</span>
        {meta && (
          <span className={`brand-meta ${metaImportant ? 'is-important' : ''}`}>
            <span className="pulse"/>
            <span>{meta}</span>
          </span>
        )}
      </div>
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
        setPulled(Math.min(dy * 0.55, 80));
        if (e.cancelable && dy > 8) e.preventDefault();
      }
    }
    async function onEnd() {
      if (startY.current == null) return;
      const wasPulled = pulled;
      startY.current = null;
      if (wasPulled > 50 && !refreshing) {
        setRefreshing(true);
        setPulled(46);
        try { await onRefresh?.(); } catch {}
        setRefreshing(false);
        setPulled(0);
      } else {
        setPulled(0);
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
  }, [scrollRef, pulled, refreshing, onRefresh]);

  const opacity = Math.min(1, pulled / 50);
  const rot = pulled * 5;
  return (
    <>
      <div className="ptr" style={{
        transform: `translateX(-50%) translateY(${pulled - 30}px) rotate(${rot}deg)`,
        opacity,
      }}>
        <span className={`material-symbols-outlined ${refreshing ? 'spin' : ''}`}>refresh</span>
      </div>
      <div style={{ transform: `translateY(${pulled * 0.45}px)`, transition: pulled ? 'none' : 'transform 220ms ease' }}>
        {children}
      </div>
    </>
  );
}

window.UI = { StatusBar, IconBtn, AppHeader, SecLabel, HomeIndicator, ToastHost, useToast, PullToRefresh };
