/*
 * "Me gusta" con corazones en toda la app (la píldora ya lo tenía): marca las
 * opciones de los menús ⋮ cuyo icono es el pulgar ("Agregar a las canciones
 * que te gustaron" / "Quitar de...") con la clase lg-heart-item; el CSS
 * (style.css) cambia su icono por un corazón. Los botones de las filas y la
 * portada de "Música que te gustó" se cambian solo con CSS.
 */

type MenuItem = HTMLElement & {
  data?: {
    defaultIcon?: { iconType?: string };
    toggledIcon?: { iconType?: string };
    icon?: { iconType?: string };
  };
};

const HEART_CLASS = 'lg-heart-item';
// Iconos de YouTube Music para "me gusta" (pulgar)
const LIKE_ICONS = new Set(['FAVORITE', 'UNFAVORITE', 'LIKE', 'DISLIKE_OFF']);
const ITEMS =
  'ytmusic-toggle-menu-service-item-renderer, ytmusic-menu-service-item-renderer';

const isLikeItem = (item: MenuItem) =>
  [
    item.data?.defaultIcon?.iconType,
    item.data?.toggledIcon?.iconType,
    item.data?.icon?.iconType,
  ].some((icon) => icon && LIKE_ICONS.has(icon));

export class Hearts {
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  // YouTube reutiliza las filas del menú con otros datos al abrir otro: se
  // vuelve a marcar tras cada clic (cuando se abre un menú)
  private readonly onClick = () => {
    for (const delay of [60, 300])
      window.setTimeout(() => this.markAll(), delay);
  };

  start() {
    // Los menús se crean en ytmusic-popup-container, que puede tardar en
    // existir: se espera a él y se vigila lo que se añade dentro
    this.timer = window.setInterval(() => this.attach(), 1000);
    this.attach();
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('contextmenu', this.onClick, true);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('contextmenu', this.onClick, true);
  }

  private markAll() {
    const container = document.querySelector('ytmusic-popup-container');
    if (container) this.mark(container);
  }

  private attach() {
    const container = document.querySelector('ytmusic-popup-container');
    if (!container || this.observer) return;
    this.observer = new MutationObserver(() => this.mark(container));
    this.observer.observe(container, { childList: true, subtree: true });
    this.mark(container);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private mark(container: Element) {
    for (const item of container.querySelectorAll<MenuItem>(ITEMS))
      item.classList.toggle(HEART_CLASS, isLikeItem(item));
  }
}
