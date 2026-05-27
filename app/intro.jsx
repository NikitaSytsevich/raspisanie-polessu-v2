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
  const DURATION = 5.0;        // длительность анимации (с)
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
        POOL_SOFT:    'rgba(63, 130, 118, 0.08)',
        ROWING:       '#a87a3a',
        // Lanes (intro карточка большой бассейн)
        LANE_BG:      'rgba(24, 21, 19, 0.05)',
        LANE_BORDER:  'rgba(24, 21, 19, 0.10)',
        LANE_EMPTY:   'rgba(24, 21, 19, 0.16)',
        LANE_OCC:     '#c96442',
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
      POOL_SOFT:    'rgba(125, 187, 176, 0.10)',
      ROWING:       '#d4a76e',
      LANE_BG:      'rgba(245, 241, 235, 0.04)',
      LANE_BORDER:  'rgba(245, 241, 235, 0.10)',
      LANE_EMPTY:   'rgba(245, 241, 235, 0.18)',
      LANE_OCC:     '#d97757',
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

  // ── PoolCard — реплика главной карточки .fc-card.is-fac-sports_pool ──
  // Появляется снизу вверх (как fcRise в проде), затем по шагам выезжают
  // header → диапазон смены → инструктор → две сессии. Внутри второй
  // сессии волной заливаются занятые дорожки (paint от лево к право).
  // Footer завершает реплику настоящей карточки. Цветовая палитра —
  // pal.POOL для tint, pal.LANE_OCC (orange) для занятых дорожек.
  function PoolCard({ t, pal }) {
    const s = {
      cardIn:  { at: 0.10, dur: 0.70 },
      title:   { at: 0.60, dur: 0.45 },
      range:   { at: 0.85, dur: 0.40 },
      inst:    { at: 1.10, dur: 0.32 },
      sess1:   { at: 1.32, dur: 0.36 },
      sess2:   { at: 1.65, dur: 0.36 },
      lanes:   { at: 1.95, dur: 0.95 },
      footer:  { at: 2.70, dur: 0.45 },
    };
    const reveal = (st) => clamp((t - st.at) / st.dur, 0, 1);

    const cardR   = reveal(s.cardIn);
    const cardE   = easeOutCubic(cardR);
    const titleE  = easeOutCubic(reveal(s.title));
    const rangeE  = easeOutCubic(reveal(s.range));
    const instE   = easeOutCubic(reveal(s.inst));
    const sess1E  = easeOutBack(reveal(s.sess1));
    const sess2E  = easeOutBack(reveal(s.sess2));
    const footerE = easeOutCubic(reveal(s.footer));

    const outroT = clamp((t - 4.55) / (DURATION - 4.55), 0, 1);
    const outroY = -easeInOutCubic(outroT) * 10;
    const outroFade = 1 - outroT * 0.25;

    const cardW = 460;
    const cx = W / 2;
    const topY = 180;          // карточка занимает верх стейджа, wordmark/loading — под ней
    const cardSlideY = (1 - cardE) * 80;

    // Паттерн «6 свободно, без 2 крайних» из парсера sports_pool:
    // визуально слева занят край (9, 8, 7) + справа крайняя (0).
    const occupiedSet = new Set([9, 8, 7, 0]);
    const fillOrder = [9, 8, 7, 0];  // визуальный порядок слева направо
    const perLane = s.lanes.dur / fillOrder.length;
    const laneFill = (n) => {
      if (!occupiedSet.has(n)) return 1;
      const idx = fillOrder.indexOf(n);
      const startAt = s.lanes.at + idx * perLane * 0.78;  // лёгкое наложение волны
      return clamp((t - startAt) / perLane, 0, 1);
    };

    return (
      <div style={{
        position: 'absolute',
        left: cx - cardW / 2, top: topY,
        width: cardW,
        transform: `translateY(${cardSlideY + outroY}px)`,
        opacity: clamp(cardR * 1.4, 0, 1) * outroFade,
        borderRadius: 24,
        background: pal.CARD_BG,
        border: `1px solid ${pal.CARD_BORDER}`,
        boxShadow: pal.CARD_SHADOW,
        padding: '22px 24px 0',
        overflow: 'hidden',
        willChange: 'transform, opacity',
      }}>
        <div style={{
          position: 'absolute',
          top: -18, right: -38,
          color: pal.POOL,
          opacity: 0.08,
          fontFamily: '"Material Symbols Outlined"',
          fontSize: 220,
          lineHeight: 1,
          transform: 'rotate(-8deg)',
          pointerEvents: 'none',
          fontVariationSettings: "'FILL' 0, 'wght' 200, 'GRAD' 0, 'opsz' 48",
        }}>pool</div>

        <div style={{
          position: 'relative', zIndex: 1,
          opacity: titleE,
          transform: `translateY(${(1 - titleE) * 8}px)`,
        }}>
          <p style={{
            margin: 0,
            fontFamily: 'Newsreader, Georgia, serif',
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: '-0.015em',
            color: pal.TEXT,
            lineHeight: 1.1,
          }}>Большой бассейн</p>
          <p style={{
            margin: '5px 0 0',
            fontFamily: 'Newsreader, Georgia, serif',
            fontStyle: 'italic',
            fontSize: 16,
            color: pal.POOL,
            opacity: 0.85,
            letterSpacing: '0.005em',
          }}>50 м · 10 дорожек</p>
        </div>

        <div style={{
          marginTop: 14,
          display: 'flex', alignItems: 'baseline', gap: 14,
          opacity: rangeE,
          transform: `translateY(${(1 - rangeE) * 6}px)`,
          position: 'relative', zIndex: 1,
        }}>
          <span style={{
            fontFamily: 'Newsreader, Georgia, serif',
            fontWeight: 500,
            fontSize: 40,
            letterSpacing: '-0.02em',
            color: pal.TEXT,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}>18:30</span>
          <span style={{ color: pal.TEXT_SUBTLE, fontSize: 22, lineHeight: 1 }}>→</span>
          <span style={{
            fontFamily: 'Newsreader, Georgia, serif',
            fontWeight: 500,
            fontSize: 40,
            letterSpacing: '-0.02em',
            color: pal.TEXT,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}>19:30</span>
        </div>

        <p style={{
          margin: '12px 0 4px',
          fontFamily: 'Newsreader, Georgia, serif',
          fontStyle: 'italic',
          fontSize: 18,
          color: pal.TEXT_MUTED,
          opacity: instE,
          transform: `translateY(${(1 - instE) * 4}px)`,
          position: 'relative', zIndex: 1,
          lineHeight: 1.3,
        }}>
          <span style={{ color: pal.TEXT_SUBTLE, marginRight: 8 }}>с</span>
          Ившина М.Ю.
        </p>

        <div style={{ position: 'relative', zIndex: 1, marginTop: 6 }}>
          <SessionRow pal={pal} time="18:00–19:00"
                      occupiedSet={new Set()} laneFill={() => 1}
                      revealE={sess1E} isFirst/>
          <SessionRow pal={pal} time="19:00–20:00"
                      occupiedSet={occupiedSet} laneFill={laneFill}
                      revealE={sess2E}/>
        </div>

        <div style={{
          marginTop: 14,
          marginLeft: -24, marginRight: -24,
          padding: '14px 24px 18px',
          borderTop: `1px solid ${pal.CARD_DIVIDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          opacity: footerE,
          transform: `translateY(${(1 - footerE) * 4}px)`,
          position: 'relative', zIndex: 1,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px',
            borderRadius: 999,
            background: `${pal.ACCENT}1f`,
            border: `1px solid ${pal.ACCENT}3a`,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: pal.ACCENT,
          }}>по сайту</span>
          <span style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 15,
            color: pal.TEXT_SUBTLE,
            letterSpacing: '0.02em',
          }}>1 ч</span>
        </div>
      </div>
    );
  }

  // SessionRow — одна сессия в PoolCard: время + pill из 10 дорожек.
  // laneFill(n) ∈ [0..1] — прогресс заливки orange для занятой n.
  function SessionRow({ pal, time, occupiedSet, laneFill, revealE, isFirst }) {
    if (revealE <= 0) return null;
    const total = 10;
    const e = clamp(revealE, 0, 1);
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '15px 0',
        borderTop: isFirst ? 'none' : `1px solid ${pal.CARD_DIVIDER}`,
        opacity: e,
        transform: `translateY(${(1 - e) * 12}px)`,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 17,
          fontWeight: 500,
          color: pal.TEXT,
          letterSpacing: '0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: pal.POOL,
          }}/>
          {time}
        </span>
        <span style={{
          display: 'inline-flex',
          padding: '6px 8px',
          borderRadius: 12,
          background: pal.LANE_BG,
          border: `1px solid ${pal.LANE_BORDER}`,
        }}>
          <span style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: total }).map((_, idx) => {
              const n = total - 1 - idx;
              const isOcc = occupiedSet.has(n);
              const fill = isOcc ? laneFill(n) : 1;
              const bg = isOcc
                ? `linear-gradient(0deg, ${pal.LANE_OCC} ${fill * 100}%, ${pal.LANE_EMPTY} ${fill * 100}%)`
                : pal.LANE_EMPTY;
              const pop = isOcc && fill > 0 && fill < 1
                ? 1 + 0.06 * Math.sin(fill * Math.PI) : 1;
              return (
                <span key={n} style={{
                  width: 14, height: 30,
                  borderRadius: 4,
                  background: bg,
                  transform: `scaleY(${pop})`,
                  transformOrigin: 'center bottom',
                }}/>
              );
            })}
          </span>
        </span>
      </div>
    );
  }

  // ── Wordmark «Расписание» ──────────────────────────────────────
  // Появляется ПОД карточкой, после того как footer карточки уже на месте.
  function Wordmark({ t, pal }) {
    const titleStart = 3.00, titleDur = 0.7;
    const titleT = clamp((t - titleStart) / titleDur, 0, 1);
    const titleEased = easeOutCubic(titleT);

    const accentStart = 3.35;
    const accentT = clamp((t - accentStart) / 0.5, 0, 1);

    const tagStart = 3.55, tagDur = 0.6;
    const tagT = clamp((t - tagStart) / tagDur, 0, 1);
    const tagEased = easeOutCubic(tagT);

    const title = 'Расписание';
    const letterStagger = 0.05;
    // Хардкод y: чтобы лежал под карточкой (которая занимает y=180..~530).
    const titleY = 600;
    const tagY = 692;

    return (
      <>
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          top: titleY,
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
          top: tagY,
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
    // Сдвинут вслед за wordmark'ом: появляется после tag'а, заполняется
    // к концу DURATION (5.0s), коротко фейдится перед уходом overlay'я.
    const start = 3.70, dur = 1.10;
    const localT = clamp((t - start) / dur, 0, 1);
    const eased = easeInOutCubic(localT);
    const opacity = clamp((t - start) / 0.4, 0, 1) * (1 - clamp((t - 4.85) / 0.15, 0, 1));

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
          <PoolCard t={t} pal={pal}/>
          <Wordmark t={t} pal={pal}/>
          <LoadingHint t={t} pal={pal}/>
        </div>
      </div>
    );
  }

  window.IntroOverlay = IntroOverlay;
})();
