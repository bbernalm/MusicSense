/*
 * Visualizador en la portada (estilo de los videos de música tipo "Trap
 * Nation"), en la pantalla del reproductor:
 * - Alrededor de la portada, varias capas de luz con el color de la portada
 *   (--lg-accent) salen de sus bordes siguiendo el espectro. Es simétrico:
 *   graves arriba, agudos abajo, igual a izquierda y derecha.
 * - La portada late con los golpes de graves (propiedad scale, que no choca
 *   con el transform que la encoge al pausar).
 *
 * El audio lo da Pear con el evento "peard:audio-can-play": se conecta un
 * AnalyserNode a esa fuente, sin tocar la salida de sonido. Se dibuja en un
 * lienzo detrás de la portada (#lg-visualizer, dentro de #main-panel).
 */

type AudioDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};

// Puntos del contorno (por mitad: el otro lado es su reflejo)
const POINTS = 72;
// Capas de fuera hacia dentro: cuánto salen, opacidad y suavizado
const LAYERS = [
  { gain: 1, alpha: 0.22, smooth: 0.9 },
  { gain: 0.72, alpha: 0.35, smooth: 0.8 },
  { gain: 0.45, alpha: 0.55, smooth: 0.65 },
  { gain: 0.18, alpha: 0.85, smooth: 0.5, white: true },
];
// El lienzo es mayor que la portada (las ondas salen hacia fuera)
const SPREAD = 0.42;
// Cuánto pueden salir las ondas (fracción de la portada)
const REACH = 0.22;
// Energía mínima que no se dibuja
const FLOOR = 0.3;
// Forma de la portada: superelipse casi cuadrada (esquinas redondeadas)
const SHAPE = 9;

const half = (value: number) => value / 2;
// De a hacia b según t (0 a 1)
const mix = (from: number, to: number, amount: number) => {
  const change = (to - from) * amount;
  return from + change;
};

// Última fuente de audio anunciada: si el visualizador se activa a mitad de
// canción, el evento ya pasó y no volvería hasta la siguiente
let latestAudio: AudioDetail | null = null;
document.addEventListener('peard:audio-can-play', (event) => {
  latestAudio = (event as CustomEvent<AudioDetail>).detail ?? latestAudio;
});

export class Visualizer {
  private canvas: HTMLCanvasElement | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private frame: number | null = null;
  private readonly levels = LAYERS.map(() => new Float32Array(POINTS));
  private beat = 0;
  private bassAverage = 0;
  private accent = 'rgb(255, 255, 255)';
  private colorFrames = 0;

  private readonly onAudio = (event: Event) =>
    this.connect((event as CustomEvent<AudioDetail>).detail);

  private connect(detail: AudioDetail | null) {
    if (!detail?.audioSource || detail.audioSource === this.source) return;
    this.analyser?.disconnect();
    const analyser = detail.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    detail.audioSource.connect(analyser);
    this.source = detail.audioSource;
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
  }

  start() {
    document.addEventListener('peard:audio-can-play', this.onAudio);
    this.connect(latestAudio);
    const canvas = document.createElement('canvas');
    canvas.id = 'lg-visualizer';
    this.canvas = canvas;
    this.draw();
  }

  stop() {
    document.removeEventListener('peard:audio-can-play', this.onAudio);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.source = null;
    this.canvas?.remove();
    this.canvas = null;
    this.art()?.style.removeProperty('scale');
  }

  private art() {
    return document.querySelector<HTMLElement>(
      'ytmusic-player-page #song-image',
    );
  }

  // Solo con la pantalla del reproductor abierta, mostrando la portada
  // (no el video) y con música sonando
  private isActive() {
    const body = document.body.classList;
    const page = document.querySelector('ytmusic-player-page');
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    const showsArt =
      !page?.hasAttribute('video-mode') || body.contains('lg-prefer-music');
    return (
      Boolean(this.analyser) &&
      body.contains('lg-np') &&
      showsArt &&
      Boolean(video && !video.paused) &&
      !body.contains('lg-paused')
    );
  }

  // Energía de una banda de frecuencias (0 a 1)
  private band(from: number, to: number) {
    const data = this.data;
    if (!data || !this.analyser) return 0;
    const hz = this.analyser.context.sampleRate / this.analyser.fftSize;
    const start = Math.max(1, Math.floor(from / hz));
    const end = Math.min(data.length - 1, Math.ceil(to / hz));
    let sum = 0;
    for (let i = start; i <= end; i++) sum += data[i];
    return sum / ((end - start + 1) * 255);
  }

