/*
 * Fondo líquido: la portada convertida en ondas de color que fluyen, como el
 * fondo de Better Lyrics Shaders. Usa Kawarp (@kawarp/core, licencia MIT, de
 * Better Lyrics): desenfoque Kawase + deformación del espacio en WebGL.
 *
 * - Al cambiar de canción pasa a la nueva portada con un fundido.
 * - Se dibuja a media resolución (el efecto es suave y no se nota) y se
 *   detiene con la ventana oculta.
 * - Si la portada no se puede leer (permisos del servidor), usa un degradado
 *   con el color de acento.
 */

import { Kawarp } from '@kawarp/core';

// Resolución interna respecto a la ventana
const SCALE = 0.5;

export class LiquidBackground {
  private canvas: HTMLCanvasElement | null = null;
  private kawarp: Kawarp | null = null;
  private artwork = '';

  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => {
    if (document.hidden) this.kawarp?.stop();
    else this.kawarp?.start();
  };

  start(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-liquid';
    container.append(canvas);
    this.canvas = canvas;
    this.resize();
    try {
      this.kawarp = new Kawarp(canvas, {
        // Ondas marcadas y colores vivos, con poca niebla
        warpIntensity: 1,
        blurPasses: 4,
        animationSpeed: 1.2,
        transitionDuration: 1500,
        saturation: 1.6,
        tintIntensity: 0.12,
      });
    } catch (error) {
      console.error(error);
      canvas.remove();
      this.canvas = null;
      return;
    }
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.kawarp.start();
    if (this.artwork) this.load(this.artwork);
  }

  stop() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.kawarp?.dispose();
    this.kawarp = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  setArtwork(url: string) {
    if (!url || url === this.artwork) return;
    this.artwork = url;
    this.load(url);
  }

  private load(url: string) {
    this.kawarp?.loadImage(url).catch(() => {
      if (this.artwork !== url) return;
      const accent =
        getComputedStyle(document.body).getPropertyValue('--lg-accent') ||
        'rgb(250, 45, 72)';
      this.kawarp?.loadGradient([accent, '#15151c', accent], 135);
    });
  }

  private resize() {
    const { canvas } = this;
    if (!canvas) return;
    const width = Math.max(1, Math.round(window.innerWidth * SCALE));
    const height = Math.max(1, Math.round(window.innerHeight * SCALE));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    this.kawarp?.resize();
  }
}
