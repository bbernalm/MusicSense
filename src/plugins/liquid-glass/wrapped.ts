/*
 * Resumen mensual estilo "Wrapped" (diseño en Figma: "MusicSense · Resumen
 * mensual"). Cuatro pantallas: portada con los minutos, tus artistas, tus
 * canciones y tu momento musical (hora y día favoritos).
 *
 * Los datos se guardan en este PC (localStorage "lg-months") mientras
 * escuchas: profile.ts llama a recordListening() cada 5 s de reproducción.
 * Cada pantalla se puede guardar como imagen (capturePage en backend.ts).
 */

type SongStats = {
  title: string;
  artist: string;
  art: string;
  seconds: number;
  plays: number;
};

type MonthStats = {
  seconds: number;
  days: Record<string, number>;
  hours: number[];
  artists: Record<string, number>;
  songs: Record<string, SongStats>;
};

type Months = Record<string, MonthStats>;

export type WrappedText = (
  key: string,
  vars?: Record<string, unknown>,
) => string;

const MONTHS_KEY = 'lg-months';
// Una reproducción cuenta a partir de 30 s escuchados
const PLAY_SECONDS = 30;

// Colores de cada pantalla (el primero se cambia por el acento de la portada)
const PALETTES = [
  ['#fa2d48', '#5b1d8f', '#ff8a3d'],
  ['#8a4dff', '#1d3a8f', '#fa2d48'],
  ['#ff8a3d', '#8f1d4f', '#8a4dff'],
  ['#2dd4fa', '#3b1d8f', '#fa2d48'],
];

const loadMonths = (): Months => {
  try {
    const raw = localStorage.getItem(MONTHS_KEY);
    if (raw) return JSON.parse(raw) as Months;
  } catch {
    // Datos dañados: se empieza de cero
  }
  return {};
};

const saveMonths = (months: Months) => {
  try {
    localStorage.setItem(MONTHS_KEY, JSON.stringify(months));
  } catch {
    // Sin espacio: no se guardan
  }
};

export const monthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthName = (key: string, long = true) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: long ? 'long' : 'short',
  });
};

// ---------- Registro ----------
let current: { id: string; seconds: number; counted: boolean } | null = null;

export const recordListening = (sample: {
  videoId: string;
  title: string;
  artist: string;
  art: string;
  seconds: number;
}) => {
  const months = loadMonths();
  const now = new Date();
  const key = monthKey(now);
  const month = (months[key] ??= {
    seconds: 0,
    days: {},
    hours: Array.from({ length: 24 }, () => 0),
    artists: {},
    songs: {},
  });
  month.seconds += sample.seconds;
  const day = String(now.getDate());
  month.days[day] = (month.days[day] ?? 0) + sample.seconds;
  month.hours[now.getHours()] += sample.seconds;
  month.artists[sample.artist] =
    (month.artists[sample.artist] ?? 0) + sample.seconds;
  const song = (month.songs[sample.videoId] ??= {
    title: sample.title,
    artist: sample.artist,
    art: sample.art,
    seconds: 0,
    plays: 0,
  });
  song.seconds += sample.seconds;
  if (sample.art) song.art = sample.art;

  // Cada vez que empieza a sonar cuenta como una reproducción (tras 30 s)
  if (current?.id !== sample.videoId)
    current = { id: sample.videoId, seconds: 0, counted: false };
  current.seconds += sample.seconds;
  if (!current.counted && current.seconds >= PLAY_SECONDS) {
    current.counted = true;
    song.plays += 1;
  }
  saveMonths(months);
};

// Meses con datos, del más reciente al más antiguo
export const availableMonths = () =>
  Object.entries(loadMonths())
    .filter(([, stats]) => stats.seconds >= 60)
    .map(([key]) => key)
    .sort()
    .reverse();

// ---------- Vista ----------
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const glass = (className = '') => el('div', `lg-wr-glass ${className}`.trim());

const formatNumber = (value: number) =>
  Math.round(value).toLocaleString(undefined);

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

export class WrappedView {
  private overlay: HTMLDivElement | null = null;
  private page = 0;

