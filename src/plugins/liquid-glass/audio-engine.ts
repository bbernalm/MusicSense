/*
 * Motor de audio de MusicSense: una sola cadena para que las opciones no se
 * pisen entre sí.
 *
 *   fuente → ecualizador (10 bandas) → [estéreo amplio] → [audio espacial]
 *          → [sala] → fundido → limitador
 *
 * - Ecualizador: ajustes predefinidos (Plano, Graves, Voz, Agudos...). Se
 *   baja un poco el volumen de entrada cuanto más se suben las bandas, y el
 *   limitador evita que sature.
 * - Estéreo amplio: separa más los dos canales (medio/lados) y mezcla en
 *   cada oído un poco del otro, retrasado y apagado, como un oído lejano.
 * - Audio espacial (auriculares): los canales izquierdo y derecho como dos
 *   altavoces virtuales delante de ti (HRTF, a ±35°), algo de sonido directo
 *   y una sala suave (se apaga si eliges una sala aparte).
 * - Sala: reverberación por convolución con la respuesta de un estudio, una
 *   sala o un auditorio (reflejos tempranos + cola que pierde agudos).
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

// Estéreo amplio: cuánto se abren los lados (1 = sin cambios), el oído
// contrario (retraso, filtro y volumen) y la bajada para no saturar
const WIDTH = 2.2;
const CROSSFEED_DELAY = 0.015;
const CROSSFEED_CUTOFF = 2500;
const CROSSFEED_GAIN = 0.2;
const WIDTH_OUTPUT = 0.82;

// Salas: duración de la cola, reflejos tempranos (s), cuánto se oye y
// frecuencia a la que se apagan los agudos al final de la cola
export const ROOMS = {
  off: null,
  studio: { seconds: 0.6, early: 0.02, wet: 0.16, damping: 3500 },
  room: { seconds: 1.3, early: 0.035, wet: 0.24, damping: 2500 },
  hall: { seconds: 2.8, early: 0.06, wet: 0.3, damping: 1800 },
} as const;

export type Room = keyof typeof ROOMS;
type RoomShape = NonNullable<(typeof ROOMS)[Room]>;

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

// Respuesta de una sala de verdad (aproximada): unos reflejos sueltos al
// principio, distintos en cada oído, y luego una cola de ruido que se apaga
// y pierde agudos con el tiempo. Se normaliza para que todas las salas se
// oigan a un volumen parecido.
const hallImpulse = (context: AudioContext, shape: RoomShape) => {
  const rate = context.sampleRate;
  const length = Math.floor(rate * shape.seconds);
  const tailStart = Math.floor(rate * shape.early);
  const impulse = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    // Reflejos tempranos: paredes cercanas, cada vez más débiles
    for (let tap = 0; tap < 8; tap++) {
      const spread = Math.random() * 0.75;
      const at = Math.floor(tailStart * (0.25 + spread));
      const sign = Math.random() < 0.5 ? -1 : 1;
      const weaker = tap * 0.09;
      data[at] += sign * (0.9 - weaker);
    }
    // Cola difusa con filtro paso bajo que se va cerrando
    let smooth = 0;
    for (let i = tailStart; i < length; i++) {
      const progress = (i - tailStart) / (length - tailStart);
      const closed = (12000 - shape.damping) * progress;
      const cutoff = 12000 - closed;
      const angle = 2 * Math.PI * cutoff;
      const coefficient = 1 - Math.exp(-angle / rate);
      const random = Math.random() * 2;
      const noise = random - 1;
      smooth += coefficient * (noise - smooth);
      const envelope = Math.pow(1 - progress, 2.5);
      data[i] = smooth * envelope;
    }
  }
  let energy = 0;
  for (let channel = 0; channel < 2; channel++)
    for (const value of impulse.getChannelData(channel))
      energy += value * value;
  const scale = 1 / Math.sqrt(energy / 2 || 1);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return impulse;
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

type Stage = { input: AudioNode; output: AudioNode };

type Chain = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  bands: BiquadFilterNode[];
  width: Stage;
  spatial: Stage;
  spatialRoom: GainNode;
  room: Stage;
  roomConvolver: ConvolverNode;
  roomWet: GainNode;
  fade: GainNode;
  limiter: DynamicsCompressorNode;
};

// Estéreo amplio: medio = (I + D) / 2, lados = (I − D) / 2 × WIDTH.
// Izquierdo = medio + lados y derecho = medio − lados, escrito como mezcla
// directa de cada canal (same = propio, other = contrario).
const buildWidth = (context: AudioContext): Stage => {
  const input = context.createGain();
  const output = context.createGain();
  output.gain.value = WIDTH_OUTPUT;
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  input.connect(splitter);
  const same = (1 + WIDTH) / 2;
  const other = (1 - WIDTH) / 2;
  for (const [from, to] of [
    [0, 1],
    [1, 0],
  ] as const) {
    const own = context.createGain();
    own.gain.value = same;
    splitter.connect(own, from);
    own.connect(merger, 0, from);
    const opposite = context.createGain();
    opposite.gain.value = other;
    splitter.connect(opposite, from);
    opposite.connect(merger, 0, to);
    // Oído contrario: retrasado, sin agudos y bajito
    const delay = context.createDelay(0.05);
    delay.delayTime.value = CROSSFEED_DELAY;
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = CROSSFEED_CUTOFF;
    const feed = context.createGain();
    feed.gain.value = CROSSFEED_GAIN;
    splitter.connect(delay, from);
    delay.connect(lowpass);
    lowpass.connect(feed);
    feed.connect(merger, 0, to);
  }
  merger.connect(output);
  return { input, output };
};

export class AudioEngine {
  private chain: Chain | null = null;
  private spatial = false;
  private wide = false;
  private room: Room = 'off';
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
    this.applyRoom();
    this.route();
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
    if (this.spatial === enabled) return;
    this.spatial = enabled;
    this.route();
  }

  setWidth(enabled: boolean) {
    if (this.wide === enabled) return;
    this.wide = enabled;
    this.route();
  }

  setRoom(room: string) {
    const next = room in ROOMS ? (room as Room) : 'off';
    if (this.room === next) return;
    this.room = next;
    this.applyRoom();
    this.route();
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
    const spatialConvolver = context.createConvolver();
    spatialConvolver.buffer = roomImpulse(context);
    const spatialRoom = context.createGain();
    spatialRoom.gain.value = 0.16;
    spatialIn.connect(spatialConvolver);
    spatialConvolver.connect(spatialRoom);
    for (const node of [direct, virtual, spatialRoom]) node.connect(spatialOut);

    // Sala: sonido seco + reverberación (el búfer lo pone applyRoom)
    const roomIn = context.createGain();
    const roomOut = context.createGain();
    const roomConvolver = context.createConvolver();
    const roomWet = context.createGain();
    roomIn.connect(roomOut);
    roomIn.connect(roomConvolver);
    roomConvolver.connect(roomWet);
    roomWet.connect(roomOut);

    // Fundido y limitador (casi transparente: solo actúa si algo satura)
    const fade = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    fade.connect(limiter);
    limiter.connect(context.destination);

    safely(() => source.disconnect(context.destination));
    source.connect(preamp);
    return {
      context,
      source,
      preamp,
      bands,
      width: buildWidth(context),
      spatial: { input: spatialIn, output: spatialOut },
      spatialRoom,
      room: { input: roomIn, output: roomOut },
      roomConvolver,
      roomWet,
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

  // Une el ecualizador con el fundido pasando solo por las etapas activas
  private route() {
    const chain = this.chain;
    if (!chain) return;
    const stages = [
      [this.wide, chain.width],
      [this.spatial, chain.spatial],
      [this.room !== 'off', chain.room],
    ] as const;
    const last = chain.bands[chain.bands.length - 1];
    safely(() => last.disconnect());
    for (const [, stage] of stages) safely(() => stage.output.disconnect());
    let tail: AudioNode = last;
    for (const [enabled, stage] of stages) {
      if (!enabled) continue;
      tail.connect(stage.input);
      tail = stage.output;
    }
    tail.connect(chain.fade);
    // La sala propia del audio espacial se aparta si hay una sala elegida
    chain.spatialRoom.gain.value = this.room === 'off' ? 0.16 : 0;
    document.body.classList.toggle(SPATIAL_CLASS, this.spatial);
  }

  private applyRoom() {
    const chain = this.chain;
    if (!chain) return;
    const shape = ROOMS[this.room];
    if (!shape) return;
    chain.roomConvolver.buffer = hallImpulse(chain.context, shape);
    chain.roomWet.gain.value = shape.wet;
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
