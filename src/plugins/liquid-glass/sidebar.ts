/*
 * Menú lateral: solo la biblioteca (Principal, Explorar y Biblioteca están en
 * la barra superior).
 * - Arriba, filtros en cápsula como los de la página Biblioteca: Playlists
 *   (la lista de YouTube Music, con "Nueva playlist"), Álbumes y Artistas.
 * - Álbumes y Artistas se piden a YouTube Music con la sesión de la app (las
 *   mismas consultas que la Biblioteca) y se renuevan cada 10 minutos.
 * - Sin sesión iniciada se deja el menú original.
 */

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

type Filter = 'playlists' | 'albums' | 'artists';

type LibraryItem = {
  title: string;
  subtitle: string;
  thumbnail: string;
  browseId: string;
};

type Runs = { runs?: { text: string }[] };
type Thumbnail = {
  musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url: string }[] } };
};

export type SidebarLabels = {
  playlists: string;
  albums: string;
  artists: string;
  empty: string;
};

const FILTER_KEY = 'lg-guide-filter';
const FILTERED_CLASS = 'lg-guide-filtered';
const SIGNED_IN_CLASS = 'lg-guide-library';
const REFRESH_MS = 10 * 60 * 1000;
// Páginas que se piden como máximo (la primera trae 25 y las demás 50)
const MAX_PAGES = 8;

const BROWSE_IDS: Record<Exclude<Filter, 'playlists'>, string> = {
  albums: 'FEmusic_liked_albums',
  artists: 'FEmusic_library_corpus_track_artists',
};

const text = (runs?: Runs) => runs?.runs?.map((run) => run.text).join('') ?? '';
const thumbnailUrl = (thumbnail?: Thumbnail) =>
  thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ?? '';

const isSignedIn = () =>
  Boolean(document.querySelector('ytmusic-nav-bar ytmusic-settings-button'));

const app = () => document.querySelector<MusicPlayerAppElement>('ytmusic-app');

// Elementos de una respuesta de YouTube Music (álbumes en cuadrícula, artistas
// en lista) y el código para pedir la página siguiente
const parse = (response: unknown) => {
  const items: LibraryItem[] = [];
  let next = '';
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const two = record.musicTwoRowItemRenderer as
      | {
          title?: Runs;
          subtitle?: Runs;
          thumbnailRenderer?: Thumbnail;
          navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
        }
      | undefined;
    const row = record.musicResponsiveListItemRenderer as
      | {
          flexColumns?: {
            musicResponsiveListItemFlexColumnRenderer?: { text?: Runs };
          }[];
          thumbnail?: Thumbnail;
          navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
        }
      | undefined;
    if (two) {
      const browseId = two.navigationEndpoint?.browseEndpoint?.browseId ?? '';
      // "Álbum • Artista • Año" → "Artista • Año"
      const subtitle = text(two.subtitle).split(' • ').slice(1).join(' • ');
      if (browseId)
        items.push({
          title: text(two.title),
          subtitle,
          thumbnail: thumbnailUrl(two.thumbnailRenderer),
          browseId,
        });
      return;
    }
    if (row) {
      const columns = (row.flexColumns ?? []).map((column) =>
        text(column.musicResponsiveListItemFlexColumnRenderer?.text),
      );
      // Artistas de la biblioteca: "MPLA" + id del canal → página del artista
      const id = row.navigationEndpoint?.browseEndpoint?.browseId ?? '';
      const browseId = id.startsWith('MPLA') ? id.slice(4) : id;
      if (browseId)
        items.push({
          title: columns[0] ?? '',
          subtitle: columns[1] ?? '',
          thumbnail: thumbnailUrl(row.thumbnail),
          browseId,
        });
      return;
    }
    const continuation = record.nextContinuationData as
      | { continuation?: string }
      | undefined;
    if (continuation?.continuation) next = continuation.continuation;
    const command = record.continuationCommand as
      | { token?: string }
      | undefined;
    if (command?.token) next = command.token;
    for (const value of Object.values(record)) walk(value);
  };
  walk(response);
  return { items, next };
};

export class LibrarySidebar {
  private chips: HTMLDivElement | null = null;
  private list: HTMLDivElement | null = null;
  private filter: Filter = 'playlists';
  private cache = new Map<Filter, { items: LibraryItem[]; at: number }>();
  private loading = new Set<Filter>();
  private rendered = '';
  private timer: number | null = null;

