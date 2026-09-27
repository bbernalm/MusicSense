/*
 * Barra de progreso ondulada (estilo Android 13+).
 * Se dibuja encima de la barra nativa de YouTube Music, que sigue
 * encargándose de los clics y el arrastre.
 */

type SliderElement = HTMLElement & {
  value?: number;
  immediateValue?: number;
  max?: number;
};

export class WaveProgress {
  private overlay: HTMLDivElement | null = null;
  private slider: SliderElement | null = null;
  private video: HTMLVideoElement | null = null;
  private retryTimer: number | null = null;
  private readonly update = () => this.render();
  private readonly onPlay = () => this.setPlaying(true);
  private readonly onPause = () => this.setPlaying(false);
  private readonly onHover = (event: MouseEvent) => this.fixHoverTime(event);

  start() {
    this.attach();
  }

  stop() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.slider?.removeEventListener('immediate-value-change', this.update);
    this.slider?.removeEventListener('value-change', this.update);
    window.removeEventListener('mousemove', this.onHover);
    if (this.video) {
      this.video.removeEventListener('timeupdate', this.update);
      this.video.removeEventListener('seeked', this.update);
      this.video.removeEventListener('play', this.onPlay);
      this.video.removeEventListener('pause', this.onPause);
    }
    this.overlay?.remove();
    this.overlay = null;
    this.slider = null;
    this.video = null;
  }

  private attach() {
    const slider = document.querySelector<SliderElement>(
      'ytmusic-player-bar #progress-bar',
    );
    const container = slider?.querySelector<HTMLElement>('#sliderContainer');
    // El del reproductor de YouTube (no el de la portada animada)
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    if (!slider || !container || !video) {
      this.retryTimer = window.setTimeout(() => this.attach(), 1000);
      return;
    }

    this.slider = slider;
    this.video = video;

    const overlay = document.createElement('div');
    overlay.className = 'lg-wave';
    overlay.innerHTML =
      '<div class="lg-wave-played"><div class="lg-wave-line"></div><div class="lg-wave-flat"></div></div>';
    container.append(overlay);
    this.overlay = overlay;

    slider.addEventListener('immediate-value-change', this.update);
    slider.addEventListener('value-change', this.update);
    video.addEventListener('timeupdate', this.update);
    video.addEventListener('seeked', this.update);
    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    // En la ventana para ejecutarse después del cálculo de YouTube Music
    window.addEventListener('mousemove', this.onHover);

    this.setPlaying(!video.paused);
    this.render();
  }

  private setPlaying(playing: boolean) {
    this.overlay?.classList.toggle('playing', playing);
  }

  /*
   * YouTube Music calcula el tiempo que muestra al pasar el ratón como si la
   * barra empezara en el borde izquierdo de la ventana. Se corrige con la
   * posición real de la barra dentro de la píldora.
   */
  private fixHoverTime(event: MouseEvent) {
    const label = document.querySelector<HTMLElement>('#hover-time-info');
    const bar = document.querySelector<HTMLElement>('ytmusic-player-bar');
    if (!this.slider || !this.video || !label || !bar) return;
    if (!this.slider.contains(event.target as Node)) return;

    const rect = this.slider.getBoundingClientRect();
    const duration = this.video.duration;
    if (!(duration > 0) || rect.width <= 0) return;

    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const seconds = Math.floor(ratio * duration);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = String(seconds % 60).padStart(2, '0');
    label.textContent =
      hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
        : `${minutes}:${secs}`;
    label.style.left = `${event.clientX - bar.getBoundingClientRect().left}px`;
  }

  private render() {
    if (!this.overlay) return;
    let ratio = 0;
    const max = this.slider?.max;
    const value = this.slider?.immediateValue ?? this.slider?.value;
    if (typeof max === 'number' && max > 0 && typeof value === 'number') {
      ratio = value / max;
    } else if (this.video && this.video.duration > 0) {
      ratio = this.video.currentTime / this.video.duration;
    }
    ratio = Math.min(1, Math.max(0, ratio));
    this.overlay.style.setProperty('--lg-progress', String(ratio));
    // La pista gris de la barra nativa usa el mismo valor para empezar tras la onda
    this.slider?.style.setProperty('--lg-progress', String(ratio));
  }
}
