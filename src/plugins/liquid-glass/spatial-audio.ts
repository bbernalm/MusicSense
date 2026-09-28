/*
 * Audio espacial (pensado para auriculares).
 *
 * Un virtualizador como los de los auriculares "3D": los canales izquierdo y
 * derecho se colocan como dos altavoces virtuales delante de ti (HRTF, a ±35°)
 * con un poco de sonido directo para no perder graves ni claridad, y una
 * sala suave (reverberación generada). Al final un limitador evita que
 * sature.
 *
 * El audio lo da Pear con el evento "peard:audio-can-play" (su fuente y su
 * AudioContext); se desconecta la fuente de la salida y se pasa por esta
 * cadena. Al desactivarlo se vuelve a conectar directa.
 */

type AudioDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};

const ACTIVE_CLASS = 'lg-spatial-on';

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

export class SpatialAudio {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private input: GainNode | null = null;
  private output: AudioNode | null = null;
  private enabled = false;
  private connected = false;

  private readonly onAudio = (event: Event) => {
    const detail = (event as CustomEvent<AudioDetail>).detail;
    if (!detail?.audioSource || detail.audioSource === this.source) return;
    this.disconnect();
    this.input = null;
    this.output = null;
    this.context = detail.audioContext;
    this.source = detail.audioSource;
    if (this.enabled) this.connect();
  };

  start() {
    document.addEventListener('peard:audio-can-play', this.onAudio);
  }

  stop() {
    document.removeEventListener('peard:audio-can-play', this.onAudio);
    this.disconnect();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.connect();
    else this.disconnect();
  }

  private build(context: AudioContext) {
    const input = context.createGain();

    // Sonido directo: conserva graves y claridad
    const direct = context.createGain();
    direct.gain.value = 0.35;
    input.connect(direct);

    // Altavoces virtuales: cada canal por su lado con HRTF
    const splitter = context.createChannelSplitter(2);
    const virtual = context.createGain();
    virtual.gain.value = 0.85;
    input.connect(splitter);
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

    // Sala suave
    const room = context.createConvolver();
    room.buffer = roomImpulse(context);
    const wet = context.createGain();
    wet.gain.value = 0.16;
    input.connect(room);
    room.connect(wet);

    // Limitador para que la suma no sature
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    for (const node of [direct, virtual, wet]) node.connect(limiter);

    this.input = input;
    this.output = limiter;
  }

  private connect() {
    const { context, source } = this;
    if (!context || !source || this.connected) return;
    if (!this.input) this.build(context);
    if (!this.input || !this.output) return;
    safely(() => source.disconnect(context.destination));
    source.connect(this.input);
    this.output.connect(context.destination);
    this.connected = true;
    // Marca para saber (y comprobar) que la cadena está conectada
    document.body.classList.add(ACTIVE_CLASS);
  }

  private disconnect() {
    const { context, source } = this;
    if (!context || !source || !this.connected) return;
    const input = this.input;
    if (input) safely(() => source.disconnect(input));
    safely(() => this.output?.disconnect());
    source.connect(context.destination);
    this.connected = false;
    document.body.classList.remove(ACTIVE_CLASS);
  }
}
