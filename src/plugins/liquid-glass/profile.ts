/*
 * Página de tu perfil: tarjetas de Integraciones y Estadísticas bajo la
 * cabecera del canal (solo en tu propio perfil, clase lg-profile-page).
 *
 * - Integraciones: interruptores de los complementos Discord Rich Presence y
 *   Scrobbler (Last.fm / ListenBrainz), que se activan desde el menú de la
 *   app igual que en el panel de ajustes.
 * - Estadísticas: YouTube Music no las ofrece, así que se registran en este
 *   PC (localStorage) a partir de ahora: tiempo escuchado por artista y total.
 */

import { availableMonths, monthKey, recordListening } from './wrapped';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

type MenuNode = {
  label: string;
  type: string;
  commandId: number;
  checked?: boolean;
  submenu?: { items: MenuNode[] };
};

type Stats = {
  since: number;
  total: number;
  artists: Record<string, number>;
};

export type ProfileLabels = {
  integrations: string;
  stats: string;
  statsEmpty: string;
  statsSince: (date: string) => string;
  minutes: (count: number) => string;
  discord: string;
  scrobbler: string;
  share: string;
  // Botón del resumen mensual ("Ver tu resumen de septiembre")
  wrapped: (month: string) => string;
};

const STATS_KEY = 'lg-stats';
const COLORS = [
  '#fa2d48',
  '#ff9f0a',
  '#30d158',
  '#64d2ff',
  '#bf5af2',
  '#8e8e93',
];

// Complementos de Pear que se muestran como integraciones (por su nombre en
// el menú, que no se traduce)
const INTEGRATIONS: { match: RegExp; label: keyof ProfileLabels }[] = [
  { match: /^Discord/i, label: 'discord' },
  { match: /^Scrobbler/i, label: 'scrobbler' },
];

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

// Foto real del canal (YouTube pone antes una imagen de relleno), pedida a
// 240 px para que se vea nítida en la tarjeta
const avatarUrl = (header: Element | null) => {
  const image = [...(header?.querySelectorAll('img') ?? [])].find((img) =>
    img.src.startsWith('https://'),
  );
  // La cabecera está oculta y a veces su foto no llega a cargarse: la de la
  // cuenta (barra superior) es la misma
  const account = document.querySelector<HTMLImageElement>(
    'ytmusic-nav-bar ytmusic-settings-button img',
  );
  const src =
    image?.src ?? (account?.src.startsWith('https://') ? account.src : '');
  return src.replace(/=s\d+/, '=s240');
};

const loadStats = (): Stats => {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw) as Stats;
  } catch {
    // Datos dañados: se empieza de cero
  }
  return { since: Date.now(), total: 0, artists: {} };
};

const saveStats = (stats: Stats) => {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Sin espacio: no se guardan
  }
};

const pluginToggle = (node: MenuNode) => {
  if (node.type === 'checkbox') return node;
  const [first, second] = node.submenu?.items ?? [];
  return first?.type === 'checkbox' && second?.type === 'separator'
    ? first
    : undefined;
};

export class ProfilePage {
  private cards: HTMLDivElement | null = null;
  private timer: number | null = null;
  private recordTimer: number | null = null;
  private stats = loadStats();
  private lastRender = 0;

  constructor(
    private readonly labels: ProfileLabels,
    private readonly invoke: Invoke,
    private readonly openWrapped: (month: string) => void,
  ) {}

