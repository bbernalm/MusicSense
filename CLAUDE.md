# CLAUDE.md

Responde siempre en español. El usuario no es programador experto: explica en lenguaje sencillo y confirma los resultados con capturas o ejecutando la app. Suele mandar varias peticiones a la vez con capturas numeradas: trabaja por bloques y haz un commit por bloque.

## Proyecto

**MusicSense**: fork privado de **Pear Desktop** (antes `th-ch/youtube-music`): cliente de escritorio de YouTube Music hecho con Electron + TypeScript, con sistema de complementos. El objetivo es un cliente de PC con estética de **Apple Music / iOS 26** ("liquid glass"). Todo el diseño propio está en el complemento `src/plugins/liquid-glass/`.

- Node >= 22, pnpm >= 11. Instalar: `pnpm install --frozen-lockfile`
- Desarrollo con recarga: `pnpm dev`. Las DevTools ya no se abren solas (`PEAR_DEVTOOLS=1 pnpm dev` para abrirlas).
- Comprobaciones: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (formateador `oxfmt`, linter `oxlint`; ver "Estilo de código").
- Instalador de Windows: `pnpm dist:win`. Iconos: `pnpm exec electron scripts/generate-icons.mjs` (desde `assets/icon.svg`).

## Git

- `origin`: repositorio privado del usuario (`bbernalm/MusicSense`). `upstream`: Pear Desktop original, solo para `git fetch` (subida bloqueada con `no_push`).
- Rama principal: `main`. Trabajos grandes en ramas `feat/...` y luego se fusionan a `main`; sube con `git push origin main`.
- Traer novedades del original: `git fetch upstream` y `git merge upstream/master` en `main`.
- **No añadir líneas `Co-Authored-By` ni menciones a Claude en los commits.** El autor configurado es el usuario de GitHub con su correo `noreply`; no cambiarlo ni escribir datos personales (nombre real, correo) en archivos o commits.

## Cómo probar los cambios en la app real

1. La app solo admite **una instancia**. Si el usuario la tiene abierta, pregúntale antes de cerrarla (`Get-Process electron | Stop-Process -Force`).
2. Ábrela con depuración: `pnpm exec electron-vite dev --watch --remoteDebuggingPort 9333` (en segundo plano). Tarda ~40 s.
3. Inspecciona y prueba con `node scripts/dev-cdp.mjs` (evaluar JS, capturas, clics reales; ver cabecera del script). Las capturas se leen con la herramienta de lectura de imágenes.
   - Las coordenadas de `--click` son de la página (CSS); `--shot` con recorte usa píxeles de pantalla (× zoom).
   - Con la ventana tapada Windows frena las animaciones: menús y popups no se colocan hasta forzar fotogramas (hacer un par de `--shot`). Comprueba con `elementFromPoint` qué hay bajo el puntero antes de cada clic.
   - Los menús de YouTube solo responden bien a clics reales; y mucho cuidado con las filas de las listas: al lado del ⋮ están "Me gusta" y "Comenzar mix".
4. Los cambios de CSS y del renderer recargan solos (~15 s). Los del **proceso principal** (`backend.ts`, `login-window.ts`, `apple-motion.ts`, `src/index.ts`, `src/config/*`, `src/menu.ts`) y los **textos nuevos de es/en.json** reinician la app: espera ~30 s.
5. Al recargar, la app vuelve a la última canción (pantalla del reproductor abierta).
6. El usuario tiene sesión iniciada (su cuenta). No pulses nada que cambie su cuenta: dar "Me gusta", guardar en playlists, cambiar de cuenta o cerrar sesión.

## Complemento `src/plugins/liquid-glass/` (siempre activo)

No se puede desactivar: `ALWAYS_ENABLED` en `src/config/plugins.ts` lo fuerza en `getPlugins`/`isEnabled` e ignora `disable`; `src/menu.ts` solo muestra sus opciones. Al revés, `DISCARDED` (mismo archivo) fuerza desactivados y oculta en `src/menu.ts` los complementos de Pear que chocan con el diseño o lo repiten (navigation, blur-nav-bar, album-color-theme, ambient-mode, transparent-player, visualizer, video-toggle, precise-volume, exponential-volume, clock, picture-in-picture, album-actions, music-together, touchbar). Ecualizador, compresor, dispositivo de audio y crossfade de Pear siguen disponibles pero chocan con `audio-engine.ts` (usar los nuestros). Textos en `src/i18n/resources/es.json` y `en.json`, clave `plugins.liquid-glass`.

