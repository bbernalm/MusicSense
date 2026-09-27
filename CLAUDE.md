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
| `backend.ts` | Proceso principal: `liquid-glass:get-menu` (menú de la app serializado) y `liquid-glass:menu-click` (pulsa una opción por `commandId`; el click de Electron alterna casillas/radios). Pear reconstruye el menú tras cambios, así que los `commandId` cambian: volver a leerlo siempre |
| `settings.ts` / `settings.css` | Panel de configuración del engranaje: una pestaña por menú de la app; en Plugins buscador + secciones "Activados"/"Disponibles" con interruptor y opciones desplegables (el interruptor es la casilla del complemento o la "Enabled" de su submenú). Casillas → interruptores, radios → lista con ✓, submenús → grupos desplegables, acciones → filas que cierran el panel |
| `player.ts` | Crea `#lg-side-background` (vidrio de la cápsula), el botón "+" (abre "Guardar en una playlist" del menú ⋮ oculto, clase `lg-silent-menu`), el botón de engranaje (`.lg-settings-button`, en `ytmusic-nav-bar .right-content`), el panel vertical de volumen (`.lg-volume-panel`, en `body`, usa `setVolume` de la API), `#lg-np-info` (título y artista bajo la portada), y las clases `lg-np`, `lg-paused`, `lg-side-hover`; calcula `--np-art` |
| `apple-motion.ts` | (Proceso principal) Alternativa de portadas animadas sin tokens: API pública de búsqueda de iTunes (por álbum y por canción) → página pública del álbum en music.apple.com → `"motionDetailSquare"` .m3u8 → variante `avc1` (H.264; `hvc1` no siempre va en Windows) ≤1080 px → su `.mp4` (`#EXT-X-MAP`). No usar el token de la web de Apple ni la API de musichoarders |
| `topbar.ts` / `topbar.css` | Barra superior: cápsulas ‹ › (history.back/forward) y botón de perfil junto al buscador; menú del perfil (cuenta o "Acceder" + ajustes). Opciones del menú ⋮/cuenta de YouTube Music (íconos SETTINGS, PRIVACY_INFO, HELP, FEEDBACK) al final del menú lateral (`.lg-guide-extra` dentro de `#sections`). Los menús de YouTube Music se leen/pulsan ocultos (`lg-silent-menu`); las opciones son `ytd-compact-link-renderer` con `data.icon.iconType`. Oculta Premium (ícono `UNLIMITED`, página `SPunlimited`, `ytmusic-menu-service-item-download-renderer`, promos) |
| `login-window.ts` | (Proceso principal) El inicio de sesión de Google se abre en una ventana emergente modal y oscura (CSS invertido con `insertCSS`, las imágenes se re-invierten) que comparte la sesión de la ventana principal; al volver a music.youtube.com se cierra y la app se recarga. `backend.ts` lo activa con `will-navigate` y, si la ventana principal llega igualmente a accounts.google.com, con `did-navigate` la devuelve a YouTube Music. No usar el navegador externo: la sesión quedaría fuera de la app |
| `visualizer.ts` | Píldora de vidrio con barras sobre la píldora principal (a la derecha, sobre el progreso). Usa el evento `peard:audio-can-play` de Pear (AnalyserNode conectado a su `audioSource`, sin tocar la salida). Color medio de la portada. Opción `visualizer` (activada por defecto). Solo visible con audio sonando |
| `profile.ts` | En tu perfil (`lg-profile-page`): tarjetas Integraciones (interruptores de los complementos Discord y Scrobbler vía el menú de la app) y Estadísticas (tiempo por artista registrado en `localStorage` `lg-stats` cada 5 s de reproducción; YouTube no da estadísticas) |
| `prefer-music.ts` | Opción "Preferir música": pulsa el botón oculto "Canción" de `ytmusic-av-toggle` en videoclips (solo audio) y muestra la miniatura como portada cuadrada (clase `lg-prefer-music`) |
| `animated-art.ts` | Portadas animadas: pide a `https://artwork.boidu.dev/?s=&a=&d=&al=` (servicio de Better Lyrics Shaders; CORS abierto, 60 peticiones/min, el token de prioridad es opcional y no se usa) el `videoUrl` (.mp4 de Apple Music). Caché en `localStorage` (`lg-animated-art:artista|álbum`, "no encontrado" se reintenta a los 3 días). **El `<video>` no se añade a la página** (el núcleo y muchos complementos usan `document.querySelector('video')`): se reproduce suelto y se pinta en un `<canvas class="lg-animated-art">` dentro de `#song-image`. Solo con la pantalla del reproductor abierta; se pausa con la música. Opción de menú `animatedArtwork` |
| `now-playing.css` | Pantalla del reproductor: solo portada cuadrada + título y artista a la izquierda (al pausar, el título se desplaza con la portada encogida para seguir pegado a su borde), panel (letras/cola) a la derecha. La píldora y la cápsula NO cambian aquí (el usuario quiere que sean siempre iguales) |
| `lyrics.ts` / `lyrics.css` | Botón de letras (burbuja) en la cápsula y modo letras: abre la pantalla del reproductor en la pestaña "Letra" y oculta las pestañas. Estilo Apple Music para las letras de *Synced Lyrics* (sobrescribe sus variables `--lyrics-*` en `body`). Selector de fuente oculto (sigue montado porque elige la mejor fuente). Crédito al pie: fuente real + "estilo inspirado en Better Lyrics" |
| `wave.ts` | Barra de progreso ondulada estilo Android dibujada encima del slider nativo `#progress-bar` (el nativo sigue gestionando clics y arrastre) |