  private draw() {
    this.frame = requestAnimationFrame(() => this.draw());
    const canvas = this.canvas;
    const player = document.querySelector<HTMLElement>(
      'ytmusic-player-page #main-panel > #player',
    );
    const art = this.art();
    if (!canvas || !player || !art) return;
    if (canvas.parentElement !== player.parentElement) player.before(canvas);

    const active = this.isActive();
    canvas.classList.toggle('visible', active);
    if (!active) {
      this.beat *= 0.9;
      this.setBeatScale(art);
      if (this.beat < 0.001) art.style.removeProperty('scale');
      return;
    }

    // Lienzo centrado en la portada y más grande que ella
    const size = art.offsetWidth;
    if (!size || !this.data || !this.analyser) return;
    const margin = SPREAD * 2;
    const outer = size * (1 + margin);
    const left = player.offsetLeft + half(player.offsetWidth - outer);
    const top = player.offsetTop + half(player.offsetHeight - outer);
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${outer}px`;
    canvas.style.height = `${outer}px`;
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    const pixels = Math.round(outer * ratio);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const context = canvas.getContext('2d');
    if (!context) return;

    this.analyser.getByteFrequencyData(this.data);

    // Latido: golpe de graves por encima de su media reciente
    const bass = this.band(35, 140);
    this.bassAverage = mix(this.bassAverage, bass, 0.05);
    const usual = this.bassAverage * 1.05;
    const surplus = bass - usual;
    const hit = Math.max(0, surplus) * 4;
    const body = bass * 0.25;
    const target = Math.min(1, hit + body);
    this.beat = target > this.beat ? target : this.beat * 0.88;
    this.setBeatScale(art);

    // Espectro en escala logarítmica (30 Hz a 12 kHz), de arriba a abajo
    const raw = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
      const position = i / (POINTS - 1);
      const low = 30 * Math.pow(400, position);
      // Los agudos llegan con menos energía: se refuerzan
      const extra = position * 1.4;
      const boost = 1 + extra;
      // Se descarta el "suelo" de energía para que solo salgan los picos
      const energy = Math.min(1, this.band(low, low * 1.25) * boost);
      const peak = Math.max(0, energy - FLOOR) / (1 - FLOOR);
      raw[i] = Math.pow(peak, 1.6);
    }
    // Suavizado entre vecinos para formas redondeadas
    const shaped = raw.map((value, i) => {
      const before = raw[Math.max(0, i - 1)];
      const after = raw[Math.min(POINTS - 1, i + 1)];
      return (before + value + value + after) / 4;
    });

    const scale = pixels / outer;
    const center = pixels / 2;
    const radius = half(size) * scale * this.beatScale();
    const reach = size * REACH * scale;
    const gap = reach * 0.02;
    if (++this.colorFrames % 30 === 1)
      this.accent =
        getComputedStyle(document.body)
          .getPropertyValue('--lg-accent')
          .trim() || 'rgb(255, 255, 255)';

    context.clearRect(0, 0, pixels, pixels);
    context.save();
    context.shadowColor = this.accent;
    const pulse = this.beat * 30;
    const glow = 18 + pulse;
    context.shadowBlur = glow * scale;
    const total = POINTS * 2;
    LAYERS.forEach((layer, layerIndex) => {
      const level = this.levels[layerIndex];
      for (let i = 0; i < POINTS; i++) {
        // Sube rápido y baja con suavidad (cada capa a su ritmo)
        level[i] =
          shaped[i] > level[i]
            ? shaped[i]
            : mix(shaped[i], level[i], layer.smooth);
      }
      context.beginPath();
      // Lado derecho de arriba a abajo y el izquierdo de vuelta (reflejo)
      for (let step = 0; step <= total; step++) {
        const mirrored = step <= POINTS ? step : total - step;
        const point = Math.min(POINTS - 1, mirrored);
        const turn = (step / total) * Math.PI * 2;
        const quarter = Math.PI / 2;
        const angle = turn - quarter;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const corner = Math.pow(
          Math.pow(Math.abs(cos), SHAPE) + Math.pow(Math.abs(sin), SHAPE),
          1 / SHAPE,
        );
        const lift = level[point] * reach * layer.gain;
        const edge = radius / corner;
        const distance = edge + lift + gap;
        const offsetX = cos * distance;
        const offsetY = sin * distance;
        const x = center + offsetX;
        const y = center + offsetY;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.globalAlpha = layer.alpha;
      context.fillStyle = layer.white ? '#fff' : this.accent;
      context.fill();
    });
    context.restore();
  }

  private beatScale() {
    const grow = this.beat * 0.05;
    return 1 + grow;
  }

  private setBeatScale(art: HTMLElement) {
    art.style.setProperty('scale', this.beatScale().toFixed(4));
  }
}