  start() {
    this.timer = window.setInterval(() => this.tick(), 700);
    // Cada 5 s de reproducción se suman al artista que suena
    this.recordTimer = window.setInterval(() => this.record(), 5000);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.recordTimer !== null) window.clearInterval(this.recordTimer);
    this.timer = null;
    this.recordTimer = null;
    this.cards?.remove();
    this.cards = null;
  }

  private record() {
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    if (!video || video.paused || video.ended) return;
    const artist =
      document
        .querySelector('ytmusic-player-bar .content-info-wrapper .byline')
        ?.textContent?.split('•')[0]
        ?.trim() ?? '';
    if (!artist) return;
    // Resumen mensual (wrapped.ts): canción, portada, día y hora
    const videoId =
      document
        .querySelector<
          HTMLElement & { getVideoData?: () => { video_id?: string } }
        >('#movie_player')
        ?.getVideoData?.()?.video_id ?? '';
    if (videoId)
      recordListening({
        videoId,
        title:
          document
            .querySelector('ytmusic-player-bar .content-info-wrapper .title')
            ?.textContent?.trim() ?? '',
        artist,
        art:
          document
            .querySelector<HTMLImageElement>('ytmusic-player-bar img.image')
            ?.src.replace(/=w\d+-h\d+[^&?]*/, '=w240-h240-l90-rj') ?? '',
        seconds: 5,
      });
    this.stats.total += 5;
    this.stats.artists[artist] = (this.stats.artists[artist] ?? 0) + 5;
    saveStats(this.stats);
  }

  private tick() {
    if (!document.body.classList.contains('lg-profile-page')) {
      this.cards?.remove();
      this.cards = null;
      return;
    }
    // Dentro del bloque que se desplaza al abrir el menú lateral (la cabecera
    // original, que se oculta, queda fuera de él)
    const wrapper = document.querySelector(
      'ytmusic-browse-response #content-wrapper',
    );
    const header = document.querySelector(
      'ytmusic-browse-response #header ytmusic-visual-header-renderer',
    );
    // Esperar a que la cabecera tenga datos (antes solo hay un esqueleto gris)
    if (!wrapper || !avatarUrl(header)) return;
    if (!this.cards?.isConnected) {
      this.cards = el('div', 'lg-profile-cards');
      wrapper.prepend(this.cards);
      this.render().catch(console.error);
    } else if (Date.now() - this.lastRender > 15000) {
      this.render().catch(console.error);
    }
  }

  private async render() {
    if (!this.cards) return;
    this.lastRender = Date.now();
    const integrations = await this.renderIntegrations();
    this.cards?.replaceChildren(
      integrations,
      this.renderIdentity(),
      this.renderStats(),
    );
  }

  // ---------- Centro: foto, nombre, suscriptores y compartir ----------
  private renderIdentity() {
    const header = document.querySelector(
      'ytmusic-browse-response #header ytmusic-visual-header-renderer',
    );
    const card = el('section', 'lg-card lg-identity');
    const src = avatarUrl(header);
    if (src) {
      const image = el('img', 'lg-identity-avatar');
      image.src = src;
      image.alt = '';
      card.append(image);
    }
    const name = header?.querySelector('.title')?.textContent?.trim() ?? '';
    card.append(el('h2', 'lg-identity-name', name));
    const subscribers =
      header
        ?.querySelector('ytmusic-subscribe-button-renderer')
        ?.textContent?.trim() ?? '';
    if (subscribers) card.append(el('div', 'lg-identity-sub', subscribers));

    // "Compartir" de YouTube Music (el último botón de la cabecera; "Editar"
    // no se muestra)
    const share = el('button', 'lg-identity-share', this.labels.share);
    share.type = 'button';
    share.addEventListener('click', () => {
      const buttons = header?.querySelectorAll<HTMLElement>(
        'yt-button-renderer button',
      );
      buttons?.[buttons.length - 1]?.click();
    });
    card.append(share);
    return card;
  }

  // ---------- Integraciones ----------
  private async renderIntegrations() {
    const card = el('section', 'lg-card');
    card.append(el('h3', 'lg-card-title', this.labels.integrations));

    const menu = (await this.invoke('liquid-glass:get-menu')) as {
      items?: MenuNode[];
    } | null;
    const plugins = menu?.items?.[0]?.submenu?.items ?? [];

    for (const { match, label } of INTEGRATIONS) {
      const plugin = plugins.find((item) => match.test(item.label));
      const toggle = plugin && pluginToggle(plugin);
      if (!toggle) continue;

      const row = el('div', 'lg-card-row');
      row.append(el('span', '', String(this.labels[label])));
      const button = el('button', 'lg-switch');
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', String(Boolean(toggle.checked)));
      button.append(el('span'));
      button.addEventListener('click', () => {
        button.setAttribute(
          'aria-checked',
          String(button.getAttribute('aria-checked') !== 'true'),
        );
        this.invoke('liquid-glass:menu-click', toggle.commandId)
          .then(() => window.setTimeout(() => this.render(), 200))
          .catch(console.error);
      });
      row.append(button);
      card.append(row);
    }
    return card;
  }

  // ---------- Estadísticas ----------
  private renderStats() {
    this.stats = loadStats();
    const card = el('section', 'lg-card');
    card.append(el('h3', 'lg-card-title', this.labels.stats));

    const top = Object.entries(this.stats.artists)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (top.length === 0) {
      card.append(el('p', 'lg-card-empty', this.labels.statsEmpty));
      card.append(this.wrappedButtons());
      return card;
    }

    const topTotal = top.reduce((sum, [, seconds]) => sum + seconds, 0);
    const rest = Math.max(0, this.stats.total - topTotal);
    const slices = rest > 0 ? [...top, ['…', rest] as [string, number]] : top;

    // Gráfico circular con conic-gradient
    let angle = 0;
    const stops = slices.map(([, seconds], index) => {
      const start = angle;
      angle += (seconds / this.stats.total) * 360;
      return `${COLORS[index]} ${start}deg ${angle}deg`;
    });
    const body = el('div', 'lg-stats');
    const donut = el('div', 'lg-stats-donut');
    donut.style.background = `conic-gradient(${stops.join(', ')})`;
    const center = el('div', 'lg-stats-center');
    center.append(
      el('strong', '', String(Math.round(this.stats.total / 60))),
      el('span', '', 'min'),
    );
    donut.append(center);

    const legend = el('ul', 'lg-stats-legend');
    top.forEach(([artist, seconds], index) => {
      const item = el('li');
      const dot = el('span', 'lg-stats-dot');
      dot.style.background = COLORS[index];
      item.append(
        dot,
        el('span', 'lg-stats-name', artist),
        el(
          'span',
          'lg-stats-value',
          this.labels.minutes(Math.max(1, Math.round(seconds / 60))),
        ),
      );
      legend.append(item);
    });
    body.append(donut, legend);
    card.append(body);

    const since = new Date(this.stats.since).toLocaleDateString();
    card.append(el('p', 'lg-card-note', this.labels.statsSince(since)));
    card.append(this.wrappedButtons());
    return card;
  }

  // Resumen mensual: el mes actual y los anteriores con datos
  private wrappedButtons() {
    const row = el('div', 'lg-wrapped-buttons');
    const months = availableMonths();
    if (!months.length) return row;
    const current = monthKey();
    for (const key of months.slice(0, 6)) {
      const [year, month] = key.split('-').map(Number);
      const name = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        ...(year === new Date().getFullYear() ? {} : { year: 'numeric' }),
      });
      const button = el(
        'button',
        key === current ? 'lg-wrapped-button main' : 'lg-wrapped-button',
        key === current ? this.labels.wrapped(name) : name,
      );
      button.addEventListener('click', () => this.openWrapped(key));
      row.append(button);
    }
    return row;
  }
}
