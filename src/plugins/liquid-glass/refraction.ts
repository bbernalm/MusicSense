/*
 * Refracción con aberración cromática para los paneles de vidrio.
 *
 * Para cada panel se genera un mapa de desplazamiento (canvas) que curva el
 * fondo cerca de los bordes, como un lente. Los canales rojo, verde y azul se
 * desplazan con intensidades distintas, lo que crea el borde irisado típico
 * del "liquid glass". Usa backdrop-filter con filtros SVG (solo Chromium).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const REFRACTION_TARGETS = [
  '#player-bar-background',
  '#lg-side-background',
  '#lg-expand-background',
  'ytmusic-search-box .search-box',
  '#guide-renderer',
  '.lg-volume-panel',
];

type Target = {
  element: HTMLElement;
  filterId: string;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Mapa de desplazamiento: rojo = eje X, verde = eje Y, 128 = sin movimiento.
const buildDisplacementMap = (
  width: number,
  height: number,
  radius: number,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(width, height);
  const data = image.data;
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  // Grosor del "lente": una banda ancha en el borde, como el vidrio de iOS 26
  const edge = clamp(Math.min(width, height) * 0.42, 10, 30);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Distancia con signo al borde de un rectángulo redondeado
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      const qx = Math.abs(px) - (halfW - r);
      const qy = Math.abs(py) - (halfH - r);
      const outX = Math.max(qx, 0);
      const outY = Math.max(qy, 0);
      const dist = Math.hypot(outX, outY) + Math.min(Math.max(qx, qy), 0) - r;

      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        nx = Math.sign(px);
      } else {
        ny = Math.sign(py);
      }

      const depth = clamp(-dist / edge, 0, 1);
      const strength = depth >= 1 ? 0 : (1 - depth) ** 2;

      const offset = y * width;
      const index = (offset + x) * 4;
      const shiftX = nx * strength * 127;
      const shiftY = ny * strength * 127;
      data[index] = 128 + shiftX;
      data[index + 1] = 128 + shiftY;
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
};

const channelMatrix = (channel: 0 | 1 | 2) => {
  const rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0'];
  rows[channel] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][channel];
  return `${rows.join(' ')} 0 0 0 1 0`;
};

export class LiquidRefraction {
  private svg: SVGSVGElement | null = null;
  private targets = new Map<HTMLElement, Target>();
  private resizeObserver: ResizeObserver | null = null;
  private scanTimer: number | null = null;
  private counter = 0;
  private blur = 30;

  start(blur: number) {
    this.blur = blur;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.id = 'liquid-glass-filters';
    this.svg.setAttribute('width', '0');
    this.svg.setAttribute('height', '0');
    this.svg.style.position = 'absolute';
    this.svg.style.pointerEvents = 'none';
    document.body.append(this.svg);

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = this.targets.get(entry.target as HTMLElement);
        if (target) this.update(target);
      }
    });

    this.scan();
    // YouTube Music crea algunos paneles más tarde (p. ej. la pantalla del reproductor)
    this.scanTimer = window.setInterval(() => this.scan(), 2000);
  }

  setBlur(blur: number) {
    this.blur = blur;
    for (const target of this.targets.values()) this.applyStyle(target);
  }

  stop() {
    if (this.scanTimer !== null) window.clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const { element } of this.targets.values()) {
      element.style.removeProperty('backdrop-filter');
    }
    this.targets.clear();
    this.svg?.remove();
    this.svg = null;
  }

  private scan() {
    for (const selector of REFRACTION_TARGETS) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (this.targets.has(element)) continue;
        const target: Target = {
          element,
          filterId: `lg-refraction-${this.counter++}`,
          width: 0,
          height: 0,
        };
        this.targets.set(element, target);
        this.resizeObserver?.observe(element);
        this.update(target);
      }
    }

    // Olvida los paneles que YouTube Music eliminó
    for (const [element, target] of this.targets) {
      if (!element.isConnected) {
        this.resizeObserver?.unobserve(element);
        this.svg?.querySelector(`#${target.filterId}`)?.remove();
        this.targets.delete(element);
      }
    }
  }

  private update(target: Target) {
    if (!this.svg) return;
    // Tamaño sin transformaciones (algunos paneles se animan con scale)
    const width = Math.round(target.element.offsetWidth);
    const height = Math.round(target.element.offsetHeight);
    if (width < 8 || height < 8) return;
    if (width === target.width && height === target.height) return;
    target.width = width;
    target.height = height;

    const radius =
      parseFloat(getComputedStyle(target.element).borderTopLeftRadius) || 0;
    const map = buildDisplacementMap(width, height, radius);
    if (!map) return;

    // Intensidad del desplazamiento; cada canal se mueve distinto (aberración)
    const scale = clamp(Math.min(width, height) * 0.85, 18, 56);
    const scales = [scale, scale * 0.9, scale * 0.8];

    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = target.filterId;
    const attrs: Record<string, string> = {
      x: '0',
      y: '0',
      width: String(width),
      height: String(height),
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
    };
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    for (const [key, value] of Object.entries(attrs))
      filter.setAttribute(key, value);

    filter.innerHTML = `
      <feImage href="${map}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>
      ${scales
        .map(
          (s, channel) => `
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${-s}" xChannelSelector="R" yChannelSelector="G" result="d${channel}"/>
      <feColorMatrix in="d${channel}" type="matrix" values="${channelMatrix(channel as 0 | 1 | 2)}" result="c${channel}"/>`,
        )
        .join('')}
      <feBlend in="c0" in2="c1" mode="screen" result="c01"/>
      <feBlend in="c01" in2="c2" mode="screen"/>`;

    this.svg.querySelector(`#${target.filterId}`)?.remove();
    this.svg.append(filter);
    this.applyStyle(target);
  }

  private applyStyle(target: Target) {
    // Primero un desenfoque suave, luego la refracción para que el borde irisado se note
    target.element.style.setProperty(
      'backdrop-filter',
      `blur(${Math.round(this.blur * 0.25)}px) url(#${target.filterId}) saturate(180%) brightness(0.95)`,
      'important',
    );
  }
}
