/*
 * Reproductor: fondo de vidrio de la cápsula derecha, botón "+" para guardar
 * en una playlist y diseño de la pantalla del reproductor (portada grande con
 * título, controles y volumen debajo; letras a la derecha y la cápsula bajo ellas).
 *
 * La barra de YouTube Music aísla el desenfoque de sus hijos, así que los
 * fondos de vidrio son elementos aparte. En la pantalla del reproductor la
 * barra ocupa toda la ventana y cada grupo de controles se coloca con las
 * medidas reales de la portada y del panel lateral (variables --np-*).
 */

const NP_CLASS = 'lg-np';
const PAUSED_CLASS = 'lg-paused';
const SILENT_MENU_CLASS = 'lg-silent-menu';

const PLUS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
  <path d="M12 7.8v8.4M7.8 12h8.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PlayerLayout {
  private sideBackground: HTMLDivElement | null = null;
  private addButton: HTMLButtonElement | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private readonly onResize = () => this.tick();
  private readonly onPlay = () => document.body.classList.remove(PAUSED_CLASS);
  private readonly onPause = () => document.body.classList.add(PAUSED_CLASS);

  constructor(private readonly addLabel: string) {}

  start() {
    this.timer = window.setInterval(() => this.tick(), 250);
    window.addEventListener('resize', this.onResize);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('resize', this.onResize);
    this.video?.removeEventListener('play', this.onPlay);
    this.video?.removeEventListener('pause', this.onPause);
    this.video = null;
    this.sideBackground?.remove();
    this.sideBackground = null;
    this.addButton?.remove();
    this.addButton = null;
    document.body.classList.remove(NP_CLASS, PAUSED_CLASS, SILENT_MENU_CLASS);
  }

  private tick() {
    this.ensureElements();

    const open =
      document
        .querySelector('ytmusic-app-layout')
        ?.hasAttribute('player-page-open') ?? false;
    document.body.classList.toggle(NP_CLASS, open);
    if (open) this.measure();
  }

  private ensureElements() {
    // Fondo de la cápsula: hermano de #player-bar-background
    if (!this.sideBackground?.isConnected) {
      const background = document.querySelector('#player-bar-background');
      if (background) {
        const side = document.createElement('div');
        side.id = 'lg-side-background';
        background.after(side);
        this.sideBackground = side;
      }
    }

    // Botón "+" junto al corazón
    if (!this.addButton?.isConnected) {
      const like = document.querySelector(
        'ytmusic-player-bar .middle-controls-buttons #like-button-renderer',
      );
      if (like) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lg-icon-button lg-add-button';
        button.title = this.addLabel;
        button.setAttribute('aria-label', this.addLabel);
        button.innerHTML = PLUS_ICON;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.addToPlaylist().catch(console.error);
        });
        like.after(button);
        this.addButton = button;
      }
    }

    // Estado de reproducción para animar la portada
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video && video !== this.video) {
      this.video?.removeEventListener('play', this.onPlay);
      this.video?.removeEventListener('pause', this.onPause);
      video.addEventListener('play', this.onPlay);
      video.addEventListener('pause', this.onPause);
      document.body.classList.toggle(PAUSED_CLASS, video.paused);
      this.video = video;
    }
  }

  // Mide la portada y el panel lateral para colocar los controles
  private measure() {
    const art = document.querySelector<HTMLElement>(
      'ytmusic-player-page #player',
    );
    const side = document.querySelector<HTMLElement>(
      'ytmusic-player-page #side-panel',
    );
    const main = document.querySelector<HTMLElement>(
      'ytmusic-player-page #main-panel',
    );
    if (!art || !side || !main) return;

    // Portada cuadrada: el lado más corto del espacio libre sobre los controles
    const paddingBottom = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    const artSize = Math.min(
      main.clientWidth,
      main.clientHeight - paddingBottom,
      560,
    );
    document.body.style.setProperty(
      '--np-art',
      `${Math.max(160, Math.floor(artSize))}px`,
    );

    const a = art.getBoundingClientRect();
    const s = side.getBoundingClientRect();
    const vars: Record<string, number> = {
      '--np-x': a.left,
      '--np-y': a.bottom,
      '--np-w': a.width,
      '--np-side-x': s.left,
      '--np-side-y': s.bottom,
      '--np-side-w': s.width,
    };
    for (const [name, value] of Object.entries(vars)) {
      document.body.style.setProperty(name, `${Math.round(value)}px`);
    }
  }

  // Abre "Guardar en una playlist" del menú ⋮ sin mostrar el menú
  private async addToPlaylist() {
    const trigger = document.querySelector<HTMLElement>(
      'ytmusic-player-bar ytmusic-menu-renderer #button-shape button',
    );
    if (!trigger) return;

    document.body.classList.add(SILENT_MENU_CLASS);
    try {
      trigger.click();
      for (let i = 0; i < 20; i++) {
        await wait(50);
        const items = document.querySelectorAll<
          HTMLElement & { data?: { icon?: { iconType?: string } } }
        >('ytmusic-menu-popup-renderer ytmusic-menu-navigation-item-renderer');
        const item = [...items].find(
          (element) => element.data?.icon?.iconType === 'ADD_TO_PLAYLIST',
        );
        if (item) {
          (
            item.querySelector<HTMLElement>('a, tp-yt-paper-item') ?? item
          ).click();
          return;
        }
      }
      // No apareció la opción (p. ej. sin sesión iniciada): cierra el menú
      document
        .querySelector<HTMLElement & { close?: () => void }>(
          'ytmusic-popup-container tp-yt-iron-dropdown',
        )
        ?.close?.();
    } finally {
      await wait(300);
      document.body.classList.remove(SILENT_MENU_CLASS);
    }
  }
}