| Archivo | Qué hace |
| --- | --- |
| `index.ts` | Definición, opciones (preferir música, visualizador, traducir letras, ecualizador `eqPreset`, fundido `crossfade`, audio espacial, estilo del fondo `background` liquid/artwork, fondo animado, aberración, portadas animadas, efecto del vidrio `blur` 50=Suave/30/15=Intenso por defecto), fondo con la portada (`#liquid-glass-backdrop`, `z-index: -1`), acento de color desde la portada (`updateAccent` → `--lg-accent` en `body`) y arranque de los módulos. La mayoría arranca en `start()`; solo lo que necesita la API del reproductor va en `onPlayerApiReady` |
| `backend.ts` | Proceso principal. IPC: `get-menu` / `menu-click` (menú de la app para el panel de ajustes; los `commandId` cambian, releer siempre), `apple-motion`, `check-collection`, `search-lyrics` (abre Google en el navegador), `min-size`. Ventana mínima 1200×740. **Escalado**: `setZoomFactor` según el tamaño (referencia 1700×940, zoom 0,8–1,5) + `setTitleBarOverlay`. Intercepta el inicio de sesión de Google (`login-window.ts`) |
| `login-window.ts` | Inicio de sesión en ventana emergente modal y oscura que comparte la sesión; al volver a music.youtube.com se cierra y recarga la app |
| `style.css` | Diseño general: variables `--lg-*`, vidrio, tipografía, barra superior, buscador, menú lateral, píldora y cápsula, onda de progreso, avisos y diálogos de vidrio |
| `topbar.ts` / `topbar.css` | Barra superior `[inicio][explorar][biblioteca] | [‹][›] [buscador] [historial][ajustes ⚙][perfil]`, logo + "MusicSense" arriba a la izquierda, menú del perfil (nombre, Tu perfil, Cambiar de cuenta, Cerrar sesión; sin sesión: Acceder y Ajustes), página de tu perfil (cápsula Perfil/Complementos/YouTube; ajustes de YouTube filtrados por `categoryId`), portadas de playlists en el menú lateral, ocultación de Premium, cierre del menú de cuenta de YouTube si reaparece |
| `profile.ts` | Tarjetas de tu perfil: Integraciones (Discord, Scrobbler), identidad (foto, nombre, Compartir perfil) y Estadísticas locales (`localStorage` `lg-stats`, cada 5 s de reproducción) |
| `settings.ts` / `settings.css` | Panel de ajustes centrado con interruptores: pestañas MusicSense (nuestras opciones), Complementos (buscador, activados/disponibles, opciones desplegables) y el resto de menús de la app |
| `player.ts` | Vidrios aparte de la cápsula (`#lg-side-background`) y del círculo de abrir/cerrar (`#lg-expand-background`), botones + y compartir, volumen vertical, aleatorio/repetir movidos a la píldora, título y artista bajo la portada, "Reproduciendo desde" + botón ∞ (`.lg-queue-top`, pulsa `#automix`), estados `lg-np`, `lg-paused`, `lg-idle`, `lg-bar-loading`, bloqueo de pantalla completa (doble clic y tecla F) |
| `now-playing.css` | Pantalla del reproductor: portada cuadrada (`--np-art`) con título/artista, panel de cola/letras sin caja a la derecha, pestañas en cápsula, sin chips ni pestañas Letra/Comentarios |
| `wave.ts` | Onda de progreso sobre el slider nativo, tiempos transcurrido/restante, corrección de la etiqueta de tiempo al pasar el ratón |
| `refraction.ts` | Refracción con aberración cromática (mapas de desplazamiento + filtros SVG) en píldora, cápsula, círculo, buscador, menú lateral y volumen |
| `lyrics.ts` / `lyrics.css` | Botón de letras y modo letras (usa el complemento *Synced Lyrics*, que debe estar activado), estilo Apple Music, crédito de la fuente, aviso "No se encontró la letra" con botón de búsqueda |
| `animated-art.ts` / `apple-motion.ts` | Portadas animadas: servicio de Better Lyrics Shaders (`artwork.boidu.dev`, validado con el id de álbum de Apple) y alternativa directa de Apple (iTunes Search + página pública del álbum, variante H.264). Por álbum exacto o por sencillo (sencillos y videoclips con "Preferir música"). Se pinta en un `<canvas>`; **el `<video>` nunca va a la página**. Caché `lg-animated-art2:` |
| `prefer-music.ts` | "Preferir música": modo Canción en videoclips y portada cuadrada en vez de video |
| `visualizer.ts` | Píldora con barras sobre el reproductor (apagada por defecto), usa `peard:audio-can-play` |
| `sidebar.ts` | Menú lateral solo con la biblioteca: cápsula Playlists / Álbumes / Artistas (álbumes y artistas pedidos con `networkManager`, `FEmusic_liked_albums` y `FEmusic_library_corpus_track_artists`). Principal/Explorar/Biblioteca van en la barra superior |
| `queue.ts` | Fila de reproducción: "Agregar a la fila" cambia `queueInsertPosition` a `INSERT_AFTER_CURRENT_VIDEO` y lo coloca tras lo ya añadido (`MOVE_ITEM`); botón ≡ con la vista "Tu fila"; cola guardada en `localStorage` `lg-queue` y recuperada al reiniciar. La canción actual es la marcada `selected` (no `selectedItemIndex`). En `ADD_ITEMS` el `index` es la posición donde se inserta |
| `panel-actions.ts` | Canciones del panel derecho (A continuación / Similares): sin arrastrar (corta `pointerdown` en `document`), botón "Agregar a tu fila" junto a los ⋮ (`UpNext.addToQueue`: `/music/get_queue` + `ADD_ITEMS`; ejecutar el `queueAddEndpoint` con `resolveCommand` no añade nada), menú ⋮ reducido a MIX/QUEUE_PLAY_NEXT/SHARE/KEEP (clase `lg-menu-hidden`), clic en el artista → "Ir al álbum"/"Ir al artista" (datos del menú de la fila) |
| `audio-engine.ts` | Cadena de audio única: fuente → ecualizador de 10 bandas (ajustes `EQ_PRESETS`) → audio espacial opcional (HRTF, marca `lg-spatial-on`) → fundido entre canciones (baja al final y sube al empezar; YouTube Music tiene un solo reproductor, no se solapan) → limitador. Usa `peard:audio-can-play` |
| `wrapped.ts` / `wrapped.css` | Resumen mensual estilo Wrapped (diseño en Figma "MusicSense · Resumen mensual", archivo `(borrador privado)`): 4 pantallas (portada, artistas, canciones, momento). Datos por mes en `localStorage` `lg-months` (profile.ts llama a `recordListening` cada 5 s). Botones en la tarjeta Estadísticas del perfil; "Guardar imagen" usa `liquid-glass:save-image` (`capturePage` × zoom). En Figma usar Inter: SF Pro solo existe en el PC y no se dibuja |
| `liquid-background.ts` | Fondo líquido (opción Estilo del fondo, por defecto): ondas de color con la portada usando Kawarp (`@kawarp/core`, MIT, de Better Lyrics), a media resolución; si la portada no se puede leer, degradado con el acento |

