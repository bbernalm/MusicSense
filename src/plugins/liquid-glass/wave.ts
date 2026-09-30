/*
 * Barra de progreso propia, encima de la de YouTube Music (que queda debajo
 * solo para el teclado):
 * - Se pulsa en cualquier punto y salta ahí; se arrastra de forma fluida con
 *   una vista previa del tiempo. La de YouTube agarraba su indicador al
 *   pulsar cerca (no dejaba volver unos segundos) e iba a saltos.
 * - Avanza en cada fotograma (el video solo avisa ~4 veces por segundo).
 * - Estilos (opción progressStyle, clase lg-progress-<estilo> en body):
 *   onda + indicador (Android 13), onda + bolita, línea y línea + bolita.
 * - Tiempo transcurrido a la izquierda y restante a la derecha.
 */

export const PROGRESS_STYLES = [
  'wave',
  'wave-dot',
  'line',
  'line-dot',
] as const;
export type ProgressStyle = (typeof PROGRESS_STYLES)[number];

type Player = HTMLElement & {
  seekTo?: (seconds: number, ahead: boolean) => void;
};

// 3:07 o 1:02:05
const formatTime = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${minutes}:${secs}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export class WaveProgress {
  private elapsed: HTMLSpanElement | null = null;
  private remaining: HTMLSpanElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private tip: HTMLDivElement | null = null;
  private video: HTMLVideoElement | null = null;
  private frame: number | null = null;
  private retryTimer: number | null = null;
  // Mientras se arrastra: posición elegida (0 a 1)
  private dragRatio: number | null = null;
  // Tras soltar, hasta que el video llega al punto elegido
  private pendingRatio: number | null = null;
  private pendingUntil = 0;
  private lastRatio = -1;
  private lastSecond = -1;
  private style: ProgressStyle = 'wave';

  private readonly onPlay = () => this.setPlaying(true);
  private readonly onPause = () => this.setPlaying(false);

  start() {
    this.setStyle(this.style);
    this.attach();
  }

  stop() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.retryTimer = null;
    this.frame = null;
    this.video?.removeEventListener('play', this.onPlay);
    this.video?.removeEventListener('pause', this.onPause);
    this.overlay?.remove();
    this.tip?.remove();
    this.elapsed?.remove();
    this.remaining?.remove();
    this.overlay = null;
    this.tip = null;
    this.elapsed = null;
    this.remaining = null;
    this.video = null;
    for (const name of PROGRESS_STYLES)
      document.body.classList.remove(`lg-progress-${name}`);
  }

  setStyle(style: string) {
    const next = PROGRESS_STYLES.find((name) => name === style) ?? 'wave';
    this.style = next;
    for (const name of PROGRESS_STYLES)
      document.body.classList.toggle(`lg-progress-${name}`, name === next);
  }

  private attach() {
    const slider = document.querySelector<HTMLElement>(
      'ytmusic-player-bar #progress-bar',
    );
    // El del reproductor de YouTube (no el de la portada animada)
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    if (!slider || !video) {
      this.retryTimer = window.setTimeout(() => this.attach(), 1000);
      return;
    }
    this.video = video;

    const overlay = document.createElement('div');
    overlay.className = 'lg-seek';
    overlay.innerHTML =
      '<div class="lg-seek-track"></div><div class="lg-seek-played"><div class="lg-seek-strip"></div><div class="lg-seek-flat"></div></div><div class="lg-seek-thumb"></div>';
    slider.append(overlay);
    this.overlay = overlay;

    const tip = document.createElement('div');
    tip.className = 'lg-seek-tip';
    document.body.append(tip);
    this.tip = tip;

    this.bindPointer(overlay);
    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    this.setPlaying(!video.paused);
    this.loop();
  }

  private setPlaying(playing: boolean) {
    this.overlay?.classList.toggle('playing', playing);
  }

  private ratioAt(clientX: number) {
    const rect = this.overlay?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }

  private duration() {
    const duration = this.video?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  private bindPointer(overlay: HTMLDivElement) {
    // La barra de YouTube no debe enterarse (haría su propio salto)
    const block = (event: Event) => event.stopPropagation();
    for (const type of ['mousedown', 'touchstart', 'click', 'tap'])
      overlay.addEventListener(type, block);

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.duration()) return;
      event.stopPropagation();
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add('dragging');
      this.dragRatio = this.ratioAt(event.clientX);
      this.showTip(event.clientX);
    });
    overlay.addEventListener('pointermove', (event) => {
      if (this.dragRatio !== null) this.dragRatio = this.ratioAt(event.clientX);
      this.showTip(event.clientX);
    });
    const finish = (event: PointerEvent, apply: boolean) => {
      if (this.dragRatio === null) return;
      const ratio = this.ratioAt(event.clientX);
      this.dragRatio = null;
      overlay.classList.remove('dragging');
      if (apply) this.seek(ratio);
    };
    overlay.addEventListener('pointerup', (event) => finish(event, true));
    overlay.addEventListener('pointercancel', (event) => finish(event, false));
    overlay.addEventListener('pointerleave', () => {
      if (this.dragRatio === null) this.hideTip();
    });
    overlay.addEventListener('lostpointercapture', () => {
      if (this.dragRatio === null) this.hideTip();
    });
  }

  private seek(ratio: number) {
    const duration = this.duration();
    if (!duration) return;
    const seconds = ratio * duration;
    const player = document.querySelector<Player>('#movie_player');
    if (player?.seekTo) player.seekTo(seconds, true);
    else if (this.video) this.video.currentTime = seconds;
    // Hasta que el video llegue ahí se sigue mostrando el punto elegido
    this.pendingRatio = ratio;
    this.pendingUntil = performance.now() + 1500;
  }

  // Tiempo en el punto del puntero, encima de la barra
  private showTip(clientX: number) {
    const tip = this.tip;
    const rect = this.overlay?.getBoundingClientRect();
    const duration = this.duration();
    if (!tip || !rect || !duration) return;
    const ratio = this.dragRatio ?? this.ratioAt(clientX);
    tip.textContent = formatTime(ratio * duration);
    const offset = ratio * rect.width;
    tip.style.left = `${rect.left + offset}px`;
    tip.style.top = `${rect.top}px`;
    tip.classList.add('visible');
  }

  private hideTip() {
    this.tip?.classList.remove('visible');
  }

  // Cada fotograma: posición real del video (o la del arrastre)
  private loop() {
    this.frame = requestAnimationFrame(() => this.loop());
    if (!this.overlay?.isConnected) {
      // YouTube Music volvió a crear la barra: se engancha a la nueva
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.overlay?.remove();
      this.tip?.remove();
      this.video?.removeEventListener('play', this.onPlay);
      this.video?.removeEventListener('pause', this.onPause);
      this.attach();
      return;
    }
    const duration = this.duration();
    let ratio = duration ? (this.video?.currentTime ?? 0) / duration : 0;
    if (this.pendingRatio !== null) {
      const arrived = Math.abs(ratio - this.pendingRatio) * duration < 1;
      if (arrived || performance.now() > this.pendingUntil)
        this.pendingRatio = null;
      else ratio = this.pendingRatio;
    }
    if (this.dragRatio !== null) ratio = this.dragRatio;
    ratio = clamp01(ratio);
    if (Math.abs(ratio - this.lastRatio) > 0.00005) {
      this.lastRatio = ratio;
      this.overlay.style.setProperty('--lg-progress', ratio.toFixed(5));
    }
    this.renderTimes(ratio, duration);
  }

  // Tiempo transcurrido a la izquierda de la barra y restante a la derecha
  private renderTimes(ratio: number, duration: number) {
    const bar = document.querySelector('ytmusic-player-bar');
    if (!bar) return;
    if (!this.elapsed?.isConnected || !this.remaining?.isConnected) {
      this.elapsed?.remove();
      this.remaining?.remove();
      this.elapsed = document.createElement('span');
      this.elapsed.className = 'lg-time lg-time-elapsed';
      this.remaining = document.createElement('span');
      this.remaining.className = 'lg-time lg-time-remaining';
      bar.append(this.elapsed, this.remaining);
      this.lastSecond = -1;
    }
    const current = ratio * duration;
    const second = duration ? Math.floor(current) : -2;
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    this.elapsed.textContent = duration ? formatTime(current) : '';
    this.remaining.textContent = duration
      ? `-${formatTime(duration - current)}`
      : '';
  }
}
