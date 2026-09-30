/*
 * Estado de Discord en la página (el envío a Discord está en discord.ts):
 * - Manda al proceso principal las imágenes de la canción que suena: la
 *   portada en buena resolución y la foto del artista (pedida a YouTube
 *   Music con la sesión del usuario, guardada por artista).
 * - Pestaña "Discord" del panel de ajustes: vista previa de cómo te ven tus
 *   amigos, cabecera "Listening to…", icono pequeño y opciones.
 */

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Translate = (key: string, vars?: Record<string, unknown>) => string;

type Header = 'app' | 'song' | 'artist';
type Small = 'app' | 'album' | 'artist' | 'none';

type State = {
  enabled: boolean;
  header: Header;
  small: Small;
  progress: boolean;
  button: boolean;
  pauseTimeout: number;
  clientId: string;
  connected: boolean;
  customApp: boolean;
  appIcon: string;
};

type AppElement = HTMLElement & {
  networkManager?: {
    fetch: (url: string, body: Record<string, unknown>) => Promise<unknown>;
  };
};

const APP_NAME = 'MusicSense';
const PAUSE_OPTIONS = [0, 5, 10, 30];

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

// Busca la primera lista de miniaturas dentro de una respuesta de YouTube
const findThumbnails = (
  value: unknown,
  depth = 0,
): { url: string; width: number }[] | null => {
  if (!value || typeof value !== 'object' || depth > 9) return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.thumbnails))
    return record.thumbnails as { url: string; width: number }[];
  for (const key of Object.keys(record)) {
    const found = findThumbnails(record[key], depth + 1);
    if (found) return found;
  }
  return null;
};

// Las imágenes de Google permiten pedir otro tamaño (p = recortar a cuadrado)
const squareImage = (url: string, size: number) =>
  /googleusercontent\.com|ggpht\.com/.test(url)
    ? `${url.split('=')[0]}=w${size}-h${size}-p-l90-rj`
    : url;

const nowPlaying = () => {
  const bar = document.querySelector('ytmusic-player-bar');
  const player = document.querySelector<
    HTMLElement & { getVideoData?: () => { video_id?: string } }
  >('#movie_player');
  const byline = [
    ...(bar?.querySelectorAll<HTMLAnchorElement>('.byline a') ?? []),
  ];
  const artistLink = byline.find((link) =>
    link.getAttribute('href')?.includes('channel/'),
  );
  const albumLink = byline.find((link) =>
    link.getAttribute('href')?.includes('browse/MPRE'),
  );
  const video = document.querySelector<HTMLVideoElement>(
    '#movie_player video.video-stream',
  );
  return {
    videoId: player?.getVideoData?.()?.video_id ?? '',
    title:
      bar?.querySelector('.content-info-wrapper .title')?.textContent?.trim() ??
      '',
    artist:
      artistLink?.textContent?.trim() ??
      bar
        ?.querySelector('.content-info-wrapper .byline')
        ?.textContent?.split('•')[0]
        ?.trim() ??
      '',
    artistId:
      artistLink
        ?.getAttribute('href')
        ?.split('channel/')[1]
        ?.split(/[?/]/)[0] ?? '',
    album: albumLink?.textContent?.trim() ?? '',
    cover: bar?.querySelector<HTMLImageElement>('img.image')?.src ?? '',
    elapsed: video?.currentTime ?? 0,
    duration: Number.isFinite(video?.duration) ? (video?.duration ?? 0) : 0,
  };
};

const time = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
};

export class DiscordView {
  private timer: number | null = null;
  private sentFor = '';
  private readonly artists = new Map<string, string>();

  constructor(
    private readonly tr: Translate,
    private readonly invoke: Invoke,
    private readonly refresh: () => void,
  ) {}

