/*
 * Reproductor:
 * - fondo de vidrio de la cápsula derecha (#lg-side-background);
 * - botón "+" (guardar en una playlist) junto al corazón;
 * - volumen: el botón de altavoz despliega una barra vertical hacia arriba;
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
const IDLE_CLASS = 'lg-idle';
const LOADING_CLASS = 'lg-bar-loading';

const PLUS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
  <path d="M12 7.8v8.4M7.8 12h8.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path d="M12 3.5v11M8 7.5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

type Labels = {
  addToPlaylist: string;
  share: string;
  loading: string;
  idle: string;
};

export class PlayerLayout {
  private api: MusicPlayer | null = null;
  private sideBackground: HTMLDivElement | null = null;
  private expandBackground: HTMLDivElement | null = null;
  private addButton: HTMLButtonElement | null = null;
  private npInfo: HTMLDivElement | null = null;
  private barStatus: HTMLDivElement | null = null;
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

  constructor(private readonly labels: Labels) {}

  // La API llega más tarde (onPlayerApiReady); solo la usa el volumen
  setApi(api: MusicPlayer) {
    this.api = api;
  }

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
    this.sideControls?.removeEventListener('mouseenter', this.onSideEnter);
    this.sideControls?.removeEventListener('mouseleave', this.onSideLeave);
    this.sideControls = null;
    for (const element of [
      this.sideBackground,
      this.expandBackground,
      this.addButton,
      this.npInfo,
      this.barStatus,
      this.volumePanel,
    ]) {
      element?.remove();
    }
    this.sideBackground = null;
    this.expandBackground = null;
    this.addButton = null;
    this.npInfo = null;
    this.barStatus = null;
    this.volumePanel = null;
    document.body.classList.remove(
      NP_CLASS,
      PAUSED_CLASS,
      SILENT_MENU_CLASS,
      SIDE_HOVER_CLASS,
      IDLE_CLASS,
      LOADING_CLASS,
    );
  }

  private tick() {
    this.ensureSideBackground();
    this.ensureAddButton();
    this.ensureVolume();
    this.ensureVideo();

    const open =
      document
        .querySelector('ytmusic-app-layout')
        ?.hasAttribute('player-page-open') ?? false;
    document.body.classList.toggle(NP_CLASS, open);
    this.updateBarStatus();
    this.updateNowPlaying();
  }

  // Estado de la píldora: sin música (lg-idle) o cargando (lg-bar-loading).
  // Muestra un disco de relleno y un texto en lugar del título.
  private updateBarStatus() {
    const layout = document.querySelector('ytmusic-app-layout');
    const idle = Boolean(layout && !layout.hasAttribute('player-visible'));
    const title =
      document
        .querySelector('ytmusic-player-bar .content-info-wrapper .title')
        ?.textContent?.trim() ?? '';
    const image = document.querySelector<HTMLImageElement>(
      'ytmusic-player-bar .thumbnail-image-wrapper img.image',
    );
    const imageReady = Boolean(
      image?.getAttribute('src') && image.complete && image.naturalWidth > 0,
    );
    const loading = !idle && (!title || !imageReady);

    const body = document.body;
    body.classList.toggle(IDLE_CLASS, idle);
    body.classList.toggle(LOADING_CLASS, loading);

    const info = document.querySelector(
      'ytmusic-player-bar .content-info-wrapper',
    );
    if (info && !this.barStatus?.isConnected) {
      this.barStatus = document.createElement('div');
      this.barStatus.className = 'lg-bar-status';
      info.prepend(this.barStatus);
    }
    const text = idle ? this.labels.idle : this.labels.loading;
    if (this.barStatus && this.barStatus.textContent !== text)
      this.barStatus.textContent = text;
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
    // Círculo aparte del botón de abrir/cerrar el reproductor
    if (!this.expandBackground?.isConnected && this.sideBackground) {
      const expand = document.createElement('div');
      expand.id = 'lg-expand-background';
      this.sideBackground.after(expand);
      this.expandBackground = expand;
    }

    // Aleatorio antes de "anterior" y repetir después de "siguiente"
    const left = document.querySelector(
      'ytmusic-player-bar .left-controls-buttons',
    );
    const previous = left?.querySelector('.previous-button');
    const next = left?.querySelector('.next-button');
    const shuffle = document.querySelector('ytmusic-player-bar .shuffle');
    const repeat = document.querySelector('ytmusic-player-bar .repeat');
    if (left && previous && shuffle && shuffle.parentElement !== left)
      left.insertBefore(shuffle, previous);
    if (left && next && repeat && repeat.parentElement !== left)
      next.after(repeat);

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
      this.pressSongMenu('ADD_TO_PLAYLIST').catch(console.error);
    });
    like.after(button);
    this.addButton = button;
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
    // El del reproductor de YouTube (no el de la portada animada)
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
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
        '<div class="lg-np-text"><button type="button" class="lg-np-title"></button><button type="button" class="lg-np-artist"></button></div>';
      // Título → álbum, artista → página del artista (los enlaces de la barra)
      info
        .querySelector('.lg-np-title')
        ?.addEventListener('click', () => this.openBylineLink('album'));
      info
        .querySelector('.lg-np-artist')
        ?.addEventListener('click', () => this.openBylineLink('artist'));

      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'lg-icon-button lg-share-button';
      share.title = this.labels.share;
      share.setAttribute('aria-label', this.labels.share);
      share.innerHTML = SHARE_ICON;
      share.addEventListener('click', (event) => {
        event.stopPropagation();
        this.pressSongMenu('SHARE').catch(console.error);
      });
      info.append(share);
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

    // Las pestañas del panel derecho empiezan a la altura de la portada
    const art = document.querySelector('ytmusic-player-page #player');
    const side = document.querySelector('ytmusic-player-page #side-panel');
    if (art && side) {
      const offset =
        art.getBoundingClientRect().top - side.getBoundingClientRect().top;
      document.body.style.setProperty(
        '--np-side-offset',
        `${Math.max(0, Math.round(offset))}px`,
      );
    }
  }

  // Enlaces de la línea "Artista • Álbum • Año" de la barra
  private openBylineLink(kind: 'artist' | 'album') {
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        'ytmusic-player-bar .content-info-wrapper .byline a',
      ),
    ];
    const album = links.find((link) =>
      /browse\/MPRE/.test(link.getAttribute('href') ?? ''),
    );
    const target = kind === 'album' ? (album ?? links[0]) : links[0];
    target?.click();
  }

  // Opción del menú ⋮ de la canción ("Guardar en una playlist", "Compartir"...)
  // pulsada sin mostrar el menú
  private async pressSongMenu(iconType: string) {
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
        >(
          'ytmusic-menu-popup-renderer :is(ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer)',
        );
        const item = [...items].find(
          (element) => element.data?.icon?.iconType === iconType,
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
