// The story film. Every frame is a pure function of time: Film.seek(t) paints frame t.
// No timers, no CSS transitions, no state carried between frames.
const Film = (function () {
  const W = 1920, H = 1080, DUR = 81;
  const INK = [30, 42, 46], ACCENT = [208, 92, 54], GROUND = '#F3EEE3', PAPER = '#FFFDF8', TEAL = '#2F5D6B';
  const DISPLAY = '"Fraunces", Georgia, serif', UI = '"Inter", system-ui, sans-serif';
  const ink = (a = 1) => `rgba(${INK}, ${a})`, accent = (a = 1) => `rgba(${ACCENT}, ${a})`;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  // Critically damped spring, 0 -> 1, closed form. Settles without bounce.
  function ease(u, w = 11) { return u <= 0 ? 0 : w * u > 14 ? 1 : 1 - Math.exp(-w * u) * (1 + w * u); }

  // ---------- The 1,000 profiles ----------
  // Column-major order, so the funnel's groups are contiguous blocks from the left.
  const N = 1000, COLS = 50, ROWS = 20, GAP = 28, X0 = (W - (COLS - 1) * GAP) / 2, Y0 = 345, R = 8.5;
  const MET = 42, ACCEPTED = 310, MUTUAL = 210, RULE_END = 552; // 310..551 broke a stated rule, 552..999 did not
  const gx = (i) => X0 + Math.floor(i / ROWS) * GAP, gy = (i) => Y0 + (i % ROWS) * GAP;
  const HL = X0 - R; // left edge shared by the grid and the headlines

  function pose(fn) {
    const p = { x: new Float32Array(N), y: new Float32Array(N), s: new Float32Array(N), a: new Float32Array(N), c: new Float32Array(N) };
    for (let i = 0; i < N; i++) {
      const d = Object.assign({ x: gx(i), y: gy(i), s: 1, a: 1, c: 0 }, fn(i));
      p.x[i] = d.x; p.y[i] = d.y; p.s[i] = d.s; p.a[i] = d.a; p.c[i] = d.c;
    }
    return p;
  }
  // Same places, shrunk to nothing: how a group leaves before the next one arrives.
  const hidden = (p) => ({ x: p.x, y: p.y, c: p.c, s: new Float32Array(N), a: new Float32Array(N) });
  const DIM = 0.13;
  const funnel = (n) => pose((i) => ({ a: i < n ? 1 : DIM }));
  const TWIN_A = 700, TWIN_B = 701;

  // The 448 unexplained rejections gather into five groups, nearest columns first, so paths do not cross.
  const CENTERS = [[470, 600], [790, 700], [1080, 560], [1380, 710], [1630, 580]];
  const clusterOf = (i) => Math.min(4, Math.floor((Math.floor(i / ROWS) - 27) / 4.6));
  const rankIn = new Int16Array(N); { const seen = [0, 0, 0, 0, 0]; for (let i = RULE_END; i < N; i++) rankIn[i] = seen[clusterOf(i)]++; }
  const clusters = pose((i) => {
    if (i < RULE_END) return { a: 0 };
    const c = CENTERS[clusterOf(i)], n = rankIn[i], r = 11 * Math.sqrt(n + 0.5), th = n * 2.39996;
    return { x: c[0] + r * Math.cos(th), y: c[1] + r * Math.sin(th), s: 0.85, a: 0.95 };
  });

  // Two bars at a time, drawn with the same dots.
  const BAR_X = 860, BAR_Y = [470, 640], BAR_STEP = 17, BAR_ROWS = 4;
  const barCols = (score) => Math.round(((score - 50) / 30) * 52);
  function bars(pair) {
    const slots = [];
    pair.forEach(([, score, hot], b) => {
      for (let col = 0; col < barCols(score); col++) for (let row = 0; row < BAR_ROWS; row++)
        slots.push({ x: BAR_X + col * BAR_STEP, y: BAR_Y[b] + row * BAR_STEP, s: 0.72, a: 1, c: hot ? 1 : 0, col });
    });
    const p = pose((i) => slots[i] || { a: 0, s: 0 });
    p.col = slots.map((s) => s.col);
    return p;
  }
  const PAIR_A = [['Their own wish list', 74.7, false], ["A stranger's wish list", 74.1, false]];
  const PAIR_B = [['Their own last 8 choices', 68.0, true], ['What most people like', 77.4, false]];
  const barsA = bars(PAIR_A), barsB = bars(PAIR_B);

  const sweep = (i) => Math.floor(i / ROWS) * 0.012 + (i % ROWS) * 0.004;
  const START = pose(() => ({ s: 0, a: 0 }));
  const twins = pose((i) => (i === TWIN_A ? { x: 780, y: 600, s: 9.5 } : i === TWIN_B ? { x: 1140, y: 600, s: 9.5 } : { a: 0.05 }));
  // snap: positions jump at key time (the dots are invisible then); size and opacity still ease in.
  const KEYS = [
    { t: 10.0, p: pose(() => ({})), stagger: sweep },
    { t: 11.6, p: funnel(ACCEPTED) }, { t: 13.0, p: funnel(MUTUAL) }, { t: 14.4, p: funnel(150) }, { t: 15.4, p: funnel(75) }, { t: 16.4, p: funnel(MET) },
    { t: 19.7, p: pose((i) => ({ a: i >= ACCEPTED ? 1 : DIM })), stagger: sweep },
    { t: 21.4, p: pose((i) => ({ a: i >= ACCEPTED ? 1 : DIM, c: i >= ACCEPTED && i < RULE_END ? 1 : 0 })), stagger: (i) => (i % ROWS) * 0.012 },
    { t: 28.0, p: pose((i) => ({ a: i >= RULE_END ? 1 : DIM })) },
    { t: 32.7, p: twins },
    { t: 37.0, p: clusters, stagger: (i) => rankIn[i] * 0.004 },
    { t: 41.35, p: hidden(clusters), stagger: (i) => rankIn[i] * 0.002 },
    { t: 43.4, p: barsA, snap: true, stagger: (i) => (barsA.col[i] || 0) * 0.014 },
    { t: 46.95, p: hidden(barsA) },
    { t: 47.8, p: barsB, snap: true, stagger: (i) => (barsB.col[i] || 0) * 0.014 },
    { t: 56.05, p: hidden(barsB) },
    { t: 72.0, p: funnel(MUTUAL), snap: true, stagger: sweep },
    { t: 75.2, p: pose((i) => ({ a: i < 250 ? 1 : DIM, c: i >= MUTUAL && i < 250 ? 1 : 0 })), stagger: (i) => Math.max(0, i - MUTUAL) * 0.02 },
  ];
  function drawDots(g, t) {
    if (t <= KEYS[0].t) return;
    for (let i = 0; i < N; i++) {
      let x = START.x[i], y = START.y[i], s = 0, a = 0, c = 0, prev = START;
      for (const key of KEYS) {
        const since = t - key.t;
        if (since <= 0) break;
        const e = ease(since - (key.stagger ? key.stagger(i) : 0)), move = key.snap ? 1 : e, p = key.p;
        x += (p.x[i] - prev.x[i]) * move; y += (p.y[i] - prev.y[i]) * move;
        s += (p.s[i] - prev.s[i]) * e; a += (p.a[i] - prev.a[i]) * e; c += (p.c[i] - prev.c[i]) * e;
        prev = p;
      }
      if (a < 0.01 || s < 0.02) continue;
      const m = clamp(c);
      g.fillStyle = `rgba(${Math.round(INK[0] + (ACCENT[0] - INK[0]) * m)}, ${Math.round(INK[1] + (ACCENT[1] - INK[1]) * m)}, ${Math.round(INK[2] + (ACCENT[2] - INK[2]) * m)}, ${clamp(a)})`;
      g.beginPath(); g.arc(x, y, R * s, 0, 6.2832); g.fill();
    }
  }

  // ---------- Type: lines rise from behind a mask and leave upward. No fades. ----------
  const font = (size, weight, family) => `${weight} ${size}px ${family}`;
  function line(g, t, t0, t1, str, x, y, size, o = {}) {
    if (t < t0 || t > t1) return 0;
    g.save();
    g.font = font(size, o.weight || 600, o.family || DISPLAY);
    g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic';
    const width = g.measureText(str).width, left = o.align === 'right' ? x - width : o.align === 'center' ? x - width / 2 : x;
    g.beginPath(); g.rect(left - 30, y - size * 1.02, width + 60, size * 1.34); g.clip();
    const rise = (1 - ease(t - t0, 13)) * size * 1.2, leave = ease(t - (t1 - 0.3), 20) * size * 1.3;
    g.fillStyle = o.color || ink();
    g.fillText(str, x, y + rise - leave);
    g.restore();
    return width;
  }
  const H1 = 170, H2 = 262; // the two headline baselines
  const head = (g, t, t0, t1, str, row = 0, o = {}) => line(g, t, t0, t1, str, HL, row ? H2 : H1, 76, o);
  const small = (g, t, t0, t1, str, x, y, o = {}) => line(g, t, t0, t1, str, x, y, o.size || 34, Object.assign({ family: UI, weight: 500, color: ink(0.7) }, o));
  const presence = (t, t0, t1) => ease(t - t0, 14) * (1 - ease(t - (t1 - 0.3), 20));

  // ---------- The two narrators: Krishna directs, Claude does the work ----------
  const avatar = new Image(); avatar.src = 'assets/krishna.jpg';
  const claude = typeof Path2D !== 'undefined' ? new Path2D(CLAUDE_PATH) : null;
  const KX = HL + 60, CX = W - HL - 44, CY = 978;
  function krishna(g, t, t0, t1, words, tag = 'KRISHNA') {
    if (t < t0 || t > t1) return;
    const s = presence(t, t0, t1);
    g.save(); g.translate(KX, CY); g.scale(s, s);
    g.beginPath(); g.arc(0, 0, 60, 0, 6.2832); g.fillStyle = TEAL; g.fill();
    g.beginPath(); g.arc(0, 0, 54, 0, 6.2832); g.clip();
    if (avatar.complete && avatar.naturalWidth) g.drawImage(avatar, -54, -54, 108, 108);
    g.restore();
    if (tag) small(g, t, t0 + 0.2, t1, tag, KX + 86, CY - 22, { size: 22, weight: 700, color: TEAL });
    for (const [w0, w1, str] of words) line(g, t, w0, w1, str, KX + 86, tag ? CY + 30 : CY + 17, 48, { family: UI, weight: 600 });
  }
  function claudeMark(g, t, t0, t1, words, working) {
    if (t < t0 || t > t1) return;
    const s = presence(t, t0, t1) * 0.7, local = t - t0, beat = working ? 0.4 : 0.9;
    // It turns in steps, the way it does when it is working.
    const step = Math.floor(local / beat), turn = (step + ease(local - step * beat, 20)) * (Math.PI / 6);
    g.save(); g.translate(CX, CY); g.rotate(turn); g.scale(s, s); g.translate(-50, -50);
    g.fillStyle = accent(); g.fill(claude); g.restore();
    small(g, t, t0 + 0.2, t1, 'CLAUDE, MY AI ASSISTANT', CX - 62, CY - 22, { size: 22, weight: 700, color: accent(), align: 'right' });
    for (const [w0, w1, str] of words) line(g, t, w0, w1, str, CX - 62, CY + 26, 40, { family: UI, weight: 500, align: 'right', color: ink(0.8) });
  }

  // ---------- The three people in every match ----------
  const FY = 590, LY = FY + 34, CLIENT = 430, MAKER = 960, MATCH = 1490, FS = 1.4, EDGE = 122, HELD = MAKER - 185, GIVEN = 150;
  function figure(g, x, s, style) {
    if (s <= 0.01) return;
    g.save(); g.translate(x, FY + 62); g.scale(s * FS, s * FS); g.translate(0, -62);
    g.lineWidth = 6; g.strokeStyle = ink(); g.fillStyle = style === 'outline' ? PAPER : style === 'light' ? ink(0.45) : ink();
    g.beginPath(); g.ellipse(0, 62, 84, 94, 0, Math.PI, 0); g.closePath(); g.fill(); if (style === 'outline') g.stroke();
    g.beginPath(); g.arc(0, -72, 42, 0, 6.2832); g.fill(); if (style === 'outline') g.stroke();
    g.restore();
  }
  function cast(g, t, t0, t1) {
    for (const [x, label, style, delay] of [[MAKER, 'MATCHMAKER', 'outline', 0], [CLIENT, 'CLIENT', 'solid', 0.15], [MATCH, 'THE MATCH', 'light', 0.3]]) {
      figure(g, x, presence(t, t0 + delay, t1), style);
      small(g, t, t0 + delay + 0.25, t1, label, x, FY + 112, { align: 'center', size: 26, weight: 700, color: ink(0.8) });
    }
  }
  // The profile being sent: it shows the match, so its face has the match's tone.
  function card(g, x, y, s) {
    if (s <= 0.01) return;
    g.save(); g.translate(x, y); g.scale(s * 1.25, s * 1.25);
    g.fillStyle = PAPER; g.strokeStyle = ink(); g.lineWidth = 5;
    g.beginPath(); g.roundRect(-52, -68, 104, 136, 14); g.fill(); g.stroke();
    g.fillStyle = ink(0.45); g.beginPath(); g.arc(0, -26, 20, 0, 6.2832); g.fill();
    g.fillStyle = ink(0.25); for (const [w, y2] of [[64, 12], [48, 30], [58, 48]]) { g.beginPath(); g.roundRect(-32, y2, w, 8, 4); g.fill(); }
    g.restore();
  }
  function seg(g, x1, y1, x2, y2, p, color, width = 5) {
    if (p <= 0.005) return;
    g.save(); g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p); g.stroke(); g.restore();
  }
  function badge(g, x, y, s, fill, draw) {
    if (s <= 0.01) return;
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = fill; g.beginPath(); g.arc(0, 0, 28, 0, 6.2832); g.fill();
    draw(g); g.restore();
  }
  const yesMark = (g) => { g.strokeStyle = GROUND; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(-12, 1); g.lineTo(-3, 10); g.lineTo(13, -9); g.stroke(); };
  const numberMark = (n) => (g) => { g.fillStyle = GROUND; g.font = font(32, 600, DISPLAY); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 0, 2); };

  // ---------- Small drawn pieces ----------
  function tick(g, t, t0, x, y, size, yes, color) {
    const p = ease(t - t0, 12); if (p <= 0) return;
    g.save(); g.strokeStyle = color; g.lineWidth = size * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (yes) { g.moveTo(x - size * 0.45, y); g.lineTo(x - size * 0.1, y + size * 0.35); g.lineTo(x + size * 0.5, y - size * 0.4); g.setLineDash([size * 1.6 * p, size * 3]); }
    else { g.moveTo(x - size * 0.38, y - size * 0.38); g.lineTo(x + size * 0.38, y + size * 0.38); g.moveTo(x + size * 0.38, y - size * 0.38); g.lineTo(x - size * 0.38, y + size * 0.38); g.setLineDash([size * 2.2 * p, size * 4]); }
    g.stroke(); g.restore();
  }
  function count(t, keys) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * ease(t - keys[i][0], 24);
    return Math.round(v);
  }
  function barLabels(g, t, pair, t0, t1) {
    pair.forEach(([label, score, hot], b) => {
      const y = BAR_Y[b] + 42, a = t0 + b * 0.2;
      small(g, t, a, t1, label, BAR_X - 36, y, { align: 'right', size: 42, color: hot ? accent() : ink(), weight: 600 });
      small(g, t, a + 0.7, t1, `${score.toFixed(1)}%`, BAR_X + barCols(score) * BAR_STEP + 14, y, { size: 42, weight: 700, color: hot ? accent() : ink() });
    });
  }

  // ---------- The scenes ----------
  function scenes(g, t) {
    // 1. Who is who, and how a match gets made.
    if (t < 10) {
      const out = 1 - ease(t - 9.4, 20);
      head(g, t, 0.4, 9.6, 'How a match gets made, as I read your brief.');
      seg(g, MAKER - EDGE, LY, CLIENT + EDGE, LY, ease(t - 2.6, 5) * out, ink(0.35));
      seg(g, MAKER + EDGE, LY, MATCH - EDGE, LY, ease(t - 5.4, 5) * out, ink(0.35));
      cast(g, t, 0.5, 9.8);
      card(g, HELD - GIVEN * ease(t - 2.6, 5), LY, ease(t - 1.8, 14) * out);
      small(g, t, 2.9, 9.6, 'sends the profile', (MAKER + CLIENT) / 2, LY - 110, { align: 'center', size: 32, color: ink() });
      badge(g, CLIENT + 76, FY - 178, ease(t - 4.2, 16) * out, accent(), yesMark);
      small(g, t, 4.4, 9.6, 'says yes', CLIENT, FY + 162, { align: 'center', size: 36, weight: 700, color: accent() });
      small(g, t, 5.7, 9.6, 'asks the match', (MAKER + MATCH) / 2, LY - 110, { align: 'center', size: 32, color: ink() });
      badge(g, MATCH + 76, FY - 178, ease(t - 6.8, 16) * out, accent(), yesMark);
      small(g, t, 7.0, 9.6, 'says yes back', MATCH, FY + 162, { align: 'center', size: 36, weight: 700, color: accent() });
      const p = ease(t - 8.0, 5) * out;
      if (p > 0.005) { // both said yes: now they are connected
        g.save(); g.strokeStyle = accent(); g.lineWidth = 6; g.lineCap = 'round'; g.setLineDash([1500 * p, 3000]);
        g.beginPath(); g.moveTo(CLIENT, FY - 200); g.quadraticCurveTo(MAKER, FY - 345, MATCH, FY - 200); g.stroke(); g.restore();
      }
      head(g, t, 8.3, 9.6, 'Only when both say yes do they meet.', 1);
    }

    // 2. The brief, as the 1,000 profiles themselves.
    head(g, t, 10.1, 19.3, 'Your brief: 1,000 profiles sent.');
    if (t > 11.5 && t < 19.4) {
      const steps = [[11.6, 310, 'times, the client said yes'], [13.0, 210, 'times, the match said yes back'], [14.4, 150, 'started talking'], [15.4, 75, 'fixed a meeting'], [16.4, 42, 'actually met']];
      const n = count(t, [[0, 310], ...steps.map(([a, v]) => [a, v])]);
      const width = line(g, t, 11.6, 19.3, String(n), HL, H2, 76, { color: accent() });
      steps.forEach(([a, , label], k) => line(g, t, a + (k ? 0.14 : 0), k < 4 ? steps[k + 1][0] - 0.02 : 19.3, label, HL + width + 22, H2, 76));
    }

    // 3. The obvious answer. Claude finds it; Krishna is not satisfied.
    head(g, t, 19.8, 27.8, '690 times, the client said no.');
    claudeMark(g, t, 20.6, 27.9, [[21.6, 24.4, '242 broke a rule the client already gave.'], [24.8, 27.6, 'I can build a rule checker.']], t < 24);
    if (t > 21.7 && t < 28) { // the outline hugs the real, stepped shape of the 242
      const p = GAP / 2, top = Y0 - p, bottom = gy(ROWS - 1) + p;
      const xa = gx(ACCEPTED) - p, xb = gx(ACCEPTED) + p, xc = gx(RULE_END) - p, xd = gx(RULE_END) + p;
      const ya = gy(ACCEPTED % ROWS) - p, yb = gy(RULE_END % ROWS) - p;
      const pts = [[xb, top], [xd, top], [xd, yb], [xc, yb], [xc, bottom], [xa, bottom], [xa, ya], [xb, ya]];
      let length = 0; pts.forEach((q, i) => { const r = pts[(i + 1) % pts.length]; length += Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]); });
      const gone = ease(t - 27.6, 18);
      g.save(); g.strokeStyle = accent(); g.lineWidth = 5; g.lineJoin = 'round';
      g.setLineDash([length * ease(t - 21.8, 6) * (1 - gone), length]); g.lineDashOffset = -length * gone;
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.stroke(); g.restore();
    }
    head(g, t, 25.2, 27.8, 'Every AI finds this one.', 1);

    // 4. Krishna's question.
    krishna(g, t, 28.1, 36.9, [[29.0, 32.4, 'What about the other 448?'], [32.8, 36.7, 'What are clients not telling us?']]);
    head(g, t, 28.2, 32.4, 'So I asked a different question.');
    head(g, t, 29.4, 32.4, '448 rejections broke no rule at all.', 1);
    head(g, t, 32.8, 36.7, 'Clients say no to one person,');
    head(g, t, 33.1, 36.7, 'then yes to someone almost identical.', 1);
    if (t > 33 && t < 37) {
      tick(g, t, 33.7, 780, 600, 74, false, GROUND); tick(g, t, 34.9, 1140, 600, 74, true, GROUND);
      small(g, t, 33.7, 36.7, 'week one: no', 780, 758, { align: 'center', size: 40, color: ink(), weight: 600 });
      small(g, t, 34.9, 36.7, 'week three: yes', 1140, 758, { align: 'center', size: 40, color: ink(), weight: 600 });
    }

    // 5. Krishna's idea, and the test he ordered before building it.
    head(g, t, 37.2, 41.6, "My idea: learn each client's type.");
    krishna(g, t, 37.4, 41.7, [[38.0, 41.5, 'Find more people like the ones they say yes to.']]);
    head(g, t, 42.0, 52.7, 'Before building it, I had Claude test it.');
    claudeMark(g, t, 42.3, 52.8, [[42.8, 52.6, 'Running the test.']], true);
    small(g, t, 43.0, 56.3, 'I have none of your data, so I used a public study:', BAR_X, 872, { size: 30 });
    small(g, t, 43.2, 56.3, 'Columbia University speed dating, 8,368 real yes-or-no decisions.', BAR_X, 912, { size: 30 });
    head(g, t, 43.2, 47.2, "Can a person's wish list predict their yes?", 1, { color: ink(0.62) });
    barLabels(g, t, PAIR_A, 43.6, 47.2);
    line(g, t, 45.3, 47.2, 'No better than a stranger’s.', BAR_X, 800, 60, { color: accent() });
    head(g, t, 47.6, 52.7, 'Can their own past choices?', 1, { color: ink(0.62) });
    barLabels(g, t, PAIR_B, 48.0, 56.3);
    line(g, t, 49.8, 56.3, 'Worse than what most people like.', BAR_X, 800, 60, { color: accent() });
    if (t > 43.3 && t < 56.6) { // the baseline every bar starts from
      const p = ease(t - 43.4, 9) * (1 - ease(t - 56.2, 18)), top = BAR_Y[0] - 16, bottom = BAR_Y[1] + BAR_ROWS * BAR_STEP + 4;
      g.save(); g.strokeStyle = ink(0.4); g.lineWidth = 3; g.beginPath(); g.moveTo(BAR_X - 16, top); g.lineTo(BAR_X - 16, top + (bottom - top) * p); g.stroke(); g.restore();
      small(g, t, 43.9, 56.3, 'Bars start at 50%, a coin flip.', BAR_X - 16, top - 22, { size: 28 });
    }
    head(g, t, 53.0, 56.4, 'My idea lost. I parked it.');
    krishna(g, t, 53.3, 56.5, [[53.7, 56.3, 'So what do we build instead?']]);

    // 6. The fix, on the same picture: three checks before the profile leaves the matchmaker.
    if (t > 56.6 && t < 72) {
      const out = 1 - ease(t - 71.5, 20), sent = ease(t - 68.0, 5);
      head(g, t, 56.9, 71.7, 'Instead: three checks before sending.');
      seg(g, HELD - 70, LY - 34, CLIENT + EDGE, LY - 34, ease(t - 58.6, 5) * out * (1 - sent), accent());
      seg(g, MAKER + EDGE, LY, MATCH - EDGE, LY, ease(t - 61.6, 5) * out, accent());
      seg(g, HELD - 70, LY + 34, CLIENT + EDGE, LY + 34, ease(t - 64.6, 5) * out * (1 - sent), accent());
      cast(g, t, 56.8, 71.9);
      badge(g, 590, LY - 34, ease(t - 59.0, 16) * out * (1 - sent), ink(), numberMark(1));
      badge(g, (MAKER + MATCH) / 2, LY, ease(t - 62.0, 16) * out, ink(), numberMark(2));
      badge(g, 664, LY + 34, ease(t - 65.0, 16) * out * (1 - sent), ink(), numberMark(3));
      card(g, HELD - GIVEN * sent, LY, ease(t - 57.6, 14) * out);
      const checks = [
        [59.2, CLIENT, 800, '1  What the client already told us', '24% of sends went against it'],
        [62.2, MATCH, 800, '2  Will the match say yes back?', 'in your brief, 100 of 310 yeses went no further'],
        [65.2, CLIENT, 905, '3  The client’s earlier answers', 'your brief: a no often becomes a yes later'],
      ];
      for (const [t0, x, y, title, stat] of checks) {
        small(g, t, t0, 71.7, title, x, y, { align: 'center', size: 38, weight: 700, color: ink() });
        small(g, t, t0 + 0.4, 71.7, stat, x, y + 42, { align: 'center', size: 30, color: accent(), weight: 600 });
      }
      head(g, t, 68.3, 71.7, 'No score. The matchmaker decides.', 1, { color: accent() });
    }

    // 7. The opening numbers again, read correctly.
    head(g, t, 72.3, DUR + 1, 'Today, 21 in 100 sends end with both saying yes.');
    head(g, t, 75.5, DUR + 1, 'The goal for month one: 25.', 1, { color: accent() });
    krishna(g, t, 77.4, DUR + 1, [[77.8, DUR + 1, 'Krishnasinh Jadeja']], '');
    claudeMark(g, t, 78.0, DUR + 1, [[78.4, DUR + 1, 'I built the prototype. Open it next.']], false);
  }

  function seek(g, t) {
    t = clamp(t, 0, DUR);
    g.setTransform(g.canvas.width / W, 0, 0, g.canvas.height / H, 0, 0);
    g.fillStyle = GROUND; g.fillRect(0, 0, W, H);
    drawDots(g, t);
    scenes(g, t);
    return true;
  }

  const ready = () => Promise.all([
    document.fonts.load(font(76, 600, DISPLAY)), document.fonts.load(font(40, 600, UI)), document.fonts.load(font(40, 500, UI)), document.fonts.load(font(40, 700, UI)),
    avatar.decode ? avatar.decode().catch(() => {}) : null,
  ]);
  return { W, H, DUR, seek, ready };
})();