  constructor(
    private readonly text: WrappedText,
    private readonly saveImage: (
      rect: { x: number; y: number; width: number; height: number },
      name: string,
    ) => Promise<boolean>,
  ) {}

  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.overlay) return;
    if (event.key === 'Escape') this.close();
    if (event.key === 'ArrowRight') this.go(this.page + 1);
    if (event.key === 'ArrowLeft') this.go(this.page - 1);
  };

  open(key: string) {
    const month = loadMonths()[key];
    if (!month) return;
    this.close();
    this.page = 0;

    const overlay = el('div', 'lg-wrapped');
    const stage = el('div', 'lg-wr-stage');
    const stories = [
      this.cover(key, month),
      this.artists(month),
      this.songs(month),
      this.moment(month),
    ];
    const accent =
      getComputedStyle(document.body).getPropertyValue('--lg-accent').trim() ||
      PALETTES[0][0];
    stories.forEach((story, index) => {
      const [first, second, third] = PALETTES[index];
      story.style.setProperty('--wr-a', index === 0 ? accent : first);
      story.style.setProperty('--wr-b', second);
      story.style.setProperty('--wr-c', third);
      stage.append(story);
    });

    const previous = el('button', 'lg-wr-nav prev', '‹');
    const next = el('button', 'lg-wr-nav next', '›');
    previous.addEventListener('click', () => this.go(this.page - 1));
    next.addEventListener('click', () => this.go(this.page + 1));
    const dots = el('div', 'lg-wr-dots');
    stories.forEach((_, index) => {
      const dot = el('button', 'lg-wr-dot');
      dot.addEventListener('click', () => this.go(index));
      dots.append(dot);
    });
    const close = el('button', 'lg-wr-close', '✕');
    close.title = this.text('close');
    close.addEventListener('click', () => this.close());
    const save = el('button', 'lg-wr-save', this.text('save'));
    save.addEventListener('click', () => {
      const story = stories[this.page];
      const rect = story.getBoundingClientRect();
      overlay.classList.add('capturing');
      // Un fotograma sin los botones antes de capturar
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          this.saveImage(
            {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            `MusicSense-${monthName(key)}-${this.page + 1}.png`,
          )
            .catch(console.error)
            .finally(() => overlay.classList.remove('capturing'));
        }),
      );
    });

    overlay.append(stage, previous, next, dots, close, save);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    document.body.append(overlay);
    document.addEventListener('keydown', this.onKey);
    this.overlay = overlay;
    this.go(0);
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
  }

  private go(page: number) {
    const overlay = this.overlay;
    if (!overlay) return;
    const stories = overlay.querySelectorAll<HTMLElement>('.lg-wr-story');
    this.page = Math.max(0, Math.min(stories.length - 1, page));
    stories.forEach((story, index) =>
      story.classList.toggle('active', index === this.page),
    );
    overlay
      .querySelectorAll('.lg-wr-dot')
      .forEach((dot, index) =>
        dot.classList.toggle('active', index === this.page),
      );
    overlay
      .querySelector('.lg-wr-nav.prev')
      ?.classList.toggle('hidden', this.page === 0);
    overlay
      .querySelector('.lg-wr-nav.next')
      ?.classList.toggle('hidden', this.page === stories.length - 1);
  }

  private story(name: string) {
    const story = el('section', `lg-wr-story ${name}`);
    for (const blob of ['a', 'b', 'c'])
      story.append(el('span', `lg-wr-blob ${blob}`));
    const content = el('div', 'lg-wr-content');
    const brand = el('div', 'lg-wr-brand');
    brand.append(el('span', 'lg-wr-logo'), el('span', '', 'MusicSense'));
    content.append(brand);
    story.append(content);
    return { story, content };
  }

  private cover(key: string, month: MonthStats) {
    const { story, content } = this.story('cover');
    content.append(el('div', 'lg-wr-spacer'));
    content.append(
      el('h2', 'lg-wr-title', this.text('title', { month: monthName(key) })),
      el('h2', 'lg-wr-title dim', this.text('subtitle')),
    );
    const card = glass();
    card.append(
      el('strong', 'lg-wr-huge', formatNumber(month.seconds / 60)),
      el('span', 'lg-wr-label', this.text('minutes')),
    );
    content.append(card);
    const row = el('div', 'lg-wr-row');
    const facts: [number, string][] = [
      [Object.keys(month.days).length, this.text('days')],
      [Object.keys(month.songs).length, this.text('songs')],
      [Object.keys(month.artists).length, this.text('artists')],
    ];
    for (const [value, label] of facts) {
      const fact = glass('small');
      fact.append(
        el('strong', 'lg-wr-big', formatNumber(value)),
        el('span', 'lg-wr-label', label),
      );
      row.append(fact);
    }
    content.append(row);
    return story;
  }

  private artists(month: MonthStats) {
    const { story, content } = this.story('artists');
    content.append(el('h2', 'lg-wr-title small', this.text('artists-title')));
    const top = Object.entries(month.artists)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    // Foto: la portada de su canción más escuchada del mes
    const artOf = (artist: string) =>
      Object.values(month.songs)
        .filter((song) => song.artist === artist && song.art)
        .sort((a, b) => b.seconds - a.seconds)[0]?.art ?? '';
    const [first, ...rest] = top;
    if (first) {
      const hero = glass('hero');
      const photo = el('img', 'lg-wr-photo round');
      photo.src = artOf(first[0]);
      hero.append(
        photo,
        el('strong', 'lg-wr-name', first[0]),
        el(
          'span',
          'lg-wr-label',
          this.text('top-artist', { minutes: formatNumber(first[1] / 60) }),
        ),
      );
      content.append(hero);
    }
    if (rest.length) {
      const list = glass();
      rest.forEach(([artist, seconds], index) => {
        const row = el('div', 'lg-wr-item');
        const photo = el('img', 'lg-wr-thumb round');
        photo.src = artOf(artist);
        row.append(
          el('span', 'lg-wr-rank', String(index + 2)),
          photo,
          el('span', 'lg-wr-item-name', artist),
          el('span', 'lg-wr-item-value', formatDuration(seconds)),
        );
        list.append(row);
      });
      content.append(list);
    }
    return story;
  }

  private songs(month: MonthStats) {
    const { story, content } = this.story('songs');
    content.append(el('h2', 'lg-wr-title small', this.text('songs-title')));
    const top = Object.values(month.songs)
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .slice(0, 5);
    const list = glass('songs');
    top.forEach((song, index) => {
      const row = el('div', `lg-wr-item${index === 0 ? ' first' : ''}`);
      const art = el('img', 'lg-wr-thumb');
      art.src = song.art;
      const texts = el('div', 'lg-wr-item-text');
      texts.append(
        el('span', 'lg-wr-item-name', song.title),
        el('span', 'lg-wr-item-sub', song.artist),
      );
      row.append(
        art,
        texts,
        el(
          'span',
          'lg-wr-item-value',
          this.text('plays', { count: Math.max(1, song.plays) }),
        ),
      );
      list.append(row);
    });
    content.append(list);
    return story;
  }

  private moment(month: MonthStats) {
    const { story, content } = this.story('moment');
    content.append(el('h2', 'lg-wr-title small', this.text('moment-title')));
    const peak = month.hours.indexOf(Math.max(...month.hours));
    const hourCard = glass();
    hourCard.append(
      el('strong', 'lg-wr-huge', `${String(peak).padStart(2, '0')}:00`),
      el('span', 'lg-wr-label', this.text('favorite-hour')),
    );
    const bars = el('div', 'lg-wr-bars');
    const max = Math.max(1, ...month.hours);
    month.hours.forEach((seconds, hour) => {
      const bar = el('span', hour === peak ? 'peak' : '');
      const scaled = (seconds / max) * 90;
      bar.style.height = `${8 + scaled}px`;
      bars.append(bar);
    });
    hourCard.append(bars);
    content.append(hourCard);

    const [day, seconds] = Object.entries(month.days).sort(
      (a, b) => b[1] - a[1],
    )[0] ?? ['1', 0];
    const dayCard = glass();
    dayCard.append(
      el('strong', 'lg-wr-big', this.text('day', { day })),
      el(
        'span',
        'lg-wr-label',
        this.text('best-day', { time: formatDuration(seconds) }),
      ),
    );
    content.append(dayCard);
    return story;
  }
}
