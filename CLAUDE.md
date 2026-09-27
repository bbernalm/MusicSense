# CLAUDE.md

Responde siempre en español. El usuario no es programador experto: explica en lenguaje sencillo y confirma los resultados con capturas o ejecutando la app.

## Proyecto

**MusicSense**: fork privado de **Pear Desktop** (antes `th-ch/youtube-music`): cliente de escritorio de YouTube Music hecho con Electron + TypeScript, con sistema de complementos. El objetivo del usuario es un cliente de PC con estética de **Apple Music / BitChord** ("liquid glass").

- Node >= 22, pnpm >= 11. Instalar: `pnpm install --frozen-lockfile`
- Desarrollo con recarga: `pnpm dev` (los complementos nuevos solo se detectan al reiniciar)
- Comprobaciones: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (el formateador es `oxfmt`, el linter `oxlint`; pueden chocar, ver "Estilo de código")
- Generar instalador de Windows: `pnpm dist:win`

## Git

- `origin`: repositorio privado del usuario (MusicSense). `upstream`: Pear Desktop original, solo para `git fetch` (la subida está bloqueada con `no_push`).
- Rama principal: `main` (= `master` de Pear Desktop + cambios propios). Trabajos grandes en ramas `feat/...` y luego se fusionan a `main`.
- Traer novedades del original: `git fetch upstream` y `git merge upstream/master` en `main`.
- **No añadir líneas `Co-Authored-By` ni menciones a Claude en los commits.** El autor configurado en este repositorio es el usuario de GitHub con su correo `noreply`; no cambiarlo ni escribir datos personales del usuario (nombre real, correo) en archivos o commits.

## Complemento propio: `src/plugins/liquid-glass/`

Se activa en el menú **Plugins → Liquid Glass**. Conviene desactivar *Album Color Theme*, *Transparent Player* y *Blur Navigation Bar*, que chocan con él.

| Archivo | Qué hace |
| --- | --- |
| `index.ts` | Definición del complemento, menú (fondo animado, aberración cromática, nivel de desenfoque 15/30/50), fondo con la portada y arranque de los demás módulos |
| `style.css` | Todo el diseño: variables `--lg-*`, fondos transparentes, vidrio, tipografía, buscador, reproductor, onda, borde de luz |
| `refraction.ts` | Refracción con aberración cromática (lente ancho estilo iOS 26): genera un mapa de desplazamiento por panel (canvas) y lo aplica con `backdrop-filter: url(#filtro SVG)` (solo Chromium). En `#player-bar-background`, `#lg-side-background` y `ytmusic-search-box .search-box` |
| `player.ts` | Crea `#lg-side-background` (vidrio de la cápsula), el botón "+" (abre "Guardar en una playlist" del menú ⋮ oculto, clase `lg-silent-menu`), marca `lg-np` (pantalla del reproductor abierta) y `lg-paused`, y mide portada/panel para las variables `--np-*` y `--np-art` |
| `now-playing.css` | Pantalla del reproductor según el boceto del usuario: portada cuadrada grande a la izquierda con título, ♡, +, progreso, controles y volumen debajo; panel (letras/cola) a la derecha y la cápsula bajo él. La barra ocupa toda la ventana con `pointer-events: none` y cada grupo se posiciona con `--np-*` |
| `lyrics.ts` / `lyrics.css` | Botón de letras (burbuja) en la cápsula y modo letras: abre la pantalla del reproductor en la pestaña "Letra" y oculta las pestañas. Estilo Apple Music para las letras de *Synced Lyrics* (sobrescribe sus variables `--lyrics-*` en `body`). Selector de fuente oculto (sigue montado porque elige la mejor fuente). Crédito al pie: fuente real + "estilo inspirado en Better Lyrics" |
| `wave.ts` | Barra de progreso ondulada estilo Android dibujada encima del slider nativo `#progress-bar` (el nativo sigue gestionando clics y arrastre) |

Textos del menú en `src/i18n/resources/en.json` y `es.json`, clave `plugins.liquid-glass`.

### Qué hay hecho