  start() {
    this.timer = window.setInterval(() => {
      this.sendArt().catch(console.error);
    }, 1500);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- Imágenes para Discord ----------

  private async artistImage(id: string) {
    if (!id) return '';
    const cached = this.artists.get(id);
    if (cached !== undefined) return cached;
    const app = document.querySelector<AppElement>('ytmusic-app');
    let url = '';
    try {
      const response = await app?.networkManager?.fetch(
        '/browse?prettyPrint=false',
        { browseId: id },
      );
      const header = (response as { header?: unknown } | undefined)?.header;
      const thumbnails = findThumbnails(header);
      const best = thumbnails?.at(-1)?.url ?? '';
      url = best ? squareImage(best, 512) : '';
    } catch {
      // Sin foto: Discord mostrará el icono elegido sin imagen
    }
    this.artists.set(id, url);
    return url;
  }

  private async sendArt() {
    const song = nowPlaying();
    if (!song.videoId || !song.cover.startsWith('https://')) return;
    const key = `${song.videoId}|${song.cover}|${song.artistId}`;
    if (key === this.sentFor) return;
    this.sentFor = key;
    const artist = await this.artistImage(song.artistId);
    await this.invoke('liquid-glass:discord-art', {
      videoId: song.videoId,
      cover: squareImage(song.cover, 512),
      artist,
    });
  }

  // ---------- Pestaña de ajustes ----------

  async render() {
    const state = (await this.invoke('liquid-glass:discord-state').catch(
      () => null,
    )) as State | null;
    const fragment = document.createDocumentFragment();
    if (!state) return fragment;

    // Activar y estado de la conexión
    const main = el('div', 'lg-settings-card');
    main.append(
      this.switchRow(
        this.tr('enabled'),
        state.enabled,
        (value) => this.save({ enabled: value }),
        state.enabled
          ? state.connected
            ? this.tr('connected')
            : this.tr('not-running')
          : this.tr('enabled-desc'),
      ),
    );
    fragment.append(main);

    // Vista previa
    fragment.append(
      el('div', 'lg-settings-section', this.tr('preview')),
      await this.preview(state),
    );

    // Cabecera y el icono pequeño
    fragment.append(
      el('div', 'lg-settings-section', this.tr('header')),
      this.choice<Header>(
        ['app', 'song', 'artist'],
        state.header,
        (value) => this.tr(`header-${value}`),
        (header) => this.save({ header }),
      ),
      el('div', 'lg-settings-section', this.tr('small')),
      this.choice<Small>(
        ['app', 'album', 'artist', 'none'],
        state.small,
        (value) => this.tr(`small-${value}`),
        (small) => this.save({ small }),
      ),
    );
    if (state.small === 'app' && !state.customApp)
      fragment.append(el('div', 'lg-lastfm-note', this.tr('app-icon-note')));

    // Opciones
    const options = el('div', 'lg-settings-card');
    options.append(
      this.switchRow(this.tr('progress'), state.progress, (value) =>
        this.save({ progress: value }),
      ),
      this.switchRow(this.tr('button'), state.button, (value) =>
        this.save({ button: value }),
      ),
    );
    fragment.append(
      el('div', 'lg-settings-section', this.tr('options')),
      options,
      el('div', 'lg-settings-section', this.tr('pause')),
      this.choice<string>(
        PAUSE_OPTIONS.map(String),
        String(state.pauseTimeout),
        (value) =>
          value === '0'
            ? this.tr('pause-never')
            : this.tr('pause-minutes', { count: value }),
        (value) => this.save({ pauseTimeout: Number(value) }),
      ),
    );

    // Avanzado: aplicación de Discord propia
    const form = el('form', 'lg-lastfm-form');
    form.append(el('div', 'lg-settings-desc', this.tr('app-desc')));
    const input = el('input', 'lg-lastfm-input');
    input.placeholder = this.tr('app-id');
    input.value = state.clientId;
    input.inputMode = 'numeric';
    const buttons = el('div', 'lg-lastfm-buttons');
    const save = el('button', 'lg-lastfm-button primary', this.tr('save'));
    save.type = 'submit';
    const reset = el('button', 'lg-lastfm-button', this.tr('app-reset'));
    reset.type = 'button';
    reset.addEventListener('click', () => this.save({ clientId: '' }));
    buttons.append(save, reset);
    form.append(input, buttons);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.save({ clientId: input.value });
    });
    const advanced = el('div', 'lg-settings-card');
    advanced.append(form);
    fragment.append(
      el('div', 'lg-settings-section', this.tr('advanced')),
      advanced,
    );
    return fragment;
  }

  private save(options: Partial<State>) {
    this.invoke('liquid-glass:discord-options', options)
      .then(() => this.refresh())
      .catch(console.error);
  }

  private switchRow(
    label: string,
    checked: boolean,
    change: (value: boolean) => void,
    description = '',
  ) {
    const row = el('div', 'lg-settings-row clickable');
    const text = el('div', 'lg-settings-text');
    text.append(el('div', 'lg-settings-label', label));
    if (description) text.append(el('div', 'lg-settings-desc', description));
    const toggle = el('button', 'lg-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(checked));
    toggle.append(el('span'));
    row.append(text, toggle);
    row.addEventListener('click', () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(next));
      change(next);
    });
    return row;
  }

  // Cápsula de opciones (una sola elegida)
  private choice<T extends string>(
    values: T[],
    current: T,
    label: (value: T) => string,
    change: (value: T) => void,
  ) {
    const group = el('div', 'lg-discord-choice');
    for (const value of values) {
      const button = el('button', 'lg-discord-option', label(value));
      button.type = 'button';
      button.classList.toggle('active', value === current);
      button.addEventListener('click', () => {
        if (value !== current) change(value);
      });
      group.append(button);
    }
    return group;
  }

  // Tarjeta como la del perfil de Discord, con la canción que suena
  private async preview(state: State) {
    const song = nowPlaying();
    const card = el('div', 'lg-discord-card');
    if (!song.title) {
      card.append(el('div', 'lg-settings-desc', this.tr('preview-empty')));
      return card;
    }
    const header = { app: APP_NAME, song: song.title, artist: song.artist }[
      state.header
    ];
    card.append(
      el(
        'div',
        'lg-discord-heading',
        this.tr('listening-to', { name: header }),
      ),
    );

    const body = el('div', 'lg-discord-body');
    const art = el('div', 'lg-discord-art');
    const cover = el('img', 'lg-discord-cover');
    cover.src = squareImage(song.cover, 240);
    cover.alt = '';
    art.append(cover);
    const smallSource = {
      app: state.appIcon,
      album: squareImage(song.cover, 120),
      artist: await this.artistImage(song.artistId),
      none: '',
    }[state.small];
    if (smallSource) {
      const small = el('img', 'lg-discord-small');
      small.src = smallSource;
      small.alt = '';
      art.append(small);
    }

    const text = el('div', 'lg-discord-text');
    text.append(
      el('div', 'lg-discord-title', song.title),
      el('div', 'lg-discord-line', song.artist),
    );
    if (song.album) text.append(el('div', 'lg-discord-line', song.album));
    if (state.progress && song.duration > 0) {
      const bar = el('div', 'lg-discord-progress');
      const track = el('div', 'lg-discord-track');
      const fill = el('span');
      const done = (song.elapsed / song.duration) * 100;
      fill.style.width = `${Math.min(100, done)}%`;
      track.append(fill);
      bar.append(
        el('span', '', time(song.elapsed)),
        track,
        el('span', '', time(song.duration)),
      );
      text.append(bar);
    }
    body.append(art, text);
    card.append(body);
    if (state.button)
      card.append(el('div', 'lg-discord-button', this.tr('listen-button')));
    return card;
  }
}
