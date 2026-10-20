# Rastreo por Cámaras — Documento de concepto

Municipalidad de Río Tercero · Departamento de Cómputos · v0.1 (20/10/2026)

## 1. Qué es

Es un sistema web donde la sala de monitoreo y la Policía/Fiscalía trabajan juntas sobre un **pedido de búsqueda**. Los operadores cargan **capturas** (cámara + hora + objetivo) y el sistema dibuja en el mapa de la ciudad el **recorrido probable** de cada objetivo. Además sugiere qué cámaras mirar después y genera el informe de salida.

Parte del prototipo actual (`recorrido/index.html`): mapa vectorial de Río Tercero, 356 cámaras del My Maps, ruteo por calles respetando el sentido de circulación, y velocidades por tramo.

**Alcance actual:** es una herramienta de trabajo informal. No es un sistema de evidencia judicial: no hay firma digital, cadena de custodia ni hash obligatorio. El diseño deja lugar para sumar eso después sin rehacer nada.

## 2. Usuarios y roles

| Rol | Quiénes | Puede |
|---|---|---|
| **Administrador** | Cómputos | Usuarios, dependencias, configuración, sincronización de cámaras |
| **Supervisor** | Jefe de sala | Todo lo del operador + tomar pedidos, revisar, entregar, archivar, reabrir |
| **Operador** | Personal de la sala | Trabajar las búsquedas abiertas: capturas, adjuntos, "revisada sin resultado", chat |
| **Externo** (Policía / Fiscalía) | Usuarios de cada dependencia | Crear pedidos, seguir en vivo sus búsquedas, aportar datos y adjuntos, chatear, descargar informe y exportes |

Reglas:

- Un externo solo ve los pedidos de **su dependencia** (Comisaría X, Fiscalía Y).
- Un externo **aporta datos** (testigos, horarios, fotos propias) como *aportes*, que quedan separados de las capturas de la sala. No crea ni edita capturas.
- El login es con usuario y clave propios. Las cuentas las crea el administrador. El 2FA (TOTP) queda opcional, y se recomienda para externos porque el sistema va a estar publicado en internet.

## 3. Conceptos

- **Búsqueda (pedido):** número interno, número de expediente u oficio, dependencia solicitante, descripción del hecho, fecha, franja horaria de interés, zona aproximada, estado y prioridad.
- **Objetivo:** lo que se sigue. Una búsqueda puede tener **varios** (ej.: "Auto gris VW Gol", "Moto con 2 ocupantes", "Persona campera roja"). Cada uno tiene tipo (vehículo / persona / otro), descripción, patente si la hay, y un color propio en el mapa.
- **Captura:** una aparición de un objetivo en una cámara.
  - Cámara(s): una o varias. Varias en la misma captura significa el mismo momento visto desde varios ángulos.
  - Fecha y hora con segundos.
  - Objetivo(s) que aparecen. Puede ser más de uno si van juntos.
  - Sentido: hacia dónde va (N/S/E/O o "hacia calle X").
  - Certeza: **confirmado / probable / dudoso**.
  - Adjuntos: fotos y clips exportados del NVR.
  - Quién la cargó y cuándo.
- **Revisión sin resultado:** cámara + franja horaria (+ objetivo) que ya se miró y no apareció. Evita que otro operador repita el trabajo y le sirve al sistema de sugerencias.
- **Aporte externo:** dato que suma la Policía/Fiscalía. Puede ser texto, una hora, un lugar marcado en el mapa o un adjunto.
- **Mensaje:** chat dentro de cada búsqueda, con mención a usuarios.

## 4. Ciclo de vida de una búsqueda

```
Pedida ──► En curso ──► En revisión ──► Entregada ──► Archivada
   │           ▲              │
   └► Rechazada └── Devuelta ◄─┘   (el supervisor la devuelve con observaciones)
```

- **Pedida:** la crea un externo, o la sala a nombre de una dependencia. Avisa a la sala.
- **En curso:** un supervisor la toma. Todos los operadores pueden trabajarla a la vez.
- **En revisión:** un operador la da por terminada. El supervisor revisa el recorrido, las certezas y los adjuntos.
- **Entregada:** el informe queda disponible para el solicitante, con aviso.
- **Archivada:** solo lectura. Un supervisor la puede reabrir.
- **Rechazada:** con motivo (ej. fuera de la zona con cámaras, o franja sin grabación).

La prioridad (urgente / normal) y la fecha límite son opcionales y se pueden sumar más adelante.

## 5. Funciones

### 5.1 Trabajo colaborativo en vivo

- Todos los que tienen abierta una búsqueda ven en tiempo real, sin recargar, las capturas nuevas, las revisiones y los mensajes.
- No se reparten tareas: el trabajo es libre. Para coordinar están las revisiones sin resultado, el chat y las sugerencias.
- Se ve quién está conectado en esa búsqueda.

