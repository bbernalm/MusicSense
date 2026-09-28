/*
 * Canciones del panel derecho de la pantalla del reproductor
 * ("A continuación" y "Similares"):
 * - Sin arrastrar para reordenar (el cursor de mover no servía de nada).
 * - "A continuación" empieza en la canción que suena: las ya escuchadas se
 *   ocultan (si vuelves a una anterior con el botón, pasa a ser la primera).
 * - Botón junto a los ⋮ que manda la canción a tu fila (queue.ts).
 * - Menú ⋮ / clic derecho reducido a lo útil: Comenzar mix, Reproducir a
 *   continuación, Compartir y Fijar en Volver a escuchar (lo demás ya tiene
 *   botón propio: +, corazón, fila...).
 * - Clic en el artista: menú pequeño con "Ir al álbum" e "Ir al artista".
 * - Canciones de la reproducción automática (al final de la cola): YouTube
 *   Music no les dibuja ⋮; se les pone uno propio con Reproducir a
 *   continuación, Compartir (copia el enlace), Ir al álbum e Ir al artista.
 *
 * Las opciones salen de los datos del menú de cada canción.
 */

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

type Runs = { runs?: { text: string }[] };

type MenuItemData = {
  icon?: { iconType?: string };
  defaultIcon?: { iconType?: string };
  text?: Runs;
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  serviceEndpoint?: {
    queueAddEndpoint?: { queueTarget?: { videoId?: string } };
  };
};

type MenuItems = Record<string, MenuItemData>[];

type RowElement = HTMLElement & {
  data?: { videoId?: string; menu?: { menuRenderer?: { items?: MenuItems } } };
};

type PopupEntry = { label: string; action: () => void };

export type PanelActionsLabels = {
  addToQueue: string;
  more: string;
  linkCopied: string;
};

export type PanelActionsHandlers = {
  addToQueue: (videoId: string) => Promise<boolean>;
  playNext: (videoId: string) => Promise<boolean>;
  toast: (message: string) => void;
};

const ROWS =
  'ytmusic-player-page #tab-renderer :is(ytmusic-player-queue-item, ytmusic-responsive-list-item-renderer)';
const MENU_ITEMS =
  'ytmusic-menu-popup-renderer :is(ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-toggle-menu-service-item-renderer, ytmusic-menu-service-item-download-renderer)';
// Opciones que se quedan en el menú de las canciones del panel
const KEEP = new Set(['MIX', 'QUEUE_PLAY_NEXT', 'SHARE', 'KEEP']);
const HIDDEN_CLASS = 'lg-menu-hidden';
const PLAYED_CLASS = 'lg-played';

const QUEUE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M4 6.5h11M4 11.5h11M4 16.5h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M18 13.5v6M15 16.5h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const MORE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <circle cx="12" cy="5.5" r="1.8" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
  <circle cx="12" cy="18.5" r="1.8" fill="currentColor"/>
