/*
 * Motor de audio de MusicSense: una sola cadena para que las opciones no se
 * pisen entre sí.
 *
 *   fuente → ecualizador (10 bandas) → [audio espacial] → fundido → limitador
 *
 * - Ecualizador: ajustes predefinidos (Plano, Graves, Voz, Agudos...). Se
 *   baja un poco el volumen de entrada cuanto más se suben las bandas, y el
 *   limitador evita que sature.
 * - Audio espacial (auriculares): los canales izquierdo y derecho como dos
 *   altavoces virtuales delante de ti (HRTF, a ±35°), algo de sonido directo
 *   y una sala suave.
 * - Crossfade (fundido): baja el volumen en los últimos segundos de cada
 *   canción y lo sube al empezar la siguiente. YouTube Music solo tiene un
 *   reproductor, así que las canciones no se solapan.
 *
 * El audio lo da Pear con el evento "peard:audio-can-play" (su fuente y su
 * AudioContext): se desconecta la fuente de la salida y se pasa por aquí.
 */

type AudioDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  vocal: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1],
  treble: [0, 0, 0, 0, 0, 0, 1, 3, 4, 5],
  loudness: [5, 3, 0, -1, -1, 0, 0, 1, 3, 4],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
  electronic: [5, 4, 1, 0, -1, 1, 0, 1, 4, 5],
  rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
} as const;

export type EqPreset = keyof typeof EQ_PRESETS;

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const SPATIAL_CLASS = 'lg-spatial-on';
// Ángulo de cada altavoz virtual respecto al frente
const SPEAKER_ANGLE = (35 * Math.PI) / 180;

const safely = (fn: () => void) => {
  try {
    fn();
  } catch {
    // La conexión ya no existía
  }
};

// Respuesta de una sala pequeña: ruido estéreo que se apaga poco a poco
const roomImpulse = (context: AudioContext, seconds = 1.4, decay = 3.2) => {
  const length = Math.floor(context.sampleRate * seconds);
  const preDelay = Math.floor(context.sampleRate * 0.012);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = preDelay; i < length; i++) {
      const progress = (i - preDelay) / (length - preDelay);
      const noise = Math.random() * 2;
      const envelope = Math.pow(1 - progress, decay);
      data[i] = (noise - 1) * envelope;
    }
  }
  return impulse;
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

type Chain = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  bands: BiquadFilterNode[];
  spatialIn: GainNode;
  spatialOut: AudioNode;
  fade: GainNode;
  limiter: DynamicsCompressorNode;
};

export class AudioEngine {
  private chain: Chain | null = null;
  private spatial = false;
  private preset: EqPreset = 'flat';
  private fadeSeconds = 0;
  private timer: number | null = null;

  private readonly onAudio = (event: Event) => {
    const detail = (event as CustomEvent<AudioDetail>).detail;
    if (!detail?.audioSource || detail.audioSource === this.chain?.source)
      return;
    this.teardown();
    this.chain = this.build(detail.audioContext, detail.audioSource);
    this.applyEq();
    this.applySpatial();
  };

  start() {
    document.addEventListener('peard:audio-can-play', this.onAudio);
    this.timer = window.setInterval(() => this.updateFade(), 100);
  }

  stop() {
    document.removeEventListener('peard:audio-can-play', this.onAudio);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.teardown();
  }

  setSpatial(enabled: boolean) {
    this.spatial = enabled;
    this.applySpatial();
  }

  setEq(preset: string) {
    this.preset = preset in EQ_PRESETS ? (preset as EqPreset) : 'flat';
    this.applyEq();
  }

  setCrossfade(seconds: number) {
    this.fadeSeconds = Math.max(0, seconds);
    if (!this.fadeSeconds) this.setFadeGain(1);
  }

  private build(
    context: AudioContext,
    source: MediaElementAudioSourceNode,
  ): Chain {
    const preamp = context.createGain();
    const bands = BANDS.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type =
        index === 0
          ? 'lowshelf'
          : index === BANDS.length - 1
            ? 'highshelf'
            : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });
    preamp.connect(bands[0]);
    for (let i = 1; i < bands.length; i++) bands[i - 1].connect(bands[i]);

    // Audio espacial
    const spatialIn = context.createGain();
    const spatialOut = context.createGain();
    const direct = context.createGain();
    direct.gain.value = 0.35;
    spatialIn.connect(direct);
    const splitter = context.createChannelSplitter(2);
    const virtual = context.createGain();
    virtual.gain.value = 0.85;
    spatialIn.connect(splitter);
    for (const [channel, side] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const panner = new PannerNode(context, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1,
        positionX: side * Math.sin(SPEAKER_ANGLE),
        positionY: 0,
        positionZ: -Math.cos(SPEAKER_ANGLE),
      });
      splitter.connect(panner, channel);
      panner.connect(virtual);
    }
    const room = context.createConvolver();
    room.buffer = roomImpulse(context);
    const wet = context.createGain();
    wet.gain.value = 0.16;
    spatialIn.connect(room);
    room.connect(wet);
    for (const node of [direct, virtual, wet]) node.connect(spatialOut);

    // Fundido y limitador (casi transparente: solo actúa si algo satura)
    const fade = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    spatialOut.connect(fade);
    fade.connect(limiter);
    limiter.connect(context.destination);

    safely(() => source.disconnect(context.destination));
    source.connect(preamp);
    return {
      context,
      source,
      preamp,
      bands,
      spatialIn,
      spatialOut,
      fade,
      limiter,
    };
  }

  private teardown() {
    const chain = this.chain;
    if (!chain) return;
    safely(() => chain.source.disconnect(chain.preamp));
    safely(() => chain.limiter.disconnect());
    chain.source.connect(chain.context.destination);
    this.chain = null;
    document.body.classList.remove(SPATIAL_CLASS);
  }

  private applyEq() {
    const chain = this.chain;
    if (!chain) return;
    const gains = EQ_PRESETS[this.preset];
    const now = chain.context.currentTime;
    chain.bands.forEach((filter, index) =>
      filter.gain.setTargetAtTime(gains[index] ?? 0, now, 0.05),
    );
    // Margen para las bandas subidas
    const boost = Math.max(0, ...gains);
    chain.preamp.gain.setTargetAtTime(dbToGain(-boost * 0.6), now, 0.05);
  }

  private applySpatial() {
    const chain = this.chain;
    if (!chain) return;
    const last = chain.bands[chain.bands.length - 1];
    safely(() => last.disconnect());
    if (this.spatial) last.connect(chain.spatialIn);
    else last.connect(chain.fade);
    document.body.classList.toggle(SPATIAL_CLASS, this.spatial);
  }

  private setFadeGain(value: number) {
    const chain = this.chain;
    if (!chain) return;
    chain.fade.gain.setTargetAtTime(value, chain.context.currentTime, 0.08);
  }

  // Fundido: sube al empezar y baja al acabar cada canción
  private updateFade() {
    if (!this.fadeSeconds || !this.chain) return;
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video.video-stream',
    );
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0)
      return;
    const fade = this.fadeSeconds;
    // En canciones muy cortas el fundido se acorta
    const length = Math.min(fade, video.duration / 4);
    const elapsed = video.currentTime;
    const remaining = video.duration - video.currentTime;
    const value = Math.max(
      0,
      Math.min(1, elapsed / length, remaining / length),
    );
    this.setFadeGain(value);
  }
}