### 5.2 Mapa

- Mapa vectorial propio de Río Tercero, sin depender de Google ni de servicios externos.
- Todas las cámaras, con un estado visual por búsqueda: sin mirar / revisada sin resultado (gris) / con captura (color del objetivo).
- Un recorrido por objetivo, en su color, con flechas de sentido y la hora en cada punto.
- Las capturas **confirmadas y probables** arman el recorrido. Las **dudosas** se muestran como puntos sin unir, o con línea punteada si el usuario lo activa.
- Los tramos se marcan cuando necesitan contramano o la velocidad es rara (más de 70 km/h o menos de 3 km/h).
- Los aportes externos aparecen como marcadores propios.
- Se puede tocar una cámara para cargar una captura o una revisión desde ahí.

### 5.3 Sugerencia de próximas cámaras

Desde la última captura de un objetivo (cámara C, hora T), el sistema calcula las cámaras alcanzables por calle y, para cada una, una **ventana horaria estimada**:

```
desde = T + distancia / velocidad_máx      (ej. 60 km/h)
hasta = T + distancia / velocidad_mín      (ej. 10 km/h; configurable)
```

- Ordena las cámaras por distancia de red, respetando el sentido de las calles y el sentido declarado en la captura.
- Excluye las que ya tienen una revisión sin resultado que cubre esa ventana.
- Se muestran en el mapa y en una lista ("Mirar CAM-249 entre 19:36:10 y 19:37:40").
- Sirve también hacia atrás: "¿de dónde venía?", con la ventana *antes* de T.

### 5.4 Salidas

- **Infografía:** una imagen PNG lista para mandar por WhatsApp, con mapa, recorridos y cronología.
- **Informe PDF:** datos del pedido, objetivos, mapa, cronología por objetivo, fotos, operadores intervinientes, observaciones del supervisor.
- **Link de consulta:** el externo abre la búsqueda con su usuario y ve el mapa interactivo.
- **Exportes:** CSV con `;` y fechas dd/mm/aaaa, y KML para Google Earth / My Maps.

### 5.5 Avisos

- Dentro del sistema: campana con contador y lista de novedades.
- Por **Telegram**, con un bot. Cada usuario vincula su cuenta y se puede configurar además un grupo de la sala.
- Eventos que avisan:
  - pedido nuevo (a la sala);
  - búsqueda tomada (al solicitante);
  - mensaje con mención;
  - pasó a revisión (al supervisor);
  - devuelta (a los operadores);
  - entregada (al solicitante).

### 5.6 Cámaras

- La fuente sigue siendo el **My Maps** ("Mapa de camaras nuevo"). El sistema importa el KML automáticamente (ej. cada hora) y con un botón "Sincronizar ahora".
- Para la sincronización automática el mapa tiene que estar compartido por vínculo. Si se mantiene privado, se sube el KML a mano.
- La cámara se identifica por el prefijo `CAM-<número>` del nombre. Cada sincronización registra altas, bajas y movimientos.
- La sincronización avisa números duplicados (hoy: CAM-256, CAM-393, CAM-399) y nombres que no siguen el formato.
- Cada captura guarda una copia de la posición de la cámara en ese momento. Si la cámara se mueve después, las búsquedas viejas no cambian.

### 5.7 Historial básico

Aunque el uso es informal, cada captura, revisión y cambio de estado guarda quién lo hizo y cuándo. No se borra nada físicamente: lo eliminado queda oculto. Cuesta poco y evita discusiones de "quién cargó esto".

## 6. Dispositivos

- **PC de la sala** (uso principal): pantalla amplia con el mapa grande y paneles laterales; pensado para monitores grandes.
- **Celular** (Policía y supervisores en la calle): PWA instalable. Prioriza ver el mapa y el estado, chatear, aportar datos y fotos desde la cámara del teléfono, y descargar el informe.

## 7. Infraestructura

- **Esquema:** servidor en el **datacenter municipal**, con todo el sistema publicado en internet con HTTPS y login. Internos y externos entran por la misma URL.
- Adjuntos y base de datos quedan en el datacenter.
- Recomendaciones por estar expuesto:
  - HTTPS obligatorio;
  - bloqueo por intentos fallidos;
  - 2FA para externos;
  - backups diarios fuera del servidor;
  - de ser posible, filtrar por país en el firewall (MikroTik).
- **Retención de búsquedas y adjuntos:** a definir, queda configurable. Por defecto no se borra nada.
- **Escala esperada:** chica. Hasta unos 15 usuarios, pocas búsquedas abiertas a la vez, solo Río Tercero.

## 8. Stack recomendado

Elegido para: escala chica, tiempo real, ruteo propio, mapa sin dependencias externas, PWA, y que lo puedas mantener vos (ya trabajás con TypeScript/React en Hormiga).

