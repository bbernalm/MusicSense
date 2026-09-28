/*
 * Fondo "Balatro": pintura en espiral animada y pixelada, como el fondo del
 * juego Balatro (el efecto conocido como "Balatro paint mix").
 *
 * Es un shader WebGL propio que mezcla tres colores tomados de la portada
 * (el más vivo, otro vivo distinto y uno oscuro); al cambiar de canción los
 * colores pasan suavemente a los nuevos.
 *
 * Para no gastar de más se dibuja a baja resolución (el pixelado es parte del
 * estilo), a 30 fotogramas por segundo y se detiene con la ventana oculta.
 */

type Rgb = [number, number, number];

// Colores del juego mientras no hay portada
const DEFAULT_PALETTE: [Rgb, Rgb, Rgb] = [
  [0.871, 0.267, 0.231],
  [0.0, 0.42, 0.706],
  [0.086, 0.137, 0.145],
];

// Resolución interna: una parte del tamaño de la ventana
const SCALE = 0.34;
const FRAME_MS = 1000 / 30;

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec3 colour1;
uniform vec3 colour2;
uniform vec3 colour3;

const float SPIN_ROTATION = -2.0;
const float SPIN_SPEED = 7.0;
const float CONTRAST = 3.5;
const float LIGHTING = 0.4;
const float SPIN_AMOUNT = 0.25;
const float PIXEL_FILTER = 740.0;
const float SPIN_EASE = 1.0;

void main() {
  float pixelSize = length(resolution) / PIXEL_FILTER;
  vec2 uv = (floor(gl_FragCoord.xy / pixelSize) * pixelSize - 0.5 * resolution)
    / length(resolution);
  float uvLength = length(uv);

  // Giro alrededor del centro, más fuerte cerca de él
  float speed = SPIN_ROTATION * SPIN_EASE * 0.2 + 302.2;
  float angle = atan(uv.y, uv.x) + speed
    - SPIN_EASE * 20.0 * (SPIN_AMOUNT * uvLength + (1.0 - SPIN_AMOUNT));
  vec2 mid = (resolution / length(resolution)) / 2.0;
  uv = vec2(uvLength * cos(angle) + mid.x, uvLength * sin(angle) + mid.y) - mid;

  // Pintura: el espacio se deforma varias veces sobre sí mismo
  uv *= 30.0;
  speed = time * SPIN_SPEED * 0.1;
  vec2 uv2 = vec2(uv.x + uv.y);
  for (int i = 0; i < 5; i++) {
    uv2 += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(
      cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121),
      sin(uv2.x - 0.113 * speed)
    );
    uv -= 1.0 * cos(uv.x + uv.y) - 1.0 * sin(uv.x * 0.711 - uv.y);
  }

  // Mezcla de los tres colores con brillo en las crestas
  float contrastMod = 0.25 * CONTRAST + 0.5 * SPIN_AMOUNT + 1.2;
  float paint = min(2.0, max(0.0, length(uv) * 0.035 * contrastMod));
  float c1 = max(0.0, 1.0 - contrastMod * abs(1.0 - paint));
  float c2 = max(0.0, 1.0 - contrastMod * abs(paint));
  float c3 = 1.0 - min(1.0, c1 + c2);
  float light = (LIGHTING - 0.2) * max(c1 * 5.0 - 4.0, 0.0)
    + LIGHTING * max(c2 * 5.0 - 4.0, 0.0);
  vec3 colour = (0.3 / CONTRAST) * colour1
    + (1.0 - 0.3 / CONTRAST) * (colour1 * c1 + colour2 * c2 + colour3 * c3)
    + light;
  gl_FragColor = vec4(colour, 1.0);
}`;

const toRgb = (r: number, g: number, b: number): Rgb => [
  r / 255,
  g / 255,
  b / 255,
];

// Dos colores vivos distintos y uno oscuro de la portada
const paletteFrom = (pixels: Uint8ClampedArray): [Rgb, Rgb, Rgb] | null => {
  type Candidate = { r: number; g: number; b: number; score: number };
  const vivid: Candidate[] = [];
  let dark: Candidate | null = null;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const brightness = max / 255;
    const colourScore = saturation * 0.7;
    const lightScore = brightness * 0.3;
    vivid.push({ r, g, b, score: colourScore + lightScore });
    const saturationBonus = saturation * 0.2;
    const darkScore = 1 - brightness + saturationBonus;
    if (!dark || darkScore > dark.score) dark = { r, g, b, score: darkScore };
  }
  vivid.sort((a, b) => b.score - a.score);
  const first = vivid[0];
  if (!first || !dark) return null;
  const distance = (a: Candidate, b: Candidate) =>
    Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  const second =
    vivid.find((candidate) => distance(candidate, first) > 160) ??
    vivid[Math.floor(vivid.length / 4)];
  // El oscuro nunca negro del todo: se nota la pintura
  const shade = (value: number) => Math.max(18, Math.round(value * 0.45));
  return [
    toRgb(first.r, first.g, first.b),
    toRgb(second.r, second.g, second.b),
    toRgb(shade(dark.r), shade(dark.g), shade(dark.b)),
  ];
};

export class BalatroBackground {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private frame: number | null = null;
  private lastDraw = 0;
  private startedAt = performance.now();
  private current: [Rgb, Rgb, Rgb] = DEFAULT_PALETTE.map(
    (colour) => [...colour] as Rgb,
  ) as [Rgb, Rgb, Rgb];
  private target: [Rgb, Rgb, Rgb] = DEFAULT_PALETTE;
  private artwork = '';

  start(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-balatro';
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    const program = this.compile(gl);
    if (!program) return;
    container.append(canvas);
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.loop();
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas?.remove();
    this.canvas = null;
    this.gl = null;
    this.program = null;
  }

  // Colores de la nueva portada
  setArtwork(url: string) {
    if (!url || url === this.artwork) return;
    this.artwork = url;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (this.artwork !== url) return;
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, size, size);
        const palette = paletteFrom(
          context.getImageData(0, 0, size, size).data,
        );
        if (palette) this.target = palette;
      } catch {
        // Portada sin permiso de lectura: se quedan los colores anteriores
      }
    };
    image.src = url;
  }

  private compile(gl: WebGLRenderingContext) {
    const shader = (type: number, source: string) => {
      const created = gl.createShader(type);
      if (!created) return null;
      gl.shaderSource(created, source);
      gl.compileShader(created);
      if (!gl.getShaderParameter(created, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(created));
        return null;
      }
      return created;
    };
    const vertex = shader(gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    // Un rectángulo que cubre toda la pantalla
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    return program;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (document.hidden || now - this.lastDraw < FRAME_MS) return;
    this.lastDraw = now;
    this.draw(now);
  };

  private draw(now: number) {
    const { gl, program, canvas } = this;
    if (!gl || !program || !canvas) return;

    const width = Math.max(1, Math.round(window.innerWidth * SCALE));
    const height = Math.max(1, Math.round(window.innerHeight * SCALE));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    // Transición suave hacia los colores de la portada
    for (let c = 0; c < 3; c++)
      for (let i = 0; i < 3; i++) {
        const step = (this.target[c][i] - this.current[c][i]) * 0.03;
        this.current[c][i] += step;
      }

    const seconds = (now - this.startedAt) / 1000;
    gl.uniform2f(gl.getUniformLocation(program, 'resolution'), width, height);
    gl.uniform1f(gl.getUniformLocation(program, 'time'), seconds);
    this.current.forEach((colour, index) => {
      gl.uniform3f(
        gl.getUniformLocation(program, `colour${index + 1}`),
        colour[0],
        colour[1],
        colour[2],
      );
    });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
