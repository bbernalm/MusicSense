/*
 * Vigilante de menús y diálogos invisibles.
 *
 * A veces un menú o diálogo de YouTube Music se queda abierto pero sin verse
 * (p. ej. se abrió con la ventana tapada por un juego, cuando Windows frena
 * las animaciones, y se quedó transparente). Mientras está abierto YouTube no
 * deja hacer clic fuera de él: la ventana parece no responder hasta pulsar
 * Esc. Aquí se busca cada segundo y medio; si uno sigue abierto e invisible
 * en dos revisiones seguidas (y no es uno de los que la app abre a propósito
 * sin mostrar, clase lg-silent-menu), se cierra como haría Esc.
 */

type Overlay = HTMLElement & {
  opened?: boolean;
  close?: () => void;
  cancel?: (event?: Event) => void;
};

const SILENT_MENU_CLASS = 'lg-silent-menu';
const OVERLAYS =
  'tp-yt-iron-dropdown, tp-yt-paper-dialog, tp-yt-iron-overlay-backdrop';

// ¿Se ve algo de él? (opacidad, visibilidad y tamaño, también de su contenido)
const isVisible = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  for (
    let node: HTMLElement | null = element;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) < 0.05) return false;
  }
  return true;
};

export class OverlayGuard {
  private timer: number | null = null;
  // Abiertos e invisibles en la revisión anterior
  private suspects = new Set<Overlay>();
  // Momento en que empezó el modo "menú sin mostrar"
  private silentSince = 0;

  start() {
    this.timer = window.setInterval(() => this.check(), 1500);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.suspects.clear();
  }

  private check() {
    const body = document.body.classList;
    // El modo "sin mostrar" dura menos de 2 s: si sigue, se quita
    if (body.contains(SILENT_MENU_CLASS)) {
      this.silentSince ||= performance.now();
      if (performance.now() - this.silentSince < 4000) return;
      body.remove(SILENT_MENU_CLASS);
    }
    this.silentSince = 0;

    const open = [...document.querySelectorAll<Overlay>(OVERLAYS)].filter(
      (element) =>
        element.opened === true ||
        (element.tagName === 'TP-YT-IRON-OVERLAY-BACKDROP' &&
          element.hasAttribute('opened')),
    );
    const invisible = open.filter((element) => !isVisible(element));
    // El fondo oscuro de un diálogo que sí se ve no es sospechoso
    const visibleDialog = open.some(
      (element) =>
        element.tagName !== 'TP-YT-IRON-OVERLAY-BACKDROP' && isVisible(element),
    );

    const next = new Set<Overlay>();
    for (const element of invisible) {
      if (element.tagName === 'TP-YT-IRON-OVERLAY-BACKDROP' && visibleDialog)
        continue;
      if (this.suspects.has(element)) this.dismiss(element);
      else next.add(element);
    }
    this.suspects = next;
  }

  private dismiss(element: Overlay) {
    console.warn('[MusicSense] Cerrado un menú/diálogo invisible', element);
    if (element.tagName === 'TP-YT-IRON-OVERLAY-BACKDROP') {
      element.close?.();
      element.removeAttribute('opened');
      return;
    }
    if (element.cancel) element.cancel();
    else element.close?.();
  }
}