| Capa | Elección | Por qué |
|---|---|---|
| Backend | **Node 22 + TypeScript + Fastify** | Mismo lenguaje en todo el proyecto, liviano, buen soporte de WebSocket |
| Tiempo real | **WebSocket** (Socket.IO), una sala por búsqueda | Actualización en vivo, presencia y chat con poco código |
| Base de datos | **PostgreSQL 16** | Varios usuarios escribiendo a la vez, `LISTEN/NOTIFY`, JSON; PostGIS queda disponible si algún día hace falta |
| Ruteo | **Grafo de calles en memoria del servidor** (Dijkstra, como el prototipo) | Unos 8.000 nodos: responde en milisegundos sin OSRM; el servidor calcula y todos ven el mismo recorrido |
| Mapa | **MapLibre GL** + teselas vectoriales propias (**PMTiles** generadas del extracto OSM de Río Tercero) | Mapa real con zoom fluido, sin Google, funciona en la red interna |
| Frontend | **React + Vite**, PWA | Igual que Hormiga; instalable en Android/iPhone |
| Adjuntos | Disco del servidor (carpeta por búsqueda) + SHA-256 guardado | Simple; el hash ya deja la puerta abierta a uso como evidencia |
| PDF e infografía | **Playwright** en el servidor, que imprime una vista HTML del informe | El informe se diseña con la misma web y sale igual en PDF y PNG |
| Login | Usuario/clave con **argon2**, sesión por cookie httpOnly, TOTP opcional | Sin depender de terceros |
| Telegram | Bot propio (API de Bots) | Gratis, simple, avisos a usuarios y grupo |
| Despliegue | **Docker Compose** (app + Postgres) detrás de **Caddy** (HTTPS automático) | Un solo comando para levantar, actualizar y hacer backup |

## 9. Modelo de datos (borrador)

```
dependencia(id, nombre, tipo[policia|fiscalia|municipal])
usuario(id, nombre, usuario, hash_clave, rol, dependencia_id, telegram_chat_id, totp_secret, activo)
camara(id, numero, nombre, lat, lon, origen_kml_id, activa, actualizada_en)
camara_sync(id, fecha, altas, bajas, movidas, duplicados_json, usuario_id)

busqueda(id, numero, expediente, dependencia_id, solicitante_id, hecho, fecha_hecho,
         desde, hasta, zona_lat, zona_lon, estado, prioridad, limite, creada_en)
busqueda_estado(id, busqueda_id, de, a, usuario_id, observacion, fecha)
objetivo(id, busqueda_id, tipo, descripcion, patente, color)

captura(id, busqueda_id, fecha_hora, sentido, certeza, observacion,
        cargada_por, cargada_en, eliminada)
captura_camara(captura_id, camara_id, lat, lon)        -- copia de la posición
captura_objetivo(captura_id, objetivo_id)
revision(id, busqueda_id, camara_id, objetivo_id NULL, desde, hasta, usuario_id, fecha)
aporte(id, busqueda_id, usuario_id, texto, fecha_hora NULL, lat NULL, lon NULL, fecha)
adjunto(id, busqueda_id, captura_id NULL, aporte_id NULL, archivo, tipo, bytes, sha256, subido_por, fecha)
mensaje(id, busqueda_id, usuario_id, texto, fecha)
aviso(id, usuario_id, tipo, busqueda_id, texto, leido, fecha)
```

## 10. Etapas

**v1: núcleo usable**

- Login y roles, dependencias.
- Sincronización de cámaras desde My Maps.
- Búsquedas con estados.
- Objetivos múltiples.
- Capturas con certeza, sentido y adjuntos.
- Mapa con recorridos por objetivo.
- Tiempo real y chat.
- Revisiones sin resultado.
- Avisos dentro del sistema.
- Exportes CSV/KML.

**v2: productividad**

- Sugerencia de próximas cámaras (hacia adelante y hacia atrás).
- Bot de Telegram.
- Infografía PNG e informe PDF.
- Aportes externos con marcador en el mapa.
- PWA pulida para celular.

**v3: opcional**

- Retención configurable.
- 2FA obligatorio.
- Prioridades y plazos.
- Integración con HikCentral (abrir o exportar el video de la cámara a esa hora).
- Modo evidencia: hash obligatorio, informe firmado, cadena de custodia.

## 11. Decisiones pendientes

1. Nombre del sistema y dominio o subdominio donde se publica.
2. Si el My Maps se comparte por vínculo (sincronización automática) o se sube el KML a mano.
3. Tamaño máximo de clip y espacio de disco para adjuntos.
4. Política de retención.
5. Cuál es el número de búsqueda: uno propio correlativo (ej. `RT-2026-0142`) además del expediente.
6. Velocidades mínima y máxima por defecto para las sugerencias (¿distintas para auto, moto y persona a pie?).
7. Quién da de alta a los usuarios externos y cómo se dan de baja cuando dejan la dependencia.
