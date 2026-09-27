/*
 * Visualizador: pequeña píldora de vidrio que sale por encima de la píldora
 * del reproductor mientras suena música, con barras que siguen el audio y el
 * color de la portada.
 *
 * El audio lo da Pear con el evento "peard:audio-can-play" (el mismo que usa
 * su complemento Visualizer): se conecta un AnalyserNode a esa fuente, sin
 * tocar la salida de sonido.
 */

type AudioDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};

const BARS = 28;

export class Visualizer {
  private root: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private frame: number | null = null;
  private timer: number | null = null;
  private color = '255, 255, 255';
  private artwork = '';

  private readonly onAudio = (event: Event) => {
    const detail = (event as CustomEvent<AudioDetail>).detail;
    if (!detail?.audioSource || detail.audioSource === this.source) return;
    this.analyser?.disconnect();
    const analyser = detail.audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.78;
    detail.audioSource.connect(analyser);
    this.source = detail.audioSource;
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
  };

  start() {
    document.addEventListener('peard:audio-can-play', this.onAudio);
    const root = document.createElement('div');
    root.id = 'lg-visualizer';
    const canvas = document.createElement('canvas');
    root.append(canvas);
    document.body.append(root);
    this.root = root;
    this.canvas = canvas;
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
    this.draw();
  }

  stop() {
    document.removeEventListener('peard:audio-can-play', this.onAudio);
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = null;
    this.frame = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.source = null;
    this.root?.remove();
    this.root = null;
    this.canvas = null;
  }

  private isActive() {
    const body = document.body.classList;
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    return (
      Boolean(this.analyser) &&
      Boolean(video && !video.paused) &&
      !body.contains('lg-paused') &&
      !body.contains('lg-idle') &&
      !body.contains('lg-bar-loading')
    );
  }

  private tick() {
    this.root?.classList.toggle('visible', this.isActive());
    this.updateColor();
  }

  // Color medio de la portada (se lee una miniatura de 8×8 px)
  private updateColor() {
    const src =
      document.querySelector<HTMLImageElement>(
        'ytmusic-player-bar .thumbnail-image-wrapper img.image',
      )?.src ?? '';
    if (!src || src === this.artwork) return;
    this.artwork = src;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 8, 8);
        const pixels = context.getImageData(0, 0, 8, 8).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          red += pixels[i];
          green += pixels[i + 1];
          blue += pixels[i + 2];
        }
        const count = pixels.length / 4;
        // Se aclara para que se vea sobre el vidrio oscuro
        const lift = (value: number) => {
          const scaled = (value / count) * 0.6;
          return Math.round(Math.min(255, scaled + 110));
        };
        this.color = `${lift(red)}, ${lift(green)}, ${lift(blue)}`;
      } catch {
        // Imagen sin permiso de lectura: se queda el color anterior
      }
    };
    image.src = src;
  }

  private draw() {
    this.frame = requestAnimationFrame(() => this.draw());
    const canvas = this.canvas;
    if (!canvas || !this.root?.classList.contains('visible')) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context || width === 0) return;
    context.clearRect(0, 0, width, height);

    if (this.analyser && this.data)
      this.analyser.getByteFrequencyData(this.data);
    const step = width / BARS;
    const barWidth = Math.max(2, step * 0.5);
    context.fillStyle = `rgb(${this.color})`;
    for (let i = 0; i < BARS; i++) {
      // Escala logarítmica (como el oído): más barras para graves y medios, y
      // se refuerzan los agudos, que llegan con menos energía
      const position = (i + 1) / BARS;
      const bins = (this.data?.length ?? 0) * 0.75;
      const index = Math.min(
        Math.floor(Math.pow(position, 1.8) * bins),
        (this.data?.length ?? 1) - 1,
      );
      const boost = 0.75 + position;
      const level = Math.min(1, ((this.data?.[index] ?? 0) / 255) * boost);
      const barHeight = Math.max(barWidth, level * height * 0.9);
      const slot = i * step;
      const inset = (step - barWidth) / 2;
      const x = slot + inset;
      const y = (height - barHeight) / 2;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      context.fill();
    }
  }
}
