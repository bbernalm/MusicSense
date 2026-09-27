/*
 * Reproductor:
 * - fondo de vidrio de la cápsula derecha (#lg-side-background);
 * - botón "+" (guardar en una playlist) junto al corazón;
 * - volumen: el botón de altavoz despliega una barra vertical hacia arriba;
 * - botón de configuración en la barra superior (menú completo de la app);
 * - pantalla del reproductor: portada cuadrada con título y artista debajo;
 * - clases de estado: lg-np (pantalla del reproductor abierta), lg-paused.
 *
 * La barra de YouTube Music aísla el desenfoque de sus hijos, así que los
 * fondos de vidrio y el panel del volumen son elementos aparte.
 */

import type { MusicPlayer } from '@/types/music-player';

const NP_CLASS = 'lg-np';
const PAUSED_CLASS = 'lg-paused';
const SILENT_MENU_CLASS = 'lg-silent-menu';
const SIDE_HOVER_CLASS = 'lg-side-hover';

const PLUS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
  <path d="M12 7.8v8.4M7.8 12h8.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

const GEAR_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
    d="M10.3 3.2h3.4l.5 2.4c.6.2 1.1.5 1.6.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1 .7-1.6.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.1-.5-1.6-.9l-2.3.8-1.7-2.9 1.8-1.6a6 6 0 0 1 0-1.8L4.2 8.6l1.7-2.9 2.3.8c.5-.4 1-.7 1.6-.9Z"/>
  <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