Textos del menú en `src/i18n/resources/en.json` y `es.json`, clave `plugins.liquid-glass`.

### Qué hay hecho

- Fondo: portada de la canción actual en alta resolución, muy desenfocada, con fundido entre canciones y movimiento lento (`#liquid-glass-backdrop`).
- Tipografía: SF Pro si está instalada en el PC (su licencia no permite incluirla); si no, Segoe UI Variable.
- Barra superior: vidrio que solo aparece al hacer scroll y se oculta en la pantalla del reproductor. Sin logo de YouTube Music; buscador centrado en la ventana (`.center-content` absoluto a todo el ancho, `.right-content` con `margin-left: auto`); engranaje que abre el menú completo de la app.
- Barra de título de *In-App Menu*: sus hijos ocultos (`visibility: hidden`); la franja se mantiene para arrastrar la ventana (en Windows los botones de ventana son nativos).
- Menú lateral estilo iPad: tarjeta de vidrio flotante (`#guide-renderer`) que termina encima del reproductor; elemento activo en rojo de acento; entra/sale deslizándose con rebote. Cerrado desaparece del todo (sin `#mini-guide`). **No desplaza el contenido**: `--ytmusic-guide-width` vale 0 cerrado y `max(0px, min(204px, 1998px - 100vw))` abierto (solo lo necesario en páginas normales); la pantalla del reproductor nunca se mueve (`[slot=player-page]` con `left: 0`).
- Letras: se usa el complemento *Synced Lyrics* de Pear Desktop (debe estar activado), no el código de Better Lyrics (licencia GPLv3). Su API propia de letras por sílaba exige Cloudflare Turnstile + JWT (solo para su extensión): no usarla. Pendiente: resaltado progresivo por palabra (simulado), traducciones y pantalla completa.
- Portadas animadas estilo Apple Music (primero el servicio de Better Lyrics Shaders; si no, directamente de Apple con `apple-motion.ts`) en la pantalla del reproductor, ver `animated-art.ts`.
- Menú lateral: se anima al cerrarse porque `tp-yt-app-drawer#guide #contentContainer` no se mueve y la ocultación de YouTube Music (`visibility: hidden`) se retrasa con una transición. Tiene refracción (`#guide-renderer` en `refraction.ts`, que mide con `offsetWidth` para ignorar escalas).
- Cápsula: el efecto al pasar el ratón es un brillo interior (`.right-controls::before`); NO mover ni escalar elementos con refracción (va a pocos FPS). Panel de volumen en forma de píldora con refracción.
- Pestañas del panel lateral: se ocultan "Letra" (la usa el botón de letras) y "Comentarios".
- Panel de ajustes: 1.ª pestaña "MusicSense" con las opciones de Liquid Glass (incluye "Preferir música"), luego Plugins, Options, etc. Se abre desde el menú del perfil.
- No hay complemento bloqueador de anuncios en esta versión de Pear (solo SponsorBlock). No todas las canciones tienen (p. ej. SZA "Snooze" sí; Dua Lipa "Training Season" no). La portada además se encoge con rebote al pausar (`lg-paused`).
- Para saber si la música está en pausa usar siempre `#movie_player video.video-stream`, nunca el primer `video` de la página.
- `.background-gradient` envuelve todo el contenido de las páginas: nunca ocultarlo (antes el inicio salía vacío por eso).
- Píldora y cápsula, **iguales en toda la app** (también en la pantalla del reproductor): píldora (66 px) con portada redonda que gira como disco (se detiene con `lg-paused`), título/artista, ♡ (el "Me gusta" con máscara de corazón) y +; luego los controles y a la derecha la onda de progreso (`--lg-progress-width`). Cápsula (232 px): altavoz (al pasar el ratón despliega el panel vertical de volumen), letras, repetir, aleatorio, abrir reproductor; entra con rebote y se eleva al pasar el ratón. Sin "No me gusta" ni menú ⋮ ni tiempo. Grupo centrado (máx. 1120 px). El mini reproductor cuadrado se oculta con `opacity: 0`.
- La pista gris de la barra empieza donde acaba la onda (gradiente con `--lg-progress`, que `wave.ts` pone también en el slider).
- La etiqueta de tiempo al pasar el ratón (`#hover-time-info`) la recalcula `wave.ts`, porque YouTube Music la calcula como si la barra empezara en el borde de la ventana.
- Panel lateral de la pantalla del reproductor: sin caja (sin fondo, borde, sombra ni brillo), bordes superior/inferior desvanecidos con máscara y `margin-bottom` para separarlo de la cápsula. El usuario lo prefirió integrado en el fondo.
- Portada redonda de la píldora: sin círculo central (el usuario lo pidió quitar).
- Buscador: píldora de vidrio; sugerencias en un panel aparte con fondo más opaco (dentro de la barra superior el `backdrop-filter` no se aplica).
- Borde de luz especular (degradado diagonal con máscara) en reproductor, buscador, sugerencias y panel "A continuación".
- Menús emergentes, chips, pestañas y filas con estilo de vidrio.