Otros cambios fuera del complemento: `src/plugins/scrobbler/services/clean-title.ts` (quita "(con X)", "(feat. X)" de los títulos), `src/plugins/synced-lyrics/providers/renderer.ts` (Musixmatch desactivado: devuelve letras codificadas sin cuenta), `src/plugins/synced-lyrics/renderer/renderer.tsx` (pie `.synced-lyrics-footer` tras la última línea, para el crédito), `synced-lyrics/renderer/components/SyncedLine.tsx` (palabras `.lyrics-word` con `--w-start`/`--w-len` y `--line-elapsed` para el relleno palabra por palabra; línea `.lyrics-translation`), `synced-lyrics/renderer/store.ts` (señal `translations`, la rellena `lyrics.ts` con `liquid-glass:translate` = Google Translate gtx desde `backend.ts`), `synced-lyrics/renderer/index.ts` (busca la letra de la canción actual al arrancar), `src/index.ts` (DevTools), `assets/icon.svg` y `scripts/generate-icons.mjs`.

## Preferencias del usuario (respetarlas)

- La píldora y la cápsula del reproductor deben verse **iguales en toda la app**, con extremos totalmente redondos.
- Nada de ventanas flotantes "raras" ancladas a botones: diálogos centrados como los de YouTube.
- El menú lateral **no debe desplazar** el contenido; se anima al abrir y cerrar.
- Paneles integrados en el fondo (sin cajas) en la pantalla del reproductor.
- Sin publicidad de Premium, sin pantalla completa de YouTube, sin "No me gusta".
- Referencia de vidrio: barra de pestañas de iOS 26 (tinte oscuro, lente en los bordes con irisado). Si se ven "bordes raros llenos de colores", bajar `scale` en `refraction.ts`.
- **No mover ni escalar** elementos con refracción en animaciones de hover: va a pocos FPS.