  constructor(private readonly labels: SidebarLabels) {}

  start() {
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      if (saved === 'albums' || saved === 'artists') this.filter = saved;
    } catch {
      // Sin acceso al almacenamiento: se empieza en Playlists
    }
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.chips?.remove();
    this.list?.remove();
    this.chips = null;
    this.list = null;
    this.rendered = '';
    document.body.classList.remove(FILTERED_CLASS, SIGNED_IN_CLASS);
  }

  private tick() {
    const guide = document.querySelector<HTMLElement>('#guide-renderer');
    const signedIn = isSignedIn();
    document.body.classList.toggle(SIGNED_IN_CLASS, signedIn);
    if (!guide || !signedIn) {
      document.body.classList.remove(FILTERED_CLASS);
      return;
    }
    this.ensureElements(guide);
    document.body.classList.toggle(FILTERED_CLASS, this.filter !== 'playlists');
    if (this.filter !== 'playlists') {
      this.load(this.filter).catch(console.error);
      this.render();
    }
  }

  private ensureElements(guide: HTMLElement) {
    if (!this.chips?.isConnected) {
      const chips = document.createElement('div');
      chips.className = 'lg-guide-filters';
      const filters: [Filter, string][] = [
        ['playlists', this.labels.playlists],
        ['albums', this.labels.albums],
        ['artists', this.labels.artists],
      ];
      for (const [filter, label] of filters) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lg-guide-filter';
        chip.dataset.filter = filter;
        chip.textContent = label;
        chip.addEventListener('click', () => this.select(filter));
        chips.append(chip);
      }
      guide.prepend(chips);
      this.chips = chips;
    }
    for (const chip of this.chips.querySelectorAll<HTMLElement>(
      '.lg-guide-filter',
    )) {
      chip.classList.toggle('active', chip.dataset.filter === this.filter);
    }

    if (!this.list?.isConnected) {
      const list = document.createElement('div');
      list.className = 'lg-guide-list';
      guide.append(list);
      this.list = list;
      this.rendered = '';
    }
  }

  private select(filter: Filter) {
    if (filter === this.filter) return;
    this.filter = filter;
    try {
      localStorage.setItem(FILTER_KEY, filter);
    } catch {
      // Solo se pierde el filtro elegido al reiniciar
    }
    this.list?.scrollTo({ top: 0 });
    this.tick();
  }

  private async load(filter: Exclude<Filter, 'playlists'>) {
    const cached = this.cache.get(filter);
    if (cached && Date.now() - cached.at < REFRESH_MS) return;
    if (this.loading.has(filter)) return;
    const network = app()?.networkManager;
    if (!network) return;
    this.loading.add(filter);
    try {
      let page = parse(
        await network.fetch<unknown, { browseId: string }>(
          '/browse?prettyPrint=false',
          { browseId: BROWSE_IDS[filter] },
        ),
      );
      const items = [...page.items];
      for (let i = 1; i < MAX_PAGES && page.next; i++) {
        page = parse(
          await network.fetch<unknown, { continuation: string }>(
            '/browse?prettyPrint=false',
            { continuation: page.next },
          ),
        );
        items.push(...page.items);
      }
      this.cache.set(filter, { items, at: Date.now() });
      this.render();
    } finally {
      this.loading.delete(filter);
    }
  }

  private render() {
    if (!this.list || this.filter === 'playlists') return;
    const items = this.cache.get(this.filter)?.items;
    const key = `${this.filter}:${items?.length ?? -1}:${items?.[0]?.browseId ?? ''}`;
    if (key === this.rendered) return;
    this.rendered = key;
    this.list.classList.toggle('artists', this.filter === 'artists');

    if (!items) {
      this.list.replaceChildren();
      return;
    }
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lg-guide-empty';
      empty.textContent = this.labels.empty;
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'lg-guide-item';
        row.title = item.title;
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        if (item.thumbnail) image.src = item.thumbnail;
        const texts = document.createElement('span');
        texts.className = 'lg-guide-item-text';
        const title = document.createElement('span');
        title.className = 'lg-guide-item-title';
        title.textContent = item.title;
        const subtitle = document.createElement('span');
        subtitle.className = 'lg-guide-item-subtitle';
        subtitle.textContent = item.subtitle;
        texts.append(title, subtitle);
        row.append(image, texts);
        row.addEventListener('click', () => app()?.navigate(item.browseId));
        return row;
      }),
    );
  }
}
