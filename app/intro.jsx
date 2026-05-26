// ──────────────────────────────────────────────────────────────────
// app/intro.jsx — splash-overlay при холодном старте приложения
//
// Перенесено из design/intro.jsx (Claude Design прототип). Stage
// scrubber и контекст времени убраны — здесь нужен только однопроходный
// RAF-таймер на ~4 секунды с автоматическим unmount.
//
// Компоненты получают текущее время t (сек от старта) пропом, без
// контекста — проще и меньше связности.
//
// Внутренние координаты остались 540×1170 как в дизайне; контент
// масштабируется в viewport через CSS transform (см. .intro-stage).
// ──────────────────────────────────────────────────────────────────

(function () {
  const { useEffect: _ie, useState: _is } = React;

  // ── Геометрия / тайминги ───────────────────────────────────────
  const W = 540;
  const H = 1170;
  const DURATION = 4.0;        // длительность анимации (с)
  const FADE_OUT_MS = 280;     // CSS fade overlay перед unmount

  // ── Палитра в зависимости от темы ──────────────────────────────
  // Заставка рисует много инлайн-стилей с hex/rgba: CSS-переменные
  // через `var(--…)` в SVG-фильтрах / линейных градиентах работают
  // через раз, поэтому раз вычисляем «снэпшот» цветов из активной
  // темы и пробрасываем его пропом `pal` в каждый sub-компонент.
  function makePalette(theme) {
    if (theme === 'light') {
      return {
        // Background
        BG:           '#f5f1eb',
        BG_TOP:       '#fbf6ef',
        // Text
        TEXT:         '#181513',
        TEXT_MUTED:   '#5a544c',
        TEXT_SUBTLE:  '#8a847a',
        // Accent
        ACCENT:       '#c96442',
        ACCENT_DEEP:  '#9c441f',
        ACCENT_GLOW:  'rgba(201, 100, 66, 0.22)',
        // Decorative layers
        GRAIN:        'rgba(24, 21, 19, 0.35)',
        GRAIN_BLEND:  'multiply',
        VIGNETTE:     'radial-gradient(120% 80% at 50% 0%, transparent 50%, rgba(168, 122, 58, 0.12) 100%)',
        // Card
        CARD_BG:      'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(248,243,236,0.98) 100%)',
        CARD_BORDER:  'rgba(24, 21, 19, 0.10)',
        CARD_SHADOW:
          '0 22px 50px -20px rgba(75, 50, 30, 0.22),' +
          '0 8px 20px -8px rgba(75, 50, 30, 0.14),' +
          '0 1px 0 0 rgba(255, 255, 255, 0.7) inset,' +
          '0 -1px 0 0 rgba(24, 21, 19, 0.05) inset',
        CARD_DIVIDER: 'rgba(24, 21, 19, 0.08)',
        // Loading hint
        TRACK_BG:     'rgba(24, 21, 19, 0.10)',
        // Per-facility tints
        ICE:          '#4a7da3',
        POOL:         '#3f8276',
        ROWING:       '#a87a3a',
      };
    }
    // dark — оригинальная палитра
    return {
      BG:           '#181513',
      BG_TOP:       '#1d1815',
      TEXT:         '#f5f1eb',
      TEXT_MUTED:   '#a8a098',
      TEXT_SUBTLE:  '#6b665f',
      ACCENT:       '#d97757',
      ACCENT_DEEP:  '#b3522f',
      ACCENT_GLOW:  'rgba(217, 119, 87, 0.34)',
      GRAIN:        'rgba(255, 255, 255, 0.40)',
      GRAIN_BLEND:  'overlay',
      VIGNETTE:     'radial-gradient(120% 80% at 50% 0%, transparent 50%, rgba(0,0,0,0.45) 100%)',
      CARD_BG:      'linear-gradient(165deg, rgba(46,41,36,0.96) 0%, rgba(28,25,22,0.96) 100%)',
      CARD_BORDER:  'rgba(245, 241, 235, 0.09)',
      CARD_SHADOW:
        '0 30px 60px -18px rgba(0,0,0,0.7),' +
        '0 12px 28px -10px rgba(0,0,0,0.5),' +
        '0 1px 0 0 rgba(245,241,235,0.07) inset,' +
        '0 -1px 0 0 rgba(0,0,0,0.25) inset',
      CARD_DIVIDER: 'rgba(245, 241, 235, 0.08)',
      TRACK_BG:     'rgba(245, 241, 235, 0.08)',
      ICE:          '#8ab4d4',
      POOL:         '#7dbbb0',
      ROWING:       '#d4a76e',
    };
  }

  function readTheme() {
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  }

  // ── Easing-хелперы (минимальный набор, нужный для сцены) ───────
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
  const easeOutCubic   = (t) => (--t) * t * t + 1;
  const easeInOutCubic = (t) => (t < 0.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1);
  const easeOutBack    = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
  };

  // ── Background — тёплый фон + дышащий радиальный glow ──────────
  function Background({ t, pal }) {
    // glow раскрывается до t=1.0, потом мягко «дышит»
    const glowIn = t <= 0 ? 0 : t >= 1.0 ? 1 : easeOutCubic(t / 1.0);
    const breathe = 0.85 + 0.15 * Math.sin((t / DURATION) * Math.PI * 2 - Math.PI / 2);
    const glow = glowIn * breathe;

    const cy = H * 0.46;
    // Парный «дальний» оттенок accent-glow для радиального градиента —
    // на 0.08 alpha без рассчёта на парсинг hex: производное от accent.
    const glowFar = pal.ACCENT_GLOW.replace(/[\d.]+\)$/, '0.08)');

    return (
      <>
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(180deg, ${pal.BG_TOP} 0%, ${pal.BG} 55%, ${pal.BG} 100%)`,
        }}/>
        <div style={{
          position: 'absolute', inset: 0,
          opacity: 0.04,
          backgroundImage: `radial-gradient(${pal.GRAIN} 1px, transparent 1px)`,
          backgroundSize: '3px 3px',
          mixBlendMode: pal.GRAIN_BLEND,
        }}/>
        <div style={{
          position: 'absolute',
          left: W / 2, top: cy,
          width: 900, height: 900,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle at center, ${pal.ACCENT_GLOW} 0%, ${glowFar} 35%, transparent 65%)`,
          opacity: glow,
          filter: 'blur(8px)',
          pointerEvents: 'none',
        }}/>
        <div style={{
          position: 'absolute', inset: 0,
          background: pal.VIGNETTE,
          pointerEvents: 'none',
        }}/>
      </>
    );
  }

  // ── Карточка смены (мини-представление shift'а) ────────────────
  function ShiftCard({
    t, pal, tint, day, dateNum, time, activity, facility,
    inAt, stackY, rotZ = 0, z = 1, showCheck = false,
  }) {
    const inDur = 0.7;
    const localT = clamp((t - inAt) / inDur, 0, 1);
    const eased  = easeOutBack(localT);

    let opacity = 0;
    let y = 220;
    let scale = 0.92;
    let rot = rotZ + (1 - localT) * (rotZ > 0 ? -4 : rotZ < 0 ? 4 : -6);

    if (t >= inAt) {
      opacity = clamp(localT * 1.6, 0, 1);
      y = (1 - eased) * 220;
      scale = 0.92 + 0.08 * eased;
    }

    const liftStart = 1.9, liftEnd = 2.6;
    const liftT = clamp((t - liftStart) / (liftEnd - liftStart), 0, 1);
    const liftY = -easeInOutCubic(liftT) * 14;

    const outroStart = 3.5;
    const outroT = clamp((t - outroStart) / (DURATION - outroStart), 0, 1);
    const outroFade = 1 - outroT * 0.15;

    const cardW = 320, cardH = 96;
    const cx = W / 2, cy = H * 0.46;

    return (
      <div style={{
        position: 'absolute',
        left: cx, top: cy + stackY,
        width: cardW, height: cardH,
        marginLeft: -cardW / 2, marginTop: -cardH / 2,
        transform: `translateY(${y + liftY}px) scale(${scale}) rotate(${rot}deg)`,
        transformOrigin: 'center',
        opacity: opacity * outroFade,
        zIndex: z,
        willChange: 'transform, opacity',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: 22,
          background: pal.CARD_BG,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${pal.CARD_BORDER}`,
          boxShadow: pal.CARD_SHADOW,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0, width: 6,
            background: tint, opacity: 0.85,
          }}/>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0, width: 60,
            background: `linear-gradient(90deg, ${tint}26 0%, transparent 100%)`,
          }}/>
          <div style={{
            position: 'absolute', inset: 0,
            padding: '14px 18px 14px 22px',
            display: 'flex', alignItems: 'center', gap: 14,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            <div style={{
              width: 44, flexShrink: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            }}>
              <div style={{
                fontSize: 10, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: pal.TEXT_SUBTLE,
                fontWeight: 600,
              }}>{day}</div>
              <div style={{
                fontFamily: 'Newsreader, Georgia, serif',
                fontSize: 28, fontWeight: 500,
                color: pal.TEXT, lineHeight: 1, marginTop: 4,
                fontVariantNumeric: 'tabular-nums',
              }}>{dateNum}</div>
            </div>

            <div style={{
              width: 1, height: 52,
              background: pal.CARD_DIVIDER,
              flexShrink: 0,
            }}/>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{
                fontSize: 15, fontWeight: 600,
                color: pal.TEXT, fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.01em',
              }}>{time}</div>
              <div style={{
                fontFamily: 'Newsreader, Georgia, serif',
                fontStyle: 'italic', fontSize: 13,
                color: pal.TEXT_MUTED, fontWeight: 400,
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>{activity}</div>
            </div>

            <div style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 9px',
              borderRadius: 999,
              background: `${tint}1f`,
              border: `1px solid ${tint}3a`,
              fontSize: 10.5,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: tint,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: tint, boxShadow: `0 0 6px ${tint}`,
              }}/>
              {facility}
            </div>
          </div>

          {showCheck && <CheckBadge t={t} pal={pal}/>}
        </div>
      </div>
    );
  }

  // ── Чекмарк на верхней карточке ────────────────────────────────
  function CheckBadge({ t, pal }) {
    const badgeStart = 1.5, badgeDur = 0.4;
    const bT = clamp((t - badgeStart) / badgeDur, 0, 1);
    const bEased = easeOutBack(bT);

    const strokeStart = 1.7, strokeDur = 0.55;
    const sT = clamp((t - strokeStart) / strokeDur, 0, 1);
    const sEased = easeOutCubic(sT);

    const glowT = clamp((t - 2.15) / 0.5, 0, 1);
    const glowAmt = Math.sin(glowT * Math.PI) * 0.6;

    const pathLen = 26;
    const tint = pal.ACCENT;

    return (
      <div style={{
        position: 'absolute',
        right: -10, top: -10,
        width: 36, height: 36,
        transform: `scale(${bEased})`,
        opacity: bT,
        transformOrigin: 'center',
      }}>
        <div style={{
          position: 'absolute', inset: -4,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tint}66 0%, transparent 70%)`,
          opacity: 0.6 + glowAmt,
          filter: 'blur(4px)',
        }}/>
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%',
          background: `linear-gradient(160deg, ${tint} 0%, ${pal.ACCENT_DEEP} 100%)`,
          boxShadow: `0 6px 14px -2px ${tint}80, 0 0 0 1px rgba(255,255,255,0.22) inset`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5 L10 17.5 L19 7.5"
                  stroke="#fffaf3" strokeWidth="2.6"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{
                    strokeDasharray: pathLen,
                    strokeDashoffset: pathLen * (1 - sEased),
                    filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.2))',
                  }}/>
          </svg>
        </div>
      </div>
    );
  }

  // ── Стопка карточек ────────────────────────────────────────────
  function CardStack({ t, pal }) {
    return (
      <>
        <ShiftCard t={t} pal={pal} tint={pal.ROWING}
          day="ПТ" dateNum="29" time="06:30 — 07:30"
          activity="штанга, разминка" facility="греб. база"
          inAt={0.30} stackY={18} rotZ={-0.8} z={1}/>
        <ShiftCard t={t} pal={pal} tint={pal.POOL}
          day="СР" dateNum="27" time="18:30 — 21:00"
          activity="тренировка U-14" facility="бассейн"
          inAt={0.55} stackY={0} rotZ={0.5} z={2}/>
        <ShiftCard t={t} pal={pal} tint={pal.ICE}
          day="ПН" dateNum="25" time="15:00 — 17:30"
          activity="лёд, общая группа" facility="лёд. арена"
          inAt={0.80} stackY={-18} rotZ={-0.2} z={3} showCheck/>
      </>
    );
  }

  // ── Wordmark «Расписание» ──────────────────────────────────────
  function Wordmark({ t, pal }) {
    const titleStart = 2.05, titleDur = 0.7;
    const titleT = clamp((t - titleStart) / titleDur, 0, 1);
    const titleEased = easeOutCubic(titleT);

    const accentStart = 2.4;
    const accentT = clamp((t - accentStart) / 0.5, 0, 1);

    const tagStart = 2.65, tagDur = 0.6;
    const tagT = clamp((t - tagStart) / tagDur, 0, 1);
    const tagEased = easeOutCubic(tagT);

    const title = 'Расписание';
    const letterStagger = 0.05;
    const cy = H * 0.46;

    return (
      <>
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          top: cy + 150,
          textAlign: 'center',
          fontFamily: 'Newsreader, Georgia, serif',
          fontWeight: 500,
          fontStyle: 'italic',
          fontSize: 64,
          letterSpacing: '-0.015em',
          color: pal.TEXT,
          lineHeight: 1,
          opacity: titleEased,
          transform: `translateY(${(1 - titleEased) * 18}px)`,
          willChange: 'transform, opacity',
        }}>
          {title.split('').map((ch, i) => {
            const charT = clamp((t - (titleStart + i * letterStagger)) / 0.45, 0, 1);
            const cEase = easeOutCubic(charT);
            const isFirst = i === 0;
            // «Р» окрашивается в accent
            const color = isFirst
              ? (accentT <= 0 ? pal.TEXT : accentT >= 1 ? pal.ACCENT : mixColor(pal.TEXT, pal.ACCENT, accentT))
              : pal.TEXT;
            return (
              <span key={i} style={{
                display: 'inline-block',
                opacity: cEase,
                transform: `translateY(${(1 - cEase) * 10}px)`,
                color,
                transition: 'color 200ms ease',
              }}>{ch}</span>
            );
          })}
        </div>

        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          top: cy + 232,
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: pal.TEXT_MUTED,
          opacity: tagEased,
          transform: `translateY(${(1 - tagEased) * 8}px)`,
        }}>
          <span style={{ color: pal.TEXT_SUBTLE }}>спортивные объекты</span>
          <span style={{
            display: 'inline-block',
            width: 4, height: 4, borderRadius: '50%',
            background: pal.ACCENT,
            margin: '0 12px',
            verticalAlign: 'middle',
            boxShadow: `0 0 6px ${pal.ACCENT}`,
          }}/>
          <span style={{ color: pal.TEXT }}>ПолесГУ</span>
        </div>
      </>
    );
  }

  // Линейный mix двух hex-цветов (для перехода «Р» в accent).
  function mixColor(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ra = (pa >> 16) & 0xff, ga = (pa >> 8) & 0xff, ba = pa & 0xff;
    const rb = (pb >> 16) & 0xff, gb = (pb >> 8) & 0xff, bb = pb & 0xff;
    const r = Math.round(ra + (rb - ra) * t);
    const g = Math.round(ga + (gb - ga) * t);
    const bC = Math.round(ba + (bb - ba) * t);
    return '#' + ((r << 16) | (g << 8) | bC).toString(16).padStart(6, '0');
  }

  // ── Loading hint снизу ─────────────────────────────────────────
  function LoadingHint({ t, pal }) {
    const start = 2.8, dur = 1.1;
    const localT = clamp((t - start) / dur, 0, 1);
    const eased = easeInOutCubic(localT);
    const opacity = clamp((t - start) / 0.4, 0, 1) * (1 - clamp((t - 3.85) / 0.15, 0, 1));

    return (
      <div style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: 80,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 14,
        opacity,
      }}>
        <div style={{
          width: 84, height: 2,
          background: pal.TRACK_BG,
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${eased * 100}%`,
            background: `linear-gradient(90deg, ${pal.ACCENT} 0%, ${pal.ACCENT}80 100%)`,
            borderRadius: 2,
            boxShadow: `0 0 8px ${pal.ACCENT}80`,
          }}/>
        </div>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10,
          letterSpacing: '0.22em',
          color: pal.TEXT_SUBTLE,
          textTransform: 'uppercase',
          fontWeight: 500,
        }}>
          Синхронизация · polessu.by
        </div>
      </div>
    );
  }

  // ── IntroOverlay — root, монтируется поверх Router'а ───────────
  // Запускает RAF-таймер на DURATION секунд, потом плавно угасает и
  // вызывает onComplete. Если пользователь нажал/тапнул — пропускается.
  function IntroOverlay({ onComplete }) {
    const [t, setT] = _is(0);
    const [leaving, setLeaving] = _is(false);
    const [scale, setScale] = _is(() => computeScale());
    // Тема выбирается один раз на mount — за 4 секунды переключение
    // через настройки маловероятно, а MutationObserver на html-классе
    // ради этого избыточен. Если main.jsx применяет класс до mount —
    // мы прочитаем актуальное значение.
    const [theme] = _is(() => readTheme());
    const pal = makePalette(theme);

    function computeScale() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // «cover»: масштабируем так, чтобы заставка покрывала весь viewport.
      // Если айфон чуть шире/уже расчётных 9:19.5 — стейдж переполнится
      // в большем измерении, лишнее обрежется overflow:hidden у overlay.
      // Контент (карточки, wordmark) спозиционирован относительно центра
      // стейджа → остаётся видимым в любом viewport.
      return Math.max(vw / W, vh / H);
    }

    // RAF-таймер сцены
    _ie(() => {
      let raf, start;
      let cancelled = false;
      const tick = (ts) => {
        if (cancelled) return;
        if (!start) start = ts;
        const elapsed = (ts - start) / 1000;
        setT(elapsed);
        if (elapsed < DURATION) {
          raf = requestAnimationFrame(tick);
        } else {
          setLeaving(true);
          setTimeout(() => { if (!cancelled) onComplete?.(); }, FADE_OUT_MS);
        }
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        if (raf) cancelAnimationFrame(raf);
      };
    }, []);

    // Auto-scale 540×1170 → viewport. CSS-only через scale(var(--…))
    // не работает: min(calc(100vw/540)) возвращает length, а scale() ждёт
    // unitless. Считаем в JS, переустанавливаем на resize.
    _ie(() => {
      const update = () => setScale(computeScale());
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }, []);

    function skip() {
      if (leaving) return;
      setLeaving(true);
      setTimeout(() => onComplete?.(), FADE_OUT_MS);
    }

    return (
      <div
        className={'intro-overlay is-' + theme + (leaving ? ' is-leaving' : '')}
        onClick={skip}
        role="button"
        tabIndex={-1}
        aria-label="Заставка приложения"
        style={{ background: pal.BG }}
      >
        <div
          className="intro-stage"
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <Background t={t} pal={pal}/>
          <CardStack t={t} pal={pal}/>
          <Wordmark t={t} pal={pal}/>
          <LoadingHint t={t} pal={pal}/>
        </div>
      </div>
    );
  }

  window.IntroOverlay = IntroOverlay;
})();