- **Cambios de la ronda 27/09/2026** (ver commits): `ytmusic-app` sin `z-index` (los diálogos quedaban bajo su fondo oscuro; el fondo animado va con `z-index: -1`, `body` transparente y `html` negro). Buscador abierto con `position: relative` (si no, tapa los botones) y sin la lista de sugerencias vacía. Barra superior de vidrio desde `top: 0` con borde desvanecido; `clip-path` redondo en `.search-box` (la refracción ignora el radio). Sin `.top-row-buttons` (maximizar/pantalla completa) ni recuadro de foco en la portada. Avisos (`tp-yt-paper-toast`) y diálogos (`tp-yt-paper-dialog`, `ytmusic-dialog`) de vidrio. Estados de la píldora `lg-idle` (sin `player-visible`: "No hay nada sonando") y `lg-bar-loading` (disco + "Cargando..."). Tiempos a los lados de la barra (`.lg-time-*` en `wave.ts`). Título/artista bajo la portada pulsables + botón compartir (menú ⋮ oculto, icono `SHARE`).
- Grupo del reproductor: píldora + cápsula (150 px: volumen, letras) + círculo aparte (`#lg-expand-background`, 66 px) con el botón de abrir/cerrar. Aleatorio y repetir se mueven dentro de `.left-controls-buttons` (antes de "anterior" / después de "siguiente").
- Pantalla del reproductor: columnas alineadas con el grupo (`padding` = `--lg-bar-left`), pestañas "A continuación/Similares" como cápsula segmentada a la altura de la portada (`--np-side-offset`), "Reproduciendo desde" en cápsula, sin chips de filtros ni barra de scroll.
- Barra superior: [inicio][biblioteca] | [‹][›] [buscador] [historial][perfil]. Navegación con `ytmusic-app.navigate(browseId)` (`FEmusic_home`, `FEmusic_library_landing`, `FEmusic_history`). Menú del perfil: nombre de la cuenta, "Tu perfil", cambiar de cuenta, "Cerrar sesión". Tu perfil se detecta por `/channel/<id>` o `/@usuario`; allí aparece la cápsula Perfil / Complementos / YouTube. Los ajustes de YouTube ocultan por `categoryId` Descargas, Configuración del canal, Recomendaciones y Acerca de.
- Menú lateral: sin Configuración/Condiciones/Ayuda/Comentarios; las playlists ocupan el espacio y "Nueva playlist" va abajo; Biblioteca con icono de libros (`.lg-library-entry`).
- Los módulos de la píldora arrancan en `start()`, no en `onPlayerApiReady` (sin canción cargada YouTube Music tarda en crear el reproductor).

