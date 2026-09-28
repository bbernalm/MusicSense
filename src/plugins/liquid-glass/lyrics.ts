/*
 * Modo letras estilo Apple Music.
 * Añade un botón a la píldora del reproductor que abre la pantalla del
 * reproductor en la pestaña "Letra" y oculta el resto del panel lateral.
 * Las letras las dibuja el complemento Synced Lyrics; aquí solo se controla
 * cuándo se muestran y su aspecto (ver lyrics.css).
 */

import {
  lyricsStore,
  setTranslations,
} from '@/plugins/synced-lyrics/renderer/store';

const MODE_CLASS = 'lg-lyrics-open';
const BUTTON_CLASS = 'lg-lyrics-button';
const CREDIT_VAR = '--lg-lyrics-credit';

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

export type Translate = (
  text: string,
  target: string,
) => Promise<{ language: string; text: string } | null>;

export type LyricsLabels = {
  button: string;
  credit: (provider: string) => string;
  notFound: string;
  search: string;
};

export class LyricsMode {
  private button: HTMLButtonElement | null = null;
  private notFound: HTMLDivElement | null = null;
  private timer: number | null = null;
  // Traducción de la letra (opción "Traducir letras")
  private translateEnabled = false;
  private translatedKey = '';

  constructor(
    private readonly labels: LyricsLabels,
    // Abre en el navegador una búsqueda de la letra de la canción
    private readonly searchLyrics: (query: string) => void,
    private readonly translate: Translate,
  ) {}

  setTranslate(enabled: boolean) {
    this.translateEnabled = enabled;
    if (!enabled) {
      this.translatedKey = '';
      setTranslations({});
    }
  }

  // Idioma de la app (el de la interfaz): "es", "en", "pt-BR"...
  private targetLanguage() {
    const language: string | undefined =
      window.mainConfig?.get('options.language');
    return language || navigator.language || 'es';
  }

  // Traduce la letra actual una vez por canción; cada línea traducida se
  // muestra bajo la original (SyncedLine). Si ya está en el idioma de la
  // app, no se muestra nada.
  private updateTranslation() {
    if (!this.translateEnabled) return;
    const data = lyricsStore.lyrics[lyricsStore.provider]?.data;
    const lines = (
      data?.lines?.map((line) => line.text) ??
      data?.lyrics?.split('\n') ??
      []
    )
      .map((line) => line.trim())
      .filter(Boolean);
    const unique = [...new Set(lines)];
    const target = this.targetLanguage();
    const key = `${target}:${unique.join('\n')}`;
    if (!unique.length || key === this.translatedKey) return;
    this.translatedKey = key;
    setTranslations({});
    this.translate(unique.join('\n'), target)
      .then((result) => {
        if (this.translatedKey !== key || !result) return;
        const base = (code: string) => code.toLowerCase().split('-')[0];
        if (base(result.language ?? '') === base(target)) return;
        const translated = result.text.split('\n');
        const map: Record<string, string> = {};
        unique.forEach((line, index) => {
          const text = translated[index]?.trim();
          if (text) map[line] = text;
        });
        setTranslations(map);
      })
      .catch(console.error);
  }

  private get label() {
    return this.labels.button;
  }

  // Todas las fuentes respondieron y ninguna tiene letra
  private lyricsMissing() {
    const states = Object.values(lyricsStore.lyrics);
    return (
      states.length > 0 &&
      states.every((state) => state.state !== 'fetching') &&
      states.every((state) => !state.data?.lines && !state.data?.lyrics)
    );
  }

  private updateNotFound(side: Element) {
    const missing = this.lyricsMissing();
    document.body.classList.toggle('lg-lyrics-missing', missing);
    if (!missing) return;
    if (this.notFound?.isConnected) return;

    this.notFound = document.createElement('div');
    this.notFound.className = 'lg-lyrics-not-found';
    const text = document.createElement('p');
    text.textContent = this.labels.notFound;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this.labels.search;
    button.addEventListener('click', () => {
      const title =
        document
          .querySelector('ytmusic-player-bar .content-info-wrapper .title')
          ?.textContent?.trim() ?? '';
      const artist =
        document
          .querySelector('ytmusic-player-bar .content-info-wrapper .byline')
          ?.textContent?.split('•')[0]
          ?.trim() ?? '';
      this.searchLyrics(`${title} ${artist}`.trim());
    });
    this.notFound.append(text, button);
    side.append(this.notFound);
  }

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
    document.body.style.removeProperty(CREDIT_VAR);
    this.notFound?.remove();
    this.notFound = null;
    document.body.classList.remove(MODE_CLASS, 'lg-lyrics-missing');
  }

  private tick() {
    if (!this.button?.isConnected) this.attachButton();
    const open = isPlayerPageOpen() && isLyricsTabSelected();
    document.body.classList.toggle(MODE_CLASS, open);
    this.button?.classList.toggle('active', open);
    this.button?.setAttribute('aria-pressed', String(open));
    if (open) this.updateCredit();
    this.updateTranslation();
  }

  // Crédito (fuente real y estilo de Better Lyrics) al final de la letra: lo
  // pinta el pie que Synced Lyrics añade tras la última línea, con esta
  // variable CSS
  private updateCredit() {
    const side = document.querySelector('ytmusic-player-page #side-panel');
    if (!side) return;
    this.updateNotFound(side);

    const provider = lyricsStore.provider;
    const state = lyricsStore.lyrics[provider];
    const found = state?.state === 'done' && state.data !== null;
    const text = found
      ? this.labels.credit(PROVIDER_LABELS[provider] ?? provider)
      : '';
    const value = JSON.stringify(text);
    if (document.body.style.getPropertyValue(CREDIT_VAR) !== value)
      document.body.style.setProperty(CREDIT_VAR, value);
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