- Fondo: portada de la canción actual en alta resolución, muy desenfocada, con fundido entre canciones y movimiento lento (`#liquid-glass-backdrop`).
- Tipografía: SF Pro si está instalada en el PC (su licencia no permite incluirla); si no, Segoe UI Variable.
- Barra superior: vidrio que solo aparece al hacer scroll y se oculta en la pantalla del reproductor.
- Menú lateral estilo iPad: tarjeta de vidrio flotante (`#guide-renderer`) que termina encima del reproductor; elemento activo en rojo de acento; al cerrarlo con el botón superior (ícono de barra lateral) desaparece del todo (sin la columna de íconos `#mini-guide`).
- Letras: se usa el complemento *Synced Lyrics* de Pear Desktop (debe estar activado), no el código de Better Lyrics (licencia GPLv3). Su API propia de letras por sílaba exige Cloudflare Turnstile + JWT (solo para su extensión): no usarla. Pendiente: resaltado progresivo por palabra (simulado), traducciones y pantalla completa.
- "Portada animada" de Better Lyrics = fondo con la portada desenfocada en movimiento (ya existe). Aquí además la portada se encoge con rebote al pausar (`lg-paused`).
- `.background-gradient` envuelve todo el contenido de las páginas: nunca ocultarlo (antes el inicio salía vacío por eso).
- Reproductor cerrado (4.ª imagen del usuario): píldora (66 px) con portada redonda, título/artista, ♡ (el "Me gusta" con máscara de corazón) y +; a la derecha (`--lg-controls-width`) la onda de progreso con los controles debajo. Cápsula (`.right-controls`): volumen siempre visible, silenciar, letras, repetir, aleatorio, abrir reproductor. Sin "No me gusta" ni menú ⋮ ni tiempo. Grupo centrado (máx. 1120 px). El mini reproductor cuadrado se oculta con `opacity: 0`.
- La pista gris de la barra empieza donde acaba la onda (gradiente con `--lg-progress`, que `wave.ts` pone también en el slider).
- La etiqueta de tiempo al pasar el ratón (`#hover-time-info`) la recalcula `wave.ts`, porque YouTube Music la calcula como si la barra empezara en el borde de la ventana.
- Buscador: píldora de vidrio; sugerencias en un panel aparte con fondo más opaco (dentro de la barra superior el `backdrop-filter` no se aplica).
- Borde de luz especular (degradado diagonal con máscara) en reproductor, buscador, sugerencias y panel "A continuación".
- Menús emergentes, chips, pestañas y filas con estilo de vidrio.

### Pendiente o por verificar

- Falta que el usuario confirme el nuevo lente (más fuerte) en la app real, con contenido colorido detrás.
- La referencia de vidrio del usuario es la barra de pestañas de iOS 26: tinte oscuro, fondo visible, lente ancho en los bordes con irisado. Una versión muy antigua se veía con "bordes raros llenos de colores"; si vuelve a pasar, bajar `scale` en `refraction.ts`.
- Con sesión iniciada, comprobar que "+" abre el diálogo de playlists (sin sesión muestra el aviso de acceso anclado arriba a la izquierda).
- Ideas propuestas y no hechas: pantalla completa con letras sincronizadas, crossfade o Automix entre canciones, colores de acento tomados de la portada.

## Notas técnicas

- Estructura de YouTube Music verificada:
  - `ytmusic-player-bar` es `position: fixed` con `display: grid`. Actúa como contenedor incluso de sus hijos `position: fixed`, así que la cápsula se coloca con `position: absolute` respecto a la barra. Además (por `view-transition-name`) aísla el `backdrop-filter` de sus hijos: los fondos de vidrio deben ser elementos hermanos (`#player-bar-background`, `#lg-side-background`).
  - Pantalla del reproductor: portada en `ytmusic-player-page #player > #song-image`; YouTube Music calcula su tamaño con `#main-panel` (padding lateral propio), por eso el tamaño cuadrado se fija con `--np-art`. Pestañas: `#tabsContent > .tab-header` (2.ª = Letra).
  - Menú ⋮ de la barra: `ytmusic-menu-renderer #button-shape button`; los elementos del menú tienen `data.icon.iconType` (`ADD_TO_PLAYLIST`, etc.).
  - Para inspeccionar la app en vivo: `pnpm exec electron-vite dev --watch --remoteDebuggingPort 9333` y conectarse por el protocolo de DevTools (`http://127.0.0.1:9333/json`).
  - `#progress-bar` (`tp-yt-paper-slider`) viene con `left: -16px`, `transform: translateY(-16px)` y `#sliderContainer` con `margin: 0 16px`. Por eso se reposiciona entero.
  - `#play-pause-button` mide 52 px y los demás botones 36 px. No fuerces tamaños por botón: descuadra los íconos.
  - El buscador (`ytmusic-search-box`) dibuja un borde propio al abrirse. Estructura: `.search-container > .search-box` y `#suggestion-list` con `ytmusic-search-suggestions-section`. Todo ello trae fondos `#030303`.
- Los selectores de YouTube Music cambian con frecuencia: inspecciona el DOM real (por ejemplo abriendo music.youtube.com) antes de escribir CSS nuevo.
- La configuración guardada del usuario se combina con los valores por defecto (`deepmerge`), así que añadir opciones nuevas es seguro.

## Estilo de código

- `oxlint` exige paréntesis cuando se mezclan `*` y `+`, pero `oxfmt` los quita. Usa variables intermedias en su lugar.
- No mezcles claves con y sin comillas en un mismo objeto (`quote-props`). Los atributos con guion ponlos con `setAttribute` aparte.
- Comentarios del código en español, como en el resto del complemento.
