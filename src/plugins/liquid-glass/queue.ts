/*
 * Fila de reproducción, como "A continuación" de Apple Music:
 * - "Agregar a la fila": YouTube Music la pone al final de toda la cola
 *   (después de la playlist entera) y parecía que no hacía nada. Aquí se
 *   mueve justo después de la canción actual y de lo que ya añadiste.
 * - "Reproducir a continuación": justo después de la actual (como YouTube).
 * - Botón ≡ a la izquierda de las pestañas "A continuación / Similares": abre
 *   la vista "Fila" con lo que añadiste (se puede quitar) y lo que sigue.
 * - La cola se guarda (localStorage) y se recupera al reiniciar la app si
 *   vuelve a sonar la misma canción.
 *
 * La cola es la de YouTube Music (#queue): se lee su estado y se modifica con
 * sus propias acciones (MOVE_ITEM, REMOVE_ITEM, ADD_ITEMS), igual que el
 * complemento Music Together.
 */

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueElement } from '@/types/queue';

type Runs = { runs?: { text: string }[] };

type Renderer = {
  videoId?: string;
  title?: Runs;
  shortBylineText?: Runs;
  lengthText?: Runs;
  thumbnail?: { thumbnails?: { url: string }[] };
  selected?: boolean;
};

type Item = {
  playlistPanelVideoRenderer?: Renderer;
  playlistPanelVideoWrapperRenderer?: {
    primaryRenderer?: { playlistPanelVideoRenderer?: Renderer };
  };
};

type QueueState = {
  items: Item[];
  selectedItemIndex?: number;
  nextQueueItemId?: number;
  queueContextParams?: string;
};

type Saved = {
  savedAt: number;
  videoId: string;
  index: number;
  items: Item[];
  userQueue: string[];
};

export type UpNextLabels = {
  button: string;
  yours: string;
  next: string;
  hint: string;
  remove: string;
  added: string;
};