- **Ronda 2 del 27/09/2026:**
  - Portadas animadas por álbum exacto (`mode: 'album'`) o sencillo (`mode: 'single'`: sencillos, y videoclips con "Preferir música", título limpio de "(Official Video)"). Lo del servicio de Better Lyrics se valida con `liquid-glass:check-collection` (iTunes lookup del `albumId` ≠ nombre buscado → se descarta). Caché `lg-animated-art2:`.
  - Liquid Glass siempre activo: `ALWAYS_ENABLED` en `src/config/plugins.ts` (fuerza `enabled` en `getPlugins`/`isEnabled`, ignora `disable`) y `src/menu.ts` muestra solo sus opciones. `pluginToggle` de settings.ts/profile.ts solo reconoce "Enabled" si va seguida de separador.
  - Visualizador apagado por defecto. Ventana mínima 1100×680 (`setMinimumSize` en backend.ts).
  - Menú lateral: `#guide-wrapper` z-index 6 y `#nav-bar-background` sin clics (tapaba "Principal"); portadas de playlists pedidas con `ytmusic-app.networkManager.fetch('/browse', {browseId: 'FEmusic_liked_playlists'})` (clase `lg-playlist-entry`, `img.lg-guide-thumb`).
  - Panel derecho: `.lg-queue-top` (arriba del `#side-panel`) con la cabecera "Reproduciendo desde" movida allí y un botón ∞ que pulsa `#automix` (fila `.autoplay` oculta).
  - Píldora y cápsula con `border-radius: 999px`.
  - Perfil: `#header` oculto; tarjeta central `.lg-identity` (foto, nombre, suscriptores, "Compartir perfil" = último botón de la cabecera) entre Integraciones y Estadísticas, todo dentro de `#content-wrapper` (se mueve con el menú lateral). Cápsula de pestañas `position: fixed`, z-index 2100, bajo el buscador (`--lg-tabs-top/left`).
  - Icono nuevo: `assets/icon.svg` (vector). `pnpm exec electron scripts/generate-icons.mjs` regenera `assets/icon.png`, `assets/generated/icons/png/*`, `win/icon.ico` y el SVG de mac. El icono se muestra arriba a la izquierda (`.lg-app-icon`, importado con `@assets/icon.svg?raw`). Faltaría regenerar `tray*.png` si se quiere el icono nuevo en la bandeja.

### Pendiente o por verificar

- Ideas pendientes: "Audio espacial" (requiere meter un nodo de efectos en la cadena de audio de Pear, afecta a otros complementos), probar que los avisos en cápsula se ven bien al dar "Me gusta", más estadísticas.

- Falta que el usuario confirme el nuevo lente (más fuerte) en la app real, con contenido colorido detrás.
- La referencia de vidrio del usuario es la barra de pestañas de iOS 26: tinte oscuro, fondo visible, lente ancho en los bordes con irisado. Una versión muy antigua se veía con "bordes raros llenos de colores"; si vuelve a pasar, bajar `scale` en `refraction.ts`.
- Con sesión iniciada, comprobar que "+" abre el diálogo de playlists (sin sesión muestra el aviso de acceso anclado arriba a la izquierda).
- Los textos del menú de la app (Plugins, Options, nombres y descripciones de complementos) salen en el idioma de la app; los nuestros tienen traducción en `es.json`/`en.json`.
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