</svg>`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Labels = { addToPlaylist: string; settings: string };

export class PlayerLayout {
  private api: MusicPlayer | null = null;
  private sideBackground: HTMLDivElement | null = null;
  private addButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private npInfo: HTMLDivElement | null = null;
  private volumePanel: HTMLDivElement | null = null;
  private volumeHideTimer: number | null = null;
  private video: HTMLVideoElement | null = null;
  private sideControls: HTMLElement | null = null;
  private timer: number | null = null;

  private readonly onResize = () => this.tick();
  private readonly onPlay = () => document.body.classList.remove(PAUSED_CLASS);
  private readonly onPause = () => document.body.classList.add(PAUSED_CLASS);
  private readonly onSideEnter = () =>
    document.body.classList.add(SIDE_HOVER_CLASS);
  private readonly onSideLeave = () =>
    document.body.classList.remove(SIDE_HOVER_CLASS);
  private readonly onVolumeEnter = () => this.showVolume();
  private readonly onVolumeLeave = () => this.hideVolumeSoon();

  constructor(
    private readonly labels: Labels,
    private readonly openAppMenu: (x: number, y: number) => void,
  ) {}

  start(api: MusicPlayer) {
    this.api = api;
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
    this.sideControls?.removeEventListener('mouseenter', this.onSideEnter);
    this.sideControls?.removeEventListener('mouseleave', this.onSideLeave);
    this.sideControls = null;
    for (const element of [
      this.sideBackground,
      this.addButton,
      this.settingsButton,
      this.npInfo,
      this.volumePanel,
    ]) {
      element?.remove();
    }
    this.sideBackground = null;
    this.addButton = null;
    this.settingsButton = null;
    this.npInfo = null;
    this.volumePanel = null;
    document.body.classList.remove(
      NP_CLASS,
      PAUSED_CLASS,
      SILENT_MENU_CLASS,
      SIDE_HOVER_CLASS,
    );
  }

  private tick() {
    this.ensureSideBackground();
    this.ensureAddButton();
    this.ensureSettingsButton();
    this.ensureVolume();
    this.ensureVideo();

    const open =
      document
        .querySelector('ytmusic-app-layout')
        ?.hasAttribute('player-page-open') ?? false;
    document.body.classList.toggle(NP_CLASS, open);
    this.updateNowPlaying();
  }

  // Fondo de la cápsula: hermano de #player-bar-background
  private ensureSideBackground() {
    if (!this.sideBackground?.isConnected) {
      const background = document.querySelector('#player-bar-background');
      if (background) {
        const side = document.createElement('div');
        side.id = 'lg-side-background';
        background.after(side);
        this.sideBackground = side;
      }
    }

    // Efecto al pasar el ratón: los controles y su fondo se mueven juntos
    const controls = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .right-controls',
    );
    if (controls && controls !== this.sideControls) {
      this.sideControls?.removeEventListener('mouseenter', this.onSideEnter);
      this.sideControls?.removeEventListener('mouseleave', this.onSideLeave);
      controls.addEventListener('mouseenter', this.onSideEnter);
      controls.addEventListener('mouseleave', this.onSideLeave);
      this.sideControls = controls;
    }
  }

  // Botón "+" junto al corazón
  private ensureAddButton() {
    if (this.addButton?.isConnected) return;
    const like = document.querySelector(
      'ytmusic-player-bar .middle-controls-buttons #like-button-renderer',
    );
    if (!like) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lg-icon-button lg-add-button';
    button.title = this.labels.addToPlaylist;
    button.setAttribute('aria-label', this.labels.addToPlaylist);
    button.innerHTML = PLUS_ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.addToPlaylist().catch(console.error);
    });
    like.after(button);
    this.addButton = button;
  }

  // Botón de configuración en la barra superior: menú completo de la app
  private ensureSettingsButton() {
    if (this.settingsButton?.isConnected) return;
    const right = document.querySelector('ytmusic-nav-bar .right-content');
    if (!right) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lg-icon-button lg-settings-button';
    button.title = this.labels.settings;
    button.setAttribute('aria-label', this.labels.settings);
    button.innerHTML = GEAR_ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      this.openAppMenu(rect.left, rect.bottom + 6);
    });
    right.prepend(button);
    this.settingsButton = button;
  }

  // Volumen: panel vertical que sale hacia arriba desde el botón del altavoz
  private ensureVolume() {
    if (this.volumePanel?.isConnected) return;
    const mute = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .right-controls-buttons .volume',
    );
    if (!mute) return;

    const panel = document.createElement('div');
    panel.className = 'lg-volume-panel';
    panel.innerHTML =
      '<div class="lg-volume-track"><div class="lg-volume-fill"></div></div>';
    document.body.append(panel);
    this.volumePanel = panel;

    const track = panel.querySelector<HTMLElement>('.lg-volume-track')!;
    const setFromPointer = (event: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const ratio = (rect.bottom - event.clientY) / rect.height;
      this.setVolume(Math.round(Math.min(1, Math.max(0, ratio)) * 100));
    };
    track.addEventListener('pointerdown', (event) => {
      track.setPointerCapture(event.pointerId);
      setFromPointer(event);
    });
    track.addEventListener('pointermove', (event) => {
      if (track.hasPointerCapture(event.pointerId)) setFromPointer(event);
    });
    panel.addEventListener('wheel', (event) => {
      event.preventDefault();
      const step = event.deltaY < 0 ? 5 : -5;
      this.setVolume((this.api?.getVolume() ?? 50) + step);
    });

    for (const element of [mute, panel]) {
      element.addEventListener('mouseenter', this.onVolumeEnter);
      element.addEventListener('mouseleave', this.onVolumeLeave);
    }
  }

  private setVolume(value: number) {
    const volume = Math.min(100, Math.max(0, Math.round(value)));
    if (!this.api) return;
    if (this.api.isMuted() && volume > 0) this.api.unMute();
    this.api.setVolume(volume);
    // Mantiene sincronizada la barra nativa (oculta)
    const slider = document.querySelector<HTMLElement & { value?: number }>(
      'ytmusic-player-bar #volume-slider',
    );
    if (slider) slider.value = volume;
    this.renderVolume();
  }

  private renderVolume() {
    const volume = this.api?.isMuted() ? 0 : (this.api?.getVolume() ?? 0);
    this.volumePanel?.style.setProperty('--lg-volume', String(volume / 100));
  }

  private showVolume() {
    if (this.volumeHideTimer !== null) {
      window.clearTimeout(this.volumeHideTimer);
      this.volumeHideTimer = null;
    }
    const mute = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .right-controls-buttons .volume',
    );
    if (!mute || !this.volumePanel) return;
    const rect = mute.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    const centerX = rect.left + halfWidth;
    this.volumePanel.style.left = `${Math.round(centerX)}px`;
    this.volumePanel.style.top = `${Math.round(rect.top)}px`;
    this.renderVolume();
    this.volumePanel.classList.add('visible');
  }

  private hideVolumeSoon() {
    if (this.volumeHideTimer !== null)
      window.clearTimeout(this.volumeHideTimer);
    this.volumeHideTimer = window.setTimeout(() => {
      this.volumePanel?.classList.remove('visible');
      this.volumeHideTimer = null;
    }, 250);
  }

  // Estado de reproducción: gira el disco y anima la portada
  private ensureVideo() {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video || video === this.video) return;
    this.video?.removeEventListener('play', this.onPlay);
    this.video?.removeEventListener('pause', this.onPause);
    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    document.body.classList.toggle(PAUSED_CLASS, video.paused);
    this.video = video;
  }

  // Pantalla del reproductor: portada cuadrada con título y artista debajo
  private updateNowPlaying() {
    const main = document.querySelector<HTMLElement>(
      'ytmusic-player-page #main-panel',
    );
    if (!main) return;

    if (!this.npInfo?.isConnected) {
      const info = document.createElement('div');
      info.id = 'lg-np-info';
      info.innerHTML =
        '<div class="lg-np-title"></div><div class="lg-np-artist"></div>';
      main.append(info);
      this.npInfo = info;
    }

    const title =
      document
        .querySelector('ytmusic-player-bar .content-info-wrapper .title')
        ?.textContent?.trim() ?? '';
    // La línea de YouTube Music es "Artista • Álbum • Año": solo el artista
    const byline =
      document
        .querySelector('ytmusic-player-bar .content-info-wrapper .byline')
        ?.textContent?.trim() ?? '';
    const artist = byline.split('•')[0]?.trim() ?? '';
    const titleElement = this.npInfo.querySelector('.lg-np-title');
    const artistElement = this.npInfo.querySelector('.lg-np-artist');
    if (titleElement && titleElement.textContent !== title)
      titleElement.textContent = title;
    if (artistElement && artistElement.textContent !== artist)
      artistElement.textContent = artist;

    if (!document.body.classList.contains(NP_CLASS)) return;

    // Lado de la portada: el más corto del espacio libre sobre el título
    const reserved =
      this.npInfo.offsetHeight +
      parseFloat(getComputedStyle(main).rowGap || '0');
    const size = Math.min(
      main.clientWidth - 48,
      main.clientHeight - reserved,
      560,
    );
    document.body.style.setProperty(
      '--np-art',
      `${Math.max(160, Math.floor(size))}px`,
    );
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