const OPEN_CLASS = 'lg-upnext-open';
const SAVE_KEY = 'lg-queue';
// Canciones que se guardan como máximo alrededor de la actual
const SAVE_BEFORE = 20;
const SAVE_AFTER = 150;
// Lo que se muestra de "A continuación" en la vista Fila
const NEXT_LIMIT = 40;
// La cola guardada solo se recupera si es de los últimos días
const RESTORE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const QUEUE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path d="M4 6.5h11M4 11.5h11M4 16.5h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M16.5 14v6.2l4.6-3.1Z" fill="currentColor"/>
</svg>`;

const REMOVE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const text = (runs?: Runs) => runs?.runs?.map((run) => run.text).join('') ?? '';

const rendererOf = (item: Item) =>
  item.playlistPanelVideoRenderer ??
  item.playlistPanelVideoWrapperRenderer?.primaryRenderer
    ?.playlistPanelVideoRenderer;

const videoIdOf = (item?: Item) =>
  (item ? rendererOf(item)?.videoId : '') ?? '';

// Canción que suena: la marcada como "selected" (selectedItemIndex del
// estado no siempre está al día)
const selectedIndex = (state: QueueState) => {
  const index = state.items.findIndex((item) => rendererOf(item)?.selected);
  return index >= 0 ? index : (state.selectedItemIndex ?? 0);
};

const queueElement = () => document.querySelector<QueueElement>('#queue');

// Copia sin la marca de "sonando" (para guardar y volver a añadir)
const unselected = (item: Item): Item => {
  const copy = JSON.parse(JSON.stringify(item)) as Item;
  const renderer = rendererOf(copy);
  if (renderer) renderer.selected = false;
  return copy;
};

export class UpNext {
  private timer: number | null = null;
  private button: HTMLButtonElement | null = null;
  private panel: HTMLDivElement | null = null;
  private subscribed: QueueElement | null = null;
  private unsubscribe: (() => void) | null = null;
  // Canciones añadidas por ti que aún no han sonado (en orden)
  private userQueue: string[] = [];
  private pending: {
    kind: 'end' | 'next';
    length: number;
    selected: number;
    at: number;
  } | null = null;
  private applying = false;
  private changeTimer: number | null = null;
  private saveTimer: number | null = null;
  private rendered = '';
  private restored = false;
  private stableSince = 0;
  private lastLength = -1;

  constructor(private readonly labels: UpNextLabels) {}

  private readonly onClick = (event: MouseEvent) => {
    const item = (event.target as Element | null)?.closest<
      HTMLElement & {
        data?: {
          icon?: { iconType?: string };
          serviceEndpoint?: {
            queueAddEndpoint?: { queueInsertPosition?: string };
          };
        };
      }
    >('ytmusic-menu-service-item-renderer');
    const icon = item?.data?.icon?.iconType;
    if (icon !== 'ADD_TO_REMOTE_QUEUE' && icon !== 'QUEUE_PLAY_NEXT') return;
    const state = this.state();
    if (!state) return;
    // "Agregar a la fila" va al final de toda la playlist (si no está cargada
    // entera, ni siquiera aparece en la cola): se pide a YouTube Music que la
    // ponga detrás de la actual y afterChange la lleva detrás de lo añadido
    const endpoint = item?.data?.serviceEndpoint?.queueAddEndpoint;
    if (icon === 'ADD_TO_REMOTE_QUEUE' && endpoint && state.items.length)
      endpoint.queueInsertPosition = 'INSERT_AFTER_CURRENT_VIDEO';
    this.pending = {
      kind: icon === 'ADD_TO_REMOTE_QUEUE' ? 'end' : 'next',
      length: state.items.length,
      selected: selectedIndex(state),
      at: Date.now(),
    };
  };

  start() {
    try {
      const saved = this.loadSaved();
      if (saved) this.userQueue = saved.userQueue ?? [];
    } catch {
      // Sin cola guardada
    }
    document.addEventListener('click', this.onClick, true);
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('click', this.onClick, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribed = null;
    this.button?.remove();
    this.panel?.remove();
    this.button = null;
    this.panel = null;
    document.body.classList.remove(OPEN_CLASS);
  }

  private state() {
    return queueElement()?.queue?.store?.store?.getState()?.queue as
      | QueueState
      | undefined;
  }

  private dispatch(type: string, payload?: unknown) {
    this.applying = true;
    try {
      queueElement()?.dispatch({ type, payload });
    } finally {
      this.applying = false;
    }
  }

  private tick() {
    const queue = queueElement();
    if (queue && queue !== this.subscribed && queue.queue?.store?.store) {
      this.unsubscribe?.();
      const result = queue.queue.store.store.subscribe(() =>
        this.onStoreChange(),
      );
      this.unsubscribe =
        typeof result === 'function' ? (result as () => void) : null;
      this.subscribed = queue;
    }
    if (this.pending && Date.now() - this.pending.at > 8000)
      this.pending = null;

    this.restoreSaved();
    this.ensureButton();
    if (document.body.classList.contains(OPEN_CLASS)) this.render();
  }

  private onStoreChange() {
    if (this.applying) return;
    if (this.changeTimer !== null) window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = null;
      this.afterChange();
    }, 0);
  }

  // Coloca lo recién añadido y mantiene la lista de lo que añadiste
  private afterChange() {
    const state = this.state();
    if (!state) return;
    const pending = this.pending;
    const added = pending ? state.items.length - pending.length : 0;
    // Con la cola vacía YouTube Music empieza a reproducir lo añadido: no
    // hay nada que colocar
    if (pending && pending.length === 0) this.pending = null;
    else if (pending && added > 0) {
      this.pending = null;
      const selected = selectedIndex(state);
      // YouTube Music las pone justo detrás de la actual
      const ids = state.items
        .slice(selected + 1, selected + 1 + added)
        .map(videoIdOf);
      if (pending.kind === 'end') {
        // "Agregar a la fila": detrás de lo que ya añadiste
        const userCount = this.upcomingUserCount(state, added);
        if (userCount > 0) {
          const target = selected + userCount + added;
          for (let i = 0; i < added; i++)
            this.dispatch('MOVE_ITEM', {
              fromIndex: selected + 1,
              toIndex: target,
            });
        }
        this.userQueue.splice(userCount, 0, ...ids);
      } else {
        // "Reproducir a continuación": delante de lo que ya añadiste
        this.userQueue.unshift(...ids);
      }
    }
    this.prune();
    this.scheduleSave();
    this.rendered = '';
  }

  // Cuántas de las siguientes a la actual son las que añadiste
  // (offset: canciones recién insertadas entre la actual y las tuyas)
  private upcomingUserCount(state = this.state(), offset = 0) {
    if (!state) return 0;
    const first = selectedIndex(state) + 1 + offset;
    let count = 0;
    while (
      count < this.userQueue.length &&
      videoIdOf(state.items[first + count]) === this.userQueue[count]
    )
      count++;
    return count;
  }

  // Quita de tu fila lo que ya sonó o ya no está a continuación
  private prune() {
    const state = this.state();
    if (!state) return;
    const current = videoIdOf(state.items[selectedIndex(state)]);
    while (this.userQueue.length && this.userQueue[0] === current)
      this.userQueue.shift();
    this.userQueue.length = this.upcomingUserCount(state);
  }

  // ---------- Guardar y recuperar la cola ----------
  private loadSaved() {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  }

  private scheduleSave() {
    if (!this.restored) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 1500);
  }

  private save() {
    const state = this.state();
    if (!state?.items.length) return;
    const selected = selectedIndex(state);
    const start = Math.max(0, selected - SAVE_BEFORE);
    const items = state.items
      .slice(start, selected + 1 + SAVE_AFTER)
      .map(unselected);
    const saved: Saved = {
      savedAt: Date.now(),
      videoId: videoIdOf(state.items[selected]),
      index: selected - start,
      items,
      userQueue: this.userQueue,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    } catch {
      // Sin espacio: la cola no se guarda esta vez
    }
  }

  // Al arrancar YouTube Music vuelve a la última canción, pero la cola se
  // rehace (las mezclas cambian y se pierde lo añadido). Si suena la misma
  // canción que al guardar, se vuelve a poner lo que venía después de ella.
  // Nunca se toca la canción que suena ni las anteriores: primero se añaden
  // las guardadas justo detrás y solo si eso funcionó se quitan las que puso
  // YouTube Music.
  private restoreSaved() {
    if (this.restored) return;
    const state = this.state();
    const length = state?.items.length ?? 0;
    // Se espera a que YouTube Music termine de cargar su cola
    if (length !== this.lastLength) {
      this.lastLength = length;
      this.stableSince = Date.now();
      return;
    }
    if (!state || length === 0 || Date.now() - this.stableSince < 2500) return;
    const selected = state.items.findIndex(
      (item) => rendererOf(item)?.selected,
    );
    if (selected < 0) return;
    this.restored = true;

    let saved: Saved | null;
    try {
      saved = this.loadSaved();
    } catch {
      saved = null;
    }
    const current = videoIdOf(state.items[selected]);
    const recent = saved && Date.now() - saved.savedAt < RESTORE_MAX_AGE;
    // Si ya añadiste algo o suena otra canción, la cola de ahora manda
    if (
      this.pending ||
      !saved?.items?.length ||
      !recent ||
      saved.videoId !== current
    ) {
      this.userQueue = [];
      this.save();
      return;
    }

    const after = saved.items.slice(saved.index + 1);
    const upcoming = state.items.slice(selected + 1);
    const same =
      after.length === upcoming.length &&
      after.every((item, i) => videoIdOf(item) === videoIdOf(upcoming[i]));
    if (!same && after.length) {
      this.dispatch('ADD_ITEMS', {
        nextQueueItemId: state.nextQueueItemId ?? 0,
        index: selected + 1,
        items: after,
        shuffleEnabled: false,
        shouldAssignIds: true,
      });
      const added = (this.state()?.items.length ?? 0) - length;
      if (added === after.length) {
        const first = selected + 1 + after.length;
        for (let i = first + upcoming.length - 1; i >= first; i--)
          this.dispatch('REMOVE_ITEM', i);
      }
    }
    this.userQueue = saved.userQueue ?? [];
    this.prune();
    this.save();
  }

  // ---------- Vista "Fila" ----------
  private ensureButton() {
    const side = document.querySelector<HTMLElement>(
      'ytmusic-player-page #side-panel',
    );
    const tabs = side?.querySelector<HTMLElement>(
      ':scope > .tab-header-container',
    );
    if (!side || !tabs) return;

    if (!this.button?.isConnected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lg-upnext-button';
      button.title = this.labels.button;
      button.setAttribute('aria-label', this.labels.button);
      button.innerHTML = QUEUE_ICON;
      button.addEventListener('click', () => this.toggle());
      side.append(button);
      this.button = button;
      // Al pulsar una pestaña se vuelve a ella
      tabs.addEventListener('click', () => this.toggle(false));
    }
    if (!this.panel?.isConnected) {
      const panel = document.createElement('div');
      panel.className = 'lg-upnext';
      side.append(panel);
      this.panel = panel;
      this.rendered = '';
    }
    // Alineado con la cápsula de pestañas
    const top = `${tabs.offsetTop}px`;
    if (this.button.style.top !== top) this.button.style.top = top;
    const open = document.body.classList.contains(OPEN_CLASS);
    this.button.setAttribute('aria-pressed', String(open));
  }

  private toggle(force?: boolean) {
    const open = document.body.classList.toggle(OPEN_CLASS, force);
    this.button?.setAttribute('aria-pressed', String(open));
    this.rendered = '';
    if (open) this.render();
  }

  private render() {
    const state = this.state();
    if (!this.panel || !state) return;
    this.prune();
    const selected = selectedIndex(state);
    const userCount = this.upcomingUserCount(state);
    const upcoming = state.items.slice(selected + 1);
    const key = `${selected}:${userCount}:${upcoming
      .slice(0, NEXT_LIMIT + userCount)
      .map(videoIdOf)
      .join(',')}`;
    if (key === this.rendered) return;
    this.rendered = key;

    const section = (title: string) => {
      const heading = document.createElement('h3');
      heading.className = 'lg-upnext-title';
      heading.textContent = title;
      return heading;
    };
    const children: HTMLElement[] = [section(this.labels.yours)];
    if (userCount === 0) {
      const hint = document.createElement('p');
      hint.className = 'lg-upnext-hint';
      hint.textContent = this.labels.hint;
      children.push(hint);
    }
    upcoming.slice(0, userCount).forEach((item, i) => {
      children.push(this.row(item, selected + 1 + i, true));
    });
    const rest = upcoming.slice(userCount, userCount + NEXT_LIMIT);
    if (rest.length) {
      children.push(section(this.labels.next));
      rest.forEach((item, i) => {
        children.push(this.row(item, selected + 1 + userCount + i, false));
      });
    }
    this.panel.replaceChildren(...children);
  }

  private row(item: Item, index: number, removable: boolean) {
    const renderer = rendererOf(item);
    const row = document.createElement('div');
    row.className = 'lg-upnext-row';
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    const url = renderer?.thumbnail?.thumbnails?.[0]?.url;
    if (url) image.src = url;
    const texts = document.createElement('div');
    texts.className = 'lg-upnext-text';
    const title = document.createElement('span');
    title.className = 'lg-upnext-song';
    title.textContent = text(renderer?.title);
    const artist = document.createElement('span');
    artist.className = 'lg-upnext-artist';
    artist.textContent = text(renderer?.shortBylineText);
    texts.append(title, artist);
    row.append(image, texts);

    if (removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'lg-upnext-remove';
      remove.title = this.labels.remove;
      remove.setAttribute('aria-label', this.labels.remove);
      remove.innerHTML = REMOVE_ICON;
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.remove(index);
      });
      row.append(remove);
    } else {
      const length = document.createElement('span');
      length.className = 'lg-upnext-length';
      length.textContent = text(renderer?.lengthText);
      row.append(length);
    }
    row.addEventListener('click', () => this.play(index));
    return row;
  }

  // Botón del panel (panel-actions.ts): la canción va detrás de la actual y
  // de lo que ya añadiste (next: justo detrás de la actual). Se pide a
  // YouTube Music como Music Together (/music/get_queue) y se inserta en la
  // cola con ADD_ITEMS.
  async addToQueue(videoId: string, next = false) {
    const state = this.state();
    const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
    if (!state || !app) return false;
    const response = await app.networkManager.fetch<
      { queueDatas?: { content?: Item }[] },
      { queueContextParams?: string; videoIds: string[] }
    >('/music/get_queue', {
      queueContextParams: state.queueContextParams,
      videoIds: [videoId],
    });
    const items = (response?.queueDatas ?? [])
      .map((data) => data.content)
      .filter((item): item is Item => Boolean(item))
      .map(unselected);
    const fresh = this.state();
    if (!items.length || !fresh) return false;

    this.prune();
    const userCount = next ? 0 : this.upcomingUserCount(fresh);
    this.dispatch('ADD_ITEMS', {
      nextQueueItemId: fresh.nextQueueItemId ?? 0,
      index: selectedIndex(fresh) + 1 + userCount,
      items,
      shuffleEnabled: false,
      shouldAssignIds: true,
    });
    this.userQueue.splice(userCount, 0, ...items.map(videoIdOf));
    this.rendered = '';
    this.scheduleSave();
    if (!next) this.toast(this.labels.added);
    return true;
  }

  // Aviso de vidrio de YouTube Music (el mismo de "Se agregó a la fila")
  toast(message: string) {
    document
      .querySelector<
        HTMLElement & { resolveCommand?: (command: unknown) => unknown }
      >('ytmusic-app')
      ?.resolveCommand?.({
        addToToastAction: {
          item: {
            notificationTextRenderer: {
              successResponseText: { runs: [{ text: message }] },
            },
          },
        },
      });
  }

  private remove(index: number) {
    const state = this.state();
    if (!state) return;
    const selected = selectedIndex(state);
    const position = index - selected - 1;
    this.dispatch('REMOVE_ITEM', index);
    if (position >= 0 && position < this.userQueue.length)
      this.userQueue.splice(position, 1);
    this.rendered = '';
    this.render();
    this.scheduleSave();
  }

  // Se reproduce pulsando el elemento de la cola de YouTube Music
  private play(index: number) {
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        'ytmusic-player-queue #contents > ytmusic-player-queue-item, ytmusic-player-queue #contents > ytmusic-playlist-panel-video-wrapper-renderer',
      ),
    ];
    const target = items[index];
    const play = target?.querySelector<HTMLElement>(
      'ytmusic-play-button-renderer',
    );
    if (play) play.click();
    else this.dispatch('SET_INDEX', index);
  }
}
