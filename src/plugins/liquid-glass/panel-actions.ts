/*
 * Canciones del panel derecho de la pantalla del reproductor
 * ("A continuación" y "Similares"):
 * - Sin arrastrar para reordenar (el cursor de mover no servía de nada).
 * - Botón junto a los ⋮ que manda la canción a tu fila (queue.ts).
 * - Menú ⋮ / clic derecho reducido a lo útil: Comenzar mix, Reproducir a
 *   continuación, Compartir y Fijar en Volver a escuchar (lo demás ya tiene
 *   botón propio: +, corazón, fila...).
 * - Clic en el artista: menú pequeño con "Ir al álbum" e "Ir al artista".
 *
 * Las opciones salen de los datos del menú de cada canción (data.items).
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

type MenuElement = HTMLElement & {
  data?: { items?: Record<string, MenuItemData>[] };
};

export type PanelActionsLabels = {
  addToQueue: string;
};

const ROWS =
  'ytmusic-player-page #tab-renderer :is(ytmusic-player-queue-item, ytmusic-responsive-list-item-renderer)';
const MENU_ITEMS =
  'ytmusic-menu-popup-renderer :is(ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-toggle-menu-service-item-renderer, ytmusic-menu-service-item-download-renderer)';
// Opciones que se quedan en el menú de las canciones del panel
const KEEP = new Set(['MIX', 'QUEUE_PLAY_NEXT', 'SHARE', 'KEEP']);
const HIDDEN_CLASS = 'lg-menu-hidden';

const QUEUE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M4 6.5h11M4 11.5h11M4 16.5h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M18 13.5v6M15 16.5h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const text = (runs?: Runs) => runs?.runs?.map((run) => run.text).join('') ?? '';

// Opciones del menú de una fila: { icono: datos }
const menuOf = (row: Element) => {
  const menu = row.querySelector<MenuElement>(':scope > ytmusic-menu-renderer');
  const entries = new Map<string, MenuItemData>();
  for (const item of menu?.data?.items ?? []) {
    const data = Object.values(item)[0];
    const icon = data?.icon?.iconType ?? data?.defaultIcon?.iconType;
    if (icon && data) entries.set(icon, data);
  }
  return entries;
};

export class PanelActions {
  private timer: number | null = null;
  private fromPanel = false;
  private markUntil = 0;
  private markFrame: number | null = null;
  private popup: HTMLDivElement | null = null;

  constructor(
    private readonly labels: PanelActionsLabels,
    private readonly addToQueue: (videoId: string) => Promise<boolean>,
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
    const row = byline?.closest(ROWS);
    if (!byline || !row) return;
    const menu = menuOf(row);
    const options = ['ALBUM', 'ARTIST']
      .map((icon) => menu.get(icon))
      .filter((data): data is MenuItemData =>
        Boolean(data?.navigationEndpoint?.browseEndpoint?.browseId),
      );
    if (!options.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.showPopup(event.clientX, event.clientY, options);
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
    document.addEventListener('click', this.onArtistClick, true);
    document.addEventListener('pointerdown', this.onDocumentDown, true);
    document.addEventListener('wheel', this.onDocumentDown, true);
    document.addEventListener('keydown', this.onKey);
    this.timer = window.setInterval(() => this.ensureButtons(), 700);
    this.ensureButtons();
  }

  stop() {
    document.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('click', this.onOpen, true);
    document.removeEventListener('contextmenu', this.onOpen, true);
    document.removeEventListener('click', this.onArtistClick, true);
    document.removeEventListener('pointerdown', this.onDocumentDown, true);
    document.removeEventListener('wheel', this.onDocumentDown, true);
    document.removeEventListener('keydown', this.onKey);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.markFrame !== null) cancelAnimationFrame(this.markFrame);
    this.closePopup();
    document.querySelectorAll('.lg-panel-add').forEach((b) => b.remove());
    document
      .querySelectorAll(`.${HIDDEN_CLASS}`)
      .forEach((item) => item.classList.remove(HIDDEN_CLASS));
  }

  // Botón "Agregar a tu fila" junto a los ⋮ de cada canción
  private ensureButtons() {
    for (const row of document.querySelectorAll<HTMLElement>(ROWS)) {
      const menu = row.querySelector(':scope > ytmusic-menu-renderer');
      if (!menu || row.querySelector(':scope > .lg-panel-add')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lg-panel-add';
      button.title = this.labels.addToQueue;
      button.setAttribute('aria-label', this.labels.addToQueue);
      button.innerHTML = QUEUE_ICON;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // La fila se reutiliza para otras canciones: se lee al pulsar
        const videoId = menuOf(row).get('ADD_TO_REMOTE_QUEUE')?.serviceEndpoint
          ?.queueAddEndpoint?.queueTarget?.videoId;
        if (!videoId) return;
        button.classList.add('done');
        this.addToQueue(videoId)
          .catch(console.error)
          .finally(() => {
            window.setTimeout(() => button.classList.remove('done'), 1200);
          });
      });
      menu.before(button);
    }
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

  private showPopup(x: number, y: number, options: MenuItemData[]) {
    this.closePopup();
    const popup = document.createElement('div');
    popup.className = 'lg-artist-menu';
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text(option.text);
      button.addEventListener('click', () => {
        const id = option.navigationEndpoint?.browseEndpoint?.browseId;
        this.closePopup();
        if (!id) return;
        const app =
          document.querySelector<MusicPlayerAppElement>('ytmusic-app');
        // Se sale de la pantalla del reproductor para ver la página
        const toggle = document.querySelector<HTMLElement>(
          'ytmusic-player-bar .toggle-player-page-button',
        );
        if (
          document
            .querySelector('ytmusic-app-layout')
            ?.hasAttribute('player-page-open')
        )
          toggle?.click();
        app?.navigate(id);
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
