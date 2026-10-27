import { mkdir, readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR ?? 'dist';
const CONTRIB_FILE = process.env.CONTRIB_FILE;

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const PAD = 20;
const HEADER = 44;
const SHIP_ZONE = 54;
const PX = 3;

const SHOT_INTERVAL = 0.12;
const BULLET_SPEED = 700;
const MOVE_PER_COLUMN = 0.05;
const INTRO = 0.8;
const OUTRO = 1.2;
const HOLD = 1.6;
const PARTICLE_LIFE = 0.45;

const LEVELS = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];

const THEMES = {
  dark: {
    bg: '#0d1117',
    border: '#30363d',
    empty: '#161b22',
    levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    text: '#e6edf3',
    muted: '#8b949e',
    accent: '#39d353',
    hull: '#58a6ff',
    hullDark: '#1f6feb',
    cockpit: '#f0f6fc',
    flame: ['#ffa657', '#f78166'],
    bullet: '#ffd33d',
    flash: '#ffffff',
    particles: ['#ffd33d', '#ffa657', '#f78166', '#ffffff'],
  },
  light: {
    bg: '#ffffff',
    border: '#d0d7de',
    empty: '#ebedf0',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    text: '#1f2328',
    muted: '#656d76',
    accent: '#1a7f37',
    hull: '#0969da',
    hullDark: '#0550ae',
    cockpit: '#54aeff',
    flame: ['#fb8f44', '#cf222e'],
    bullet: '#bf8700',
    flash: '#fff8c5',
    particles: ['#d4a72c', '#fb8f44', '#cf222e', '#9a6700'],
  },
};

const SHIP = [
  '....A....',
  '....A....',
  '...BCB...',
  '.A.BCB.A.',
  '.ABBBBBA.',
  'AA.BBB.AA',
  'A...B...A',
];

async function fetchCalendar() {
  if (CONTRIB_FILE) {
    return JSON.parse(await readFile(CONTRIB_FILE, 'utf8')).data.user.contributionsCollection.contributionCalendar;
  }
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel weekday } }
        }
      }
    }
  }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function streaks(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { longest, current };
}

function buildTimeline(weeks) {
  const gridBottom = HEADER + 7 * PITCH;
  const shipTop = gridBottom + 16;
  const columns = weeks.map((w, col) =>
    w.contributionDays
      .map((d) => ({ ...d, col, row: d.weekday, level: LEVELS.indexOf(d.contributionLevel) }))
      .filter((d) => d.level > 0)
      .sort((a, b) => b.row - a.row),
  );

  const colX = (col) => PAD + col * PITCH + CELL / 2;
  const shipStops = [{ t: 0, x: -40 }];
  const hits = [];
  let t = INTRO;
  let prevCol = null;

  for (const cells of columns) {
    if (!cells.length) continue;
    const col = cells[0].col;
    const x = colX(col);
    const travel = prevCol === null ? 0 : Math.max(0.1, Math.abs(col - prevCol) * MOVE_PER_COLUMN);
    if (prevCol !== null) shipStops.push({ t, x: shipStops.at(-1).x });
    t += travel;
    shipStops.push({ t, x });
    for (const cell of cells) {
      const cellY = HEADER + cell.row * PITCH + CELL;
      const flight = (shipTop - cellY) / BULLET_SPEED;
      hits.push({ ...cell, fire: t, hit: t + flight, distance: shipTop - cellY, x });
      t += SHOT_INTERVAL;
    }
    prevCol = col;
  }

  const lastHit = hits.length ? Math.max(...hits.map((h) => h.hit)) : t;
  t = Math.max(t, lastHit) + 0.2;
  shipStops.push({ t, x: shipStops.at(-1).x });
  t += OUTRO;
  const width = PAD * 2 + weeks.length * PITCH - GAP;
  shipStops.push({ t, x: width + 40 });
  const restore = t + 0.2;
  const duration = restore + HOLD;
  shipStops.push({ t: duration, x: width + 40 });

  return { hits, shipStops, duration, restore, shipTop, gridBottom, width };
}

const pct = (t, duration) => `${((t / duration) * 100).toFixed(3)}%`;