</svg>`;

const text = (runs?: Runs) => runs?.runs?.map((run) => run.text).join('') ?? '';

// Opciones del menú de una fila: { icono: datos }. Del ⋮ dibujado o, si no
// lo hay (reproducción automática), de los datos de la fila
const menuOf = (row: RowElement) => {
  const menu = row.querySelector<
    HTMLElement & { data?: { items?: MenuItems } }
  >(':scope > ytmusic-menu-renderer');
  const items = menu?.data?.items ?? row.data?.menu?.menuRenderer?.items ?? [];
  const entries = new Map<string, MenuItemData>();
  for (const item of items) {
    const data = Object.values(item)[0];
    const icon = data?.icon?.iconType ?? data?.defaultIcon?.iconType;
    if (icon && data) entries.set(icon, data);
  }
  return entries;
};

const videoIdOf = (row: RowElement) =>
  menuOf(row).get('ADD_TO_REMOTE_QUEUE')?.serviceEndpoint?.queueAddEndpoint
    ?.queueTarget?.videoId ?? row.data?.videoId;

const hasNativeMenu = (row: Element) =>
  Boolean(row.querySelector(':scope > ytmusic-menu-renderer'));

export class PanelActions {
  private timer: number | null = null;
  private fromPanel = false;
  private markUntil = 0;
  private markFrame: number | null = null;
  private popup: HTMLDivElement | null = null;

  constructor(
    private readonly labels: PanelActionsLabels,
    private readonly handlers: PanelActionsHandlers,
  ) {}

  // YouTube Music empieza a arrastrar con pointerdown escuchado en window:
  // se corta en document (después de que la fila lo reciba)
  private readonly onPointerDown = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (target?.closest('ytmusic-player-page ytmusic-player-queue-item'))
      event.stopPropagation();
  };

  // De dónde se abre el menú: solo se recorta el de las canciones del panel
  private readonly onOpen = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target || target.closest('ytmusic-popup-container, .lg-artist-menu'))
      return;
    this.fromPanel = Boolean(target.closest('ytmusic-player-page #side-panel'));
    this.markUntil = Date.now() + 1500;
    this.markMenu();
  };

  // Clic en el artista: menú con álbum y artista
  private readonly onArtistClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const byline = target?.closest(
      'ytmusic-player-queue-item .byline, ytmusic-responsive-list-item-renderer .secondary-flex-columns',
    );
    const row = byline?.closest<RowElement>(ROWS);
    if (!byline || !row) return;
    const entries = this.navigationEntries(row);
    if (!entries.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.showPopup(event.clientX, event.clientY, entries);
  };

  // Clic derecho en una canción sin ⋮ de YouTube Music: el menú propio
  private readonly onContextMenu = (event: MouseEvent) => {
    const row = (event.target as Element | null)?.closest<RowElement>(ROWS);
    if (!row || hasNativeMenu(row)) return;
    event.preventDefault();
    event.stopPropagation();
    this.showRowMenu(row, event.clientX, event.clientY);
  };

  private readonly onDocumentDown = (event: Event) => {
    if (!this.popup) return;
    if ((event.target as Element | null)?.closest('.lg-artist-menu')) return;
    this.closePopup();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.closePopup();
  };

  start() {
    document.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('click', this.onOpen, true);
    document.addEventListener('contextmenu', this.onOpen, true);
    document.addEventListener('contextmenu', this.onContextMenu, true);
    document.addEventListener('click', this.onArtistClick, true);
    document.addEventListener('pointerdown', this.onDocumentDown, true);
    document.addEventListener('wheel', this.onDocumentDown, true);
    document.addEventListener('keydown', this.onKey);
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
  }

  stop() {
    document.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('click', this.onOpen, true);
    document.removeEventListener('contextmenu', this.onOpen, true);
    document.removeEventListener('contextmenu', this.onContextMenu, true);
    document.removeEventListener('click', this.onArtistClick, true);
    document.removeEventListener('pointerdown', this.onDocumentDown, true);
    document.removeEventListener('wheel', this.onDocumentDown, true);
    document.removeEventListener('keydown', this.onKey);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.markFrame !== null) cancelAnimationFrame(this.markFrame);
    this.closePopup();
    document
      .querySelectorAll('.lg-panel-add, .lg-panel-more')
      .forEach((button) => button.remove());
    for (const name of [HIDDEN_CLASS, PLAYED_CLASS])
      document
        .querySelectorAll(`.${name}`)
        .forEach((item) => item.classList.remove(name));
  }

  private tick() {
    this.ensureButtons();
    this.hidePlayed();
  }

  // "A continuación" empieza en la canción que suena
  private hidePlayed() {
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        'ytmusic-player-page ytmusic-player-queue #contents > *',
      ),
    ];
    const current = items.findIndex(
      (item) =>
        item.hasAttribute('selected') || item.querySelector('[selected]'),
    );
    items.forEach((item, index) =>
      item.classList.toggle(PLAYED_CLASS, current > 0 && index < current),
    );
  }

  // Botón "Agregar a tu fila" junto a los ⋮ (y ⋮ propio si no lo hay)
  private ensureButtons() {
    for (const row of document.querySelectorAll<RowElement>(ROWS)) {
      if (row.querySelector(':scope > .lg-panel-add')) continue;
      const menu = row.querySelector(':scope > ytmusic-menu-renderer');
      const anchor = menu ?? row.querySelector(':scope > .duration');
      if (!anchor) continue;

      const add = this.iconButton(
        'lg-panel-add',
        QUEUE_ICON,
        this.labels.addToQueue,
      );
      add.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // La fila se reutiliza para otras canciones: se lee al pulsar
        const videoId = videoIdOf(row);
        if (!videoId) return;
        add.classList.add('done');
        this.handlers
          .addToQueue(videoId)
          .catch(console.error)
          .finally(() => {
            window.setTimeout(() => add.classList.remove('done'), 1200);
          });
      });
      anchor.before(add);

      if (!menu) {
        const more = this.iconButton(
          'lg-panel-more',
          MORE_ICON,
          this.labels.more,
        );
        more.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = more.getBoundingClientRect();
          this.showRowMenu(row, rect.left, rect.bottom);
        });
        anchor.before(more);
        row.classList.add('lg-own-menu');
      }
    }
  }

  private iconButton(className: string, icon: string, label: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  // Menú propio de una canción (sin ⋮ de YouTube Music)
  private showRowMenu(row: RowElement, x: number, y: number) {
    const videoId = videoIdOf(row);
    if (!videoId) return;
    const menu = menuOf(row);
    const entries: PopupEntry[] = [];
    const playNext = menu.get('QUEUE_PLAY_NEXT');
    if (playNext)
      entries.push({
        label: text(playNext.text),
        action: () => {
          this.handlers.playNext(videoId).catch(console.error);
        },
      });
    const share = menu.get('SHARE');
    if (share)
      entries.push({
        label: text(share.text),
        action: () => {
          navigator.clipboard
            .writeText(`https://music.youtube.com/watch?v=${videoId}`)
            .then(() => this.handlers.toast(this.labels.linkCopied))
            .catch(console.error);
        },
      });
    entries.push(...this.navigationEntries(row));
    if (entries.length) this.showPopup(x, y, entries);
  }

  // "Ir al álbum" / "Ir al artista"
  private navigationEntries(row: RowElement): PopupEntry[] {
    const menu = menuOf(row);
    return ['ALBUM', 'ARTIST'].flatMap((icon) => {
      const data = menu.get(icon);
      const id = data?.navigationEndpoint?.browseEndpoint?.browseId;
      if (!data || !id) return [];
      return [{ label: text(data.text), action: () => this.openPage(id) }];
    });
  }

  private openPage(id: string) {
    // Se sale de la pantalla del reproductor para ver la página
    if (
      document
        .querySelector('ytmusic-app-layout')
        ?.hasAttribute('player-page-open')
    )
      document
        .querySelector<HTMLElement>(
          'ytmusic-player-bar .toggle-player-page-button',
        )
        ?.click();
    document.querySelector<MusicPlayerAppElement>('ytmusic-app')?.navigate(id);
  }

  // Oculta las opciones que sobran mientras el menú se dibuja
  private markMenu() {
    if (this.markFrame !== null) cancelAnimationFrame(this.markFrame);
    const step = () => {
      for (const item of document.querySelectorAll<
        HTMLElement & { data?: MenuItemData }
      >(MENU_ITEMS)) {
        const icon =
          item.data?.icon?.iconType ?? item.data?.defaultIcon?.iconType ?? '';
        item.classList.toggle(HIDDEN_CLASS, this.fromPanel && !KEEP.has(icon));
      }
      this.markFrame =
        Date.now() < this.markUntil ? requestAnimationFrame(step) : null;
    };
    step();
  }

  private showPopup(x: number, y: number, entries: PopupEntry[]) {
    this.closePopup();
    const popup = document.createElement('div');
    popup.className = 'lg-artist-menu';
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.label;
      button.addEventListener('click', () => {
        this.closePopup();
        entry.action();
      });
      popup.append(button);
    }
    document.body.append(popup);
    // Dentro de la ventana
    const rect = popup.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top = `${Math.max(8, top)}px`;
    this.popup = popup;
  }

  private closePopup() {
    this.popup?.remove();
    this.popup = null;
  }
}