## Pendiente e ideas

- Por confirmar con el usuario: letra no encontrada (aviso y botón), avisos en cápsula al dar "Me gusta", "Cambiar de cuenta" → atrás, escalado maximizado/mínimo; ⋮ propio y botón de fila en las canciones de reproducción automática (#automix-contents, no se pudo probar); sonido del ecualizador, fundido y audio espacial (no se puede escuchar desde las pruebas); "Guardar imagen" del resumen mensual.
- Propuestas siguientes (el usuario aún no eligió): normalizar el volumen (en `audio-engine.ts`), minirreproductor siempre encima, temporizador de apagado, modo inmersivo (collage de portadas + letra a pantalla completa), aleatorio uniforme, origen de cada canción en la cola + "Escuchado recientemente", control desde el móvil (sobre el complemento Servidor API), más fuentes de letras. Descartado: Automix, vista previa de video, picture-in-picture.
- En pruebas: al reiniciar la app a la fuerza (cambios del proceso principal o de CSS de los complementos) se pierde lo escrito en `localStorage` en los últimos segundos. Una recarga normal no.
- Scripts de prueba útiles (recrear en el scratchpad): esperar a que cargue (`#movie_player` + `ytmusic-player-bar`), abrir el menú ⋮ de una fila con clic real comprobando `elementFromPoint`, `Emulation.setDeviceMetricsOverride` para probar alturas de ventana, `CSS.forcePseudoState` (hover) para ver botones que solo salen al pasar el ratón, `Animation.setPlaybackRate` para ver animaciones a cámara lenta.
- No hay bloqueador de anuncios en esta versión de Pear (solo SponsorBlock).
- Nombre: `APPLICATION_NAME` (`src/i18n/index.ts`) es "MusicSense" (título de ventana "Canción · MusicSense", bandeja, notificaciones, acceso directo). **No cambiar `productName`** (package.json / electron-builder.yml): de él depende la carpeta de datos `%APPDATA%/YouTube Music` con la sesión y los ajustes; el instalador usa `shortcutName`/`artifactName`. Iconos de bandeja generados por `scripts/generate-icons.mjs` (la bandeja es una opción de Pear, apagada por defecto).

## Notas técnicas de YouTube Music (verificadas)

- Los selectores cambian a menudo: inspecciona el DOM real antes de escribir CSS nuevo.
- `ytmusic-player-bar` es `position: fixed` + `display: grid`, contiene incluso a sus hijos `fixed` y aísla su `backdrop-filter`: los fondos de vidrio van como elementos hermanos.
- `ytmusic-app` **sin `z-index`** (si no, los diálogos quedan bajo su fondo oscuro). `body` transparente, `html` negro.
- Niveles: vidrio de la barra superior (`#nav-bar-background`) 5, cajón del menú (`tp-yt-app-drawer#guide`) 6, cápsula de pestañas del perfil 2100, panel de ajustes 3000.
- `.background-gradient` envuelve el contenido de las páginas: nunca ocultarlo.
- Para saber si suena música usar `#movie_player video.video-stream`, nunca el primer `video`.
- Menús de YouTube (⋮ de la canción, cuenta): se abren "por dentro" con la clase `lg-silent-menu` (invisibles) y se busca la opción por `data.icon.iconType` (`ADD_TO_PLAYLIST`, `SHARE`, `SETTINGS`, `EXIT_TO_APP`...).
- Navegar: `document.querySelector('ytmusic-app').navigate(browseId)`. Datos de YouTube Music con la sesión del usuario: `ytmusic-app.networkManager.fetch('/browse?prettyPrint=false', { browseId })`.
- `#progress-bar` viene desplazado (`left: -16px`, `translateY(-16px)`): se reposiciona entero. `#play-pause-button` mide 52 px y el resto 36 px: escalar grupos con `zoom`, no botones sueltos.
- La configuración guardada se combina con los valores por defecto (`deepmerge`): añadir opciones es seguro.

## Estilo de código

- `oxlint` exige paréntesis al mezclar `*` / `/` con `+`, pero `oxfmt` los quita: usa variables intermedias.
- No mezcles claves con y sin comillas en un mismo objeto (`quote-props`).
- Comentarios en español, como en el resto del complemento.
- Textos nuevos: añadirlos en `es.json` y `en.json` y pasar `oxfmt` por ambos.
