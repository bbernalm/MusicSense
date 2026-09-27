/*
 * Modo letras estilo Apple Music.
 * Añade un botón a la píldora del reproductor que abre la pantalla del
 * reproductor en la pestaña "Letra" y oculta el resto del panel lateral.
 * Las letras las dibuja el complemento Synced Lyrics; aquí solo se controla
 * cuándo se muestran y su aspecto (ver lyrics.css).
 */

import { lyricsStore } from '@/plugins/synced-lyrics/renderer/store';

const MODE_CLASS = 'lg-lyrics-open';
const BUTTON_CLASS = 'lg-lyrics-button';

// Burbuja con comillas, como el botón de letras de Apple Music
const ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"
    d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/>
  <path fill="currentColor" d="M8.2 9.2a1.5 1.5 0 1 1 1.3 2.3c-.1.8-.6 1.4-1.3 1.7l-.3-.5c.4-.3.6-.7.6-1.2a1.5 1.5 0 0 1-.3-2.3Zm5 0a1.5 1.5 0 1 1 1.3 2.3c-.1.8-.6 1.4-1.3 1.7l-.3-.5c.4-.3.6-.7.6-1.2a1.5 1.5 0 0 1-.3-2.3Z"/>
</svg>`;

const TAB_SELECTOR = '#tabsContent > .tab-header';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isPlayerPageOpen = () =>
  document
    .querySelector('ytmusic-app-layout')
    ?.hasAttribute('player-page-open') ?? false;

const getTabs = () => document.querySelectorAll<HTMLElement>(TAB_SELECTOR);

// La segunda pestaña es la de letras (la misma que usa Synced Lyrics)
const isLyricsTabSelected = () =>
  getTabs()[1]?.getAttribute('aria-selected') === 'true';

// Nombre visible de cada fuente de Synced Lyrics
const PROVIDER_LABELS: Record<string, string> = {
  YTMusic: 'YouTube Music',
  LRCLib: 'LRCLib',
  MusixMatch: 'Musixmatch',
  LyricsGenius: 'Genius',
};

export class LyricsMode {
  private button: HTMLButtonElement | null = null;
  private credit: HTMLDivElement | null = null;
  private timer: number | null = null;

  constructor(
    private readonly label: string,
    private readonly creditText: (provider: string) => string,
  ) {}

  start() {
    // YouTube Music puede volver a crear la barra: se revisa periódicamente
    this.timer = window.setInterval(() => this.tick(), 400);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.button?.remove();
    this.button = null;
    this.credit?.remove();
    this.credit = null;
    document.body.classList.remove(MODE_CLASS);
  }

  private tick() {
    if (!this.button?.isConnected) this.attachButton();
    const open = isPlayerPageOpen() && isLyricsTabSelected();
    document.body.classList.toggle(MODE_CLASS, open);
    this.button?.classList.toggle('active', open);
    this.button?.setAttribute('aria-pressed', String(open));
    if (open) this.updateCredit();
  }

  // Crédito al pie del panel de letras: fuente real y estilo de Better Lyrics
  private updateCredit() {
    const side = document.querySelector('ytmusic-player-page #side-panel');
    if (!side) return;
    if (!this.credit?.isConnected) {
      this.credit = document.createElement('div');
      this.credit.className = 'lg-lyrics-credit';
      side.append(this.credit);
    }

    const provider = lyricsStore.provider;
    const state = lyricsStore.lyrics[provider];
    const found = state?.state === 'done' && state.data !== null;
    const text = found
      ? this.creditText(PROVIDER_LABELS[provider] ?? provider)
      : '';
    if (this.credit.textContent !== text) this.credit.textContent = text;
  }

  private attachButton() {
    // En la cápsula derecha, antes de "repetir"
    const container = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .right-controls-buttons',
    );
    if (!container) return;

    const button = document.createElement('button');
    button.className = `lg-icon-button ${BUTTON_CLASS}`;
    button.type = 'button';
    button.title = this.label;
    button.setAttribute('aria-label', this.label);
    button.innerHTML = ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggle().catch(console.error);
    });

    container.insertBefore(button, container.querySelector('.repeat'));
    this.button = button;
  }

  private async toggle() {
    if (isPlayerPageOpen() && isLyricsTabSelected()) {
      // Salir del modo letras: vuelve a "A continuación"
      getTabs()[0]?.click();
      this.tick();
      return;
    }

    if (!isPlayerPageOpen()) {
      document
        .querySelector<HTMLElement>(
          'ytmusic-player-bar .toggle-player-page-button',
        )
        ?.click();
    }

    // Espera a que existan las pestañas de la pantalla del reproductor
    for (let i = 0; i < 20 && getTabs().length < 2; i++) await wait(100);
    const lyricsTab = getTabs()[1];
    lyricsTab?.removeAttribute('disabled');
    lyricsTab?.click();
    this.tick();
  }
}