function render(calendar, theme) {
  const c = THEMES[theme];
  const { weeks, totalContributions } = calendar;
  const days = weeks.flatMap((w) => w.contributionDays);
  const { longest, current } = streaks(days);
  const { hits, shipStops, duration, restore, shipTop, width } = buildTimeline(weeks);
  const height = HEADER + 7 * PITCH + SHIP_ZONE;
  const p = (t) => pct(t, duration);
  const css = [];
  const body = [];

  css.push(`.a{animation-duration:${duration.toFixed(2)}s;animation-iteration-count:infinite}`);
  css.push('.s{animation-timing-function:step-end}');
  css.push('.l{animation-timing-function:linear}');
  css.push('.o{opacity:0}');
  css.push('text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700}');

  body.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${c.bg}" stroke="${c.border}"/>`);
  body.push(`<text x="${PAD}" y="26" font-size="13" fill="${c.text}">COMMIT SHOOTER</text>`);
  body.push(
    `<text x="${PAD + 128}" y="26" font-size="11" fill="${c.muted}">${totalContributions} contribuições · sequência atual ${current}d · recorde ${longest}d</text>`,
  );

  const hitByDate = new Map(hits.map((h, i) => [h.date, { ...h, i }]));
  const restoreAt = (col) => restore + col * 0.012;

  weeks.forEach((w, col) => {
    for (const d of w.contributionDays) {
      const x = PAD + col * PITCH;
      const y = HEADER + d.weekday * PITCH;
      const level = LEVELS.indexOf(d.contributionLevel);
      const h = hitByDate.get(d.date);
      if (!h) {
        body.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${c.levels[level]}"/>`);
        continue;
      }
      const name = `c${h.i}`;
      css.push(
        `@keyframes ${name}{0%{fill:${c.levels[level]}}${p(h.hit)}{fill:${c.flash}}${p(h.hit + 0.08)}{fill:${c.empty}}${p(restoreAt(col))}{fill:${c.levels[level]}}}`,
      );
      body.push(
        `<rect class="a s" style="animation-name:${name}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${c.levels[level]}"/>`,
      );
    }
  });

  const rows = [...new Set(hits.map((h) => h.row))];
  for (const row of rows) {
    const h = hits.find((x) => x.row === row);
    css.push(
      `@keyframes b${row}{0%{opacity:1;transform:translateY(0)}${p(h.hit - h.fire)}{opacity:1;transform:translateY(-${h.distance}px)}${p(h.hit - h.fire + 0.001)}{opacity:0;transform:translateY(-${h.distance}px)}100%{opacity:0}}`,
    );
  }
  for (const h of hits) {
    body.push(
      `<rect class="a l o" style="animation-name:b${h.row};animation-delay:${h.fire.toFixed(3)}s" x="${h.x - 1.5}" y="${shipTop - 7}" width="3" height="7" fill="${c.bullet}"/>`,
    );
  }

  const directions = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1.4],
    [1.4, 0],
  ];
  directions.forEach(([dx, dy], i) => {
    const r = 12;
    css.push(
      `@keyframes p${i}{0%{opacity:1;transform:translate(0,0)}${p(PARTICLE_LIFE)}{opacity:0;transform:translate(${(dx * r).toFixed(1)}px,${(dy * r).toFixed(1)}px)}100%{opacity:0}}`,
    );
  });
  for (const h of hits) {
    const cx = PAD + h.col * PITCH + CELL / 2;
    const cy = HEADER + h.row * PITCH + CELL / 2;
    const count = 2 + h.level;
    for (let i = 0; i < count && i < directions.length; i++) {
      body.push(
        `<rect class="a l o" style="animation-name:p${i};animation-delay:${h.hit.toFixed(3)}s" x="${cx - 1.5}" y="${cy - 1.5}" width="3" height="3" fill="${c.particles[(h.i + i) % c.particles.length]}"/>`,
      );
    }
  }

  let score = 0;
  const scoreX = width - PAD;
  const scoreAt = [{ t: 0, value: 0 }];
  for (const h of [...hits].sort((a, b) => a.hit - b.hit)) {
    score += h.contributionCount;
    scoreAt.push({ t: h.hit, value: score });
  }
  scoreAt.forEach((s, i) => {
    const end = scoreAt[i + 1]?.t ?? restore;
    const label = `SCORE ${String(s.value).padStart(4, '0')}`;
    if (i === 0) {
      css.push(`@keyframes s0{0%{opacity:1}${p(end)}{opacity:0}${p(restore)}{opacity:1}}`);
    } else {
      css.push(`@keyframes s${i}{0%{opacity:0}${p(s.t)}{opacity:1}${p(end)}{opacity:0}}`);
    }
    body.push(
      `<text class="a s${i === 0 ? '' : ' o'}" style="animation-name:s${i}" x="${scoreX}" y="26" font-size="13" text-anchor="end" fill="${c.accent}">${label}</text>`,
    );
  });

  const frames = shipStops.map((s) => `${p(s.t)}{transform:translateX(${s.x.toFixed(1)}px)}`).join('');
  css.push(`@keyframes ship{${frames}}`);
  css.push('@keyframes flame{0%,49%{opacity:1}50%,100%{opacity:0}}');
  css.push('.f{animation:flame .16s infinite}');

  const shipW = SHIP[0].length * PX;
  const sprite = [];
  SHIP.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      const fill = { A: c.hull, B: c.hullDark, C: c.cockpit }[ch];
      if (fill) sprite.push(`<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`);
    }),
  );
  const flameY = SHIP.length * PX;
  sprite.push(`<rect class="f" x="${4 * PX}" y="${flameY}" width="${PX}" height="${PX * 2}" fill="${c.flame[0]}"/>`);
  sprite.push(`<rect x="${4 * PX}" y="${flameY}" width="${PX}" height="${PX}" fill="${c.flame[1]}"/>`);
  body.push(
    `<g class="a l" style="animation-name:ship"><g transform="translate(${-shipW / 2} ${shipTop})">${sprite.join('')}</g></g>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${css.join('')}</style>${body.join('')}</svg>`;
}

const calendar = await fetchCalendar();
await mkdir(OUT_DIR, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const svg = render(calendar, theme);
  await writeFile(`${OUT_DIR}/commit-shooter-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/commit-shooter-${theme}.svg ${(svg.length / 1024).toFixed(1)} KB`);
}
