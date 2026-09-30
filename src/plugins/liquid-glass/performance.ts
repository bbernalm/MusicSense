/*
 * Arreglos de rendimiento sobre el código de YouTube Music.
 *
 * - Listas largas (historial, playlists): por cada fila, YouTube Music mide el
 *   ancho de un menú (clientWidth) para decidir un margen que solo se usa en
 *   los podcasts (insignia "RSS"). Cada medida obliga a recalcular la página
 *   entera: con 200 filas congelaba la app 2–3 s. Se mide solo cuando la fila
 *   tiene esa insignia; el resultado es el mismo.
 */

type Controller = {
  computeShouldAddPaddingToMenu?: (data: { badges?: unknown[] }) => boolean;
};

const hasRssBadge = (data: { badges?: unknown[] } | undefined) =>
  (data?.badges ?? []).some((badge) => JSON.stringify(badge).includes('"RSS"'));

// Busca en la cadena de prototipos el que define la función y la envuelve
const patchMenuPadding = () => {
  // Una fila suelta (sin añadir a la página) basta para llegar a su clase
  const tag = 'ytmusic-responsive-list-item-renderer';
  if (!customElements.get(tag)) return false;
  const row = document.createElement(tag) as HTMLElement & {
    polymerController?: Controller;
  };
  let proto: Controller | null = row?.polymerController
    ? (Object.getPrototypeOf(row.polymerController) as Controller)
    : null;
  while (
    proto &&
    !Object.prototype.hasOwnProperty.call(
      proto,
      'computeShouldAddPaddingToMenu',
    )
  )
    proto = Object.getPrototypeOf(proto) as Controller | null;
  const original = proto?.computeShouldAddPaddingToMenu;
  if (!proto || !original) return false;
  proto.computeShouldAddPaddingToMenu = function (
    this: Controller,
    data: { badges?: unknown[] },
  ) {
    return hasRssBadge(data) ? original.call(this, data) : false;
  };
  return true;
};

export class PerformanceFixes {
  private timer: number | null = null;

  start() {
    // Se espera a que YouTube Music haya registrado sus componentes
    if (patchMenuPadding()) return;
    this.timer = window.setInterval(() => {
      if (patchMenuPadding()) this.stop();
    }, 500);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}
