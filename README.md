# Rastreo · Río Tercero

Primera implementación del sistema de trabajo colaborativo para la sala de monitoreo, Policía y Fiscalía de la Municipalidad de Río Tercero.

## Funciones disponibles

- Acceso por usuario y contraseña, Argon2id, sesiones por cookie httpOnly, límites de intentos y protección de solicitudes entre sitios.
- Administrador, supervisor, operador y externo. Los externos sólo consultan los pedidos de su dependencia y aportan información; las capturas y revisiones pertenecen a la sala.
- Pedidos correlativos, expediente, franja horaria y estados: pedida, en curso, en revisión, entregada, archivada y rechazada. Devolución y reapertura con observaciones.
- Varios objetivos, capturas con varias cámaras y objetivos, certeza, sentido observado y fecha con segundos.
- Selector de cámaras con búsqueda por número o nombre, sin distinguir acentos. Mantiene las cámaras seleccionadas al cambiar el filtro.
- Horarios con escritura manual `HH:MM` o `HH:MM:SS` y selector de hora sincronizado; fecha seleccionable y validación de la franja del pedido.
- Fotos y clips de hasta 50 MB por archivo, descargables con autorización de la búsqueda. SHA-256 registrado y archivos fuera de la carpeta pública.
- Revisiones sin resultado por cámara, horario y objetivo; aportes con coordenadas opcionales.
- Lugares del hecho y avistamientos en cámaras particulares: nombre, dirección, descripción, fecha y ubicación elegida en el mapa o por coordenadas. Los avistamientos particulares requieren horario y permanecen identificados como aportes de su fuente.
- Incertidumbre por tramo y objetivo, con tiempo transcurrido y motivo. Conserva la certeza de las capturas y omite la línea, distancia y velocidad del tramo incierto. La anotación abarca su intervalo original, incluidas capturas agregadas después, hasta que la sala la retire; ambos cambios quedan auditados.
- Sugerencias de próximas cámaras para la sala: hasta cinco candidatos por objetivo desde la última captura confirmada, con distancia por calles, prioridad explicada, franja para revisar y marcadores violetas. Acciones para abrir una captura o revisión con cámara, objetivo y horario precargados, sujetos a confirmación del operador.
- Mapa MapLibre con calles locales del prototipo, 7.895 nodos de OpenStreetMap, ruteo Dijkstra en el servidor, manos de circulación, avisos de contramano y velocidad inusual. Los puntos dudosos no forman el recorrido.
- Chat, menciones a usuarios conectados, presencia, actualizaciones Socket.IO y avisos internos.
- Historial de estados, registros y adjuntos; eliminación lógica de registros.
- CSV con separador `;`, hora argentina y protección contra fórmulas; KML con capturas, lugares y recorridos. Ambos exportes incluyen los motivos de incertidumbre; KML no dibuja los tramos inciertos.
- Administración de usuarios, desactivación y restablecimiento de contraseñas, dependencias e importación de KML.

Es una versión inicial para probar el flujo de trabajo. No es un sistema de evidencia judicial.

## Desarrollo local

Requiere **Node.js 24 LTS** (mínimo 22.12). No hace falta instalar PostgreSQL para la prueba local: se usa PGlite, PostgreSQL embebido persistente, en `data/db`.

```sh
npm ci
```

Copiar `.env.example` a `.env`. Configurar temporalmente `BOOTSTRAP_USER` y `BOOTSTRAP_PASSWORD` con una clave única de al menos 12 caracteres. No hay credenciales predeterminadas.

```sh
npm run bootstrap
npm run dev
```

Abrir http://localhost:5173. Tras crear la cuenta, retirar la clave de bootstrap del archivo `.env`. El bootstrap no reemplaza una cuenta existente ni modifica su contraseña.

Para servir la aplicación compilada:

```sh
npm run build
npm start
```

Abrir http://localhost:3001. Para ese modo local, configurar `APP_ORIGIN=http://localhost:3001`.

En Windows también se puede ejecutar `.\scripts\start-local.ps1`. Busca una versión compatible de Node y, si la versión global es antigua, puede usar la incluida con Codex. Mantener esa terminal abierta mientras se usa el sistema.

Las fechas ingresadas se interpretan en Argentina (UTC−03:00), independientemente de la zona del dispositivo. La base conserva instantes con zona horaria.

## Sugerencias de próximas cámaras

Dentro de una búsqueda, la sala puede elegir el objetivo y pulsar **Sugerir próximas cámaras**. El cálculo usa sólo cámaras activas conectadas al grafo local, respeta manos para vehículos y permite ambos sentidos para peatones. Las cámaras de la aparición de origen se excluyen. Los aportes particulares y las apariciones probables o dudosas no se convierten automáticamente en origen confirmado.

El modo **Cercanía por calles** ordena por distancia, después de reducir prioridad a franjas revisadas. **Dirección y alternativas** pondera la continuidad del último tramo y diversifica salidas cercanas. Se puede indicar un sentido cardinal o dejarlo automático. No interpreta texto libre del campo “sentido observado”.

La velocidad automática se estima con el último tramo confirmado cuando es utilizable: entre 5 y 70 km/h para vehículos, o 2 y 8 km/h para peatones. Si no hay datos suficientes, se utiliza un **supuesto ajustable de 30 o 4,5 km/h**, respectivamente. Son parámetros heurísticos, no velocidades observadas. La ventana usa entre 0,5 y 1,5 veces la velocidad de referencia, con 30 segundos de tolerancia y un margen por demoras configurable; se limita al horizonte elegido y al fin del pedido. El horizonte se cuenta desde la captura y funciona también para fechas históricas.

La incertidumbre previa, una demora entre capturas mayor a 10 minutos (20 a pie) o apariciones posteriores sin confirmar deshabilitan la inferencia automática de sentido y velocidad, y añaden al menos 5 minutos de margen. Un origen simultáneo con cámaras a más de 150 m del centro requiere aclarar la ubicación. Las revisiones sin resultado se comparan por cámara, objetivo y unión de intervalos: revisar parcialmente no descarta toda la franja.

Los resultados expresan prioridad, no probabilidades calibradas ni recorridos acreditados. El catálogo tiene ubicaciones, pero no orientación ni campo visual: la sala debe verificar que la cámara cubra el paso de interés. No crean capturas ni modifican registros; los horarios precargados deben ajustarse al video revisado. Se recalculan ante cambios relevantes mientras el panel está activo. Los usuarios externos no reciben sugerencias ni el catálogo de cámaras.

## Cámaras y datos privados

**Las cámaras reales, las búsquedas, los adjuntos y las contraseñas no están en Git.** El ZIP original contiene ubicaciones y se mantiene fuera del repositorio.

En Administración → Cámaras desde KML se carga una exportación completa de My Maps. Se identifican cámaras por el prefijo `CAM-<número>`. Una importación con números duplicados o datos inválidos se rechaza entera; hay que corregirla en origen. Se registran altas, movimientos y bajas.

El documento original identifica duplicados en CAM-256, CAM-393 y CAM-399. Para el **bootstrap inicial** se puede configurar `CAMERA_KML` y `QUARANTINE_DUPLICATES=true`: excluye todas las ubicaciones de esos números ambiguos, en lugar de elegir una. La operación queda registrada con los números excluidos. La interfaz normal exige corregir los duplicados.

Cada captura guarda nombre, número y coordenadas de sus cámaras. Una sincronización posterior no modifica esos datos históricos.

Las calles incluidas son la copia de octubre de 2026 del prototipo suministrado. Fuente: © colaboradores de OpenStreetMap, ODbL. Ver [NOTICE](NOTICE).

## Prueba de uso

1. Crear dependencias y usuarios desde Administración.
2. Importar el KML completo y corregido.
3. Crear un pedido, indicando dependencia y franja horaria.
4. Un supervisor o administrador toma la búsqueda.
5. La sala agrega objetivos, capturas y revisiones. Se puede pulsar una cámara en el mapa para abrir la carga.
6. Los externos de esa dependencia consultan el progreso, aportan datos y chatean.
7. El operador envía a revisión; el supervisor devuelve o entrega y luego archiva.

En búsquedas archivadas no se admiten nuevas escrituras. Un supervisor puede reabrirlas con motivo. Los usuarios desactivados pierden sus sesiones.

## Verificación

```sh
npm test
npm run build
npm audit --omit=dev
```

La integración verifica aislamiento entre dependencias por HTTP y WebSocket, permisos por rol, estados, escrituras concurrentes, franja de captura, adjuntos, hash, descarga autorizada, exportes, snapshots de cámaras y eliminación lógica. Las pruebas de dominio verifican KML, CSV y ruteo con calles de mano única.

Las pruebas usan una base efímera PGlite. Para probar PostgreSQL real, apuntar **sólo a una base vacía de pruebas** con `TEST_DATABASE_URL`; CI levanta una instancia efímera para esa verificación.

## Datacenter municipal

El esquema preparado es Node/Fastify + PostgreSQL 16 + Caddy, con Docker Compose.

Crear `.env` con:

```dotenv
DOMAIN=rastreo.ejemplo.gob.ar
POSTGRES_PASSWORD=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO
```

Usar una contraseña alfanumérica aleatoria larga para evitar problemas de escape en la URL de conexión. Apuntar el DNS al servidor y habilitar 80/443.

```sh
docker compose up -d --build
```

Crear el administrador con las variables de bootstrap suministradas desde el entorno de la terminal:

```sh
docker compose exec -e BOOTSTRAP_USER -e BOOTSTRAP_PASSWORD app node --import tsx server/bootstrap.ts
```

Las variables deben estar exportadas en la terminal desde la que se ejecuta el comando; no escribir claves en scripts versionados. Importar luego las cámaras desde la interfaz.

El contenedor no corre como root. PostgreSQL y la aplicación no exponen puertos propios al exterior. `NODE_ENV=production` exige `DATABASE_URL` y `APP_ORIGIN` HTTPS; la cookie pasa a ser segura.

Mantener una única instancia de la aplicación en esta etapa. La presencia y la entrega de eventos usan memoria de esa instancia; para varias réplicas hace falta un adaptador compartido de Socket.IO.

Respaldar tanto PostgreSQL (`pg_dump`) como el volumen `uploads` y conservar copias fuera del servidor. Probar restauraciones. Los volúmenes persisten al actualizar contenedores. No ejecutar `docker compose down -v` sobre una instalación con datos.

## Sincronización de cámaras y estado de conexión

En **Administración → Sincronización de cámaras** se ven la última consulta correcta, errores, conflictos y botones para consultar inmediatamente. Sólo administradores pueden gestionar estas integraciones. El servidor consulta los servicios y avisa a los navegadores conectados. Debe permanecer encendido.

### Google My Maps

Configurar `MY_MAPS_ID` en `.env` con el valor `mid` del enlace del mapa. El mapa debe permitir descargar su KML sin iniciar sesión. `MY_MAPS_INTERVAL_SECONDS=300` establece una consulta cada cinco minutos, también al iniciar el servidor.

Se reconocen puntos con nombre `CAM-número`, se agregan cámaras y se actualizan sus nombres y posiciones. Las bajas desactivan el registro sin borrar capturas ni sus ubicaciones históricas. Números duplicados se muestran como conflictos: se conserva su registro anterior si existía y no se elige una ubicación arbitraria. Corregirlos en My Maps permite incorporarlos en la siguiente consulta. Un archivo vacío, inválido o con nombres no reconocidos conserva el catálogo anterior. Si un cambio elimina más del 25% de las cámaras activas, la sincronización automática se detiene hasta revisar el origen; una importación manual válida permite aplicar un cambio masivo intencional. Las sincronizaciones sin cambios no generan auditorías repetidas.

### HikCentral OpenAPI

1. En HikCentral, con un administrador, verificar **Configuración del sistema → Integración con terceros → OpenAPI**. El nombre depende de la versión. Habilitar el servicio y un usuario asociado con permiso de lectura sobre las cámaras. Algunas versiones requieren instalar el paquete OpenAPI correspondiente desde el servidor de HikCentral.
2. Obtener la dirección HTTPS y puerto de OpenAPI, AppKey y AppSecret. La dirección del portal `/#/portal` puede corresponder a otro servicio. Configurar localmente en `.env` las variables `HIK_OPENAPI_URL`, `HIK_APP_KEY` y `HIK_APP_SECRET`. No subir ese archivo a Git ni pegar claves en mensajes. Reiniciar la aplicación después de editar la configuración.
3. Abrir Administración y pulsar **Consultar estados**. La consulta se repite cada `HIK_INTERVAL_SECONDS` (60 segundos por defecto).

El conector consulta `POST /artemis/api/resource/v1/cameras` con firma HMAC-SHA256 y todas sus páginas. Interpreta el campo `status` documentado como `0=desconocido`, `1=en línea`, `2=fuera de línea`. Requiere HTTPS y un certificado de confianza. Si se usa una CA privada, proporcionar su certificado con `NODE_EXTRA_CA_CERTS` al iniciar Node; no se desactiva la validación TLS.

La vinculación automática usa el prefijo `CAM-número` del nombre de HikCentral, sólo si es único. Para nombres distintos o números repetidos se puede configurar `HIK_CAMERA_MAPPING='{"276":"cameraIndexCode-en-HikCentral"}'`. No admite que dos números compartan el mismo identificador explícito. Cámaras sin correspondencia o sin permisos de lectura quedan sin información, nunca se consideran caídas por estar ausentes de la respuesta.

El borde del punto en el mapa indica conexión actual: verde en línea, rojo fuera de línea, gris sin información reciente. El relleno conserva los colores de capturas y revisiones. Una consulta fallida conserva los datos anteriores; después de tres intervalos (mínimo tres minutos) el estado se presenta como desconocido. Las respuestas incompletas no se aplican parcialmente. La conexión no garantiza imagen correcta ni grabación disponible. Las sugerencias de búsqueda histórica no excluyen cámaras por su estado actual.

Contrato implementado según la documentación oficial de Hikvision: [habilitar OpenAPI](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-223990A6-B9D0-49FC-9249-3E24BC77F926.html), [autenticación](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-AC08DDFF-62E1-48F6-8D12-1DE85DDCDB20.html), [catálogo paginado](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-806B9EF1-0102-45BF-AC1D-C4A079DA4792.html) y [CameraInfo/status](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-5374ABDC-351D-4C41-B706-62622445E40E.html). Es necesario verificarlo contra la versión y permisos de la instalación antes de dar por conectada la integración real.

## Pendientes respecto del concepto

- Telegram, informe PDF e infografía PNG.
- PWA instalable y trabajo con conectividad intermitente.
- TOTP/2FA, retención configurable, prioridades y plazos, validación de HikCentral en la instalación municipal y modo evidencia.
- Edición de registros existentes con historial de versiones: hoy se corrigen ocultando el registro y agregando uno nuevo.
- Menciones a usuarios desconectados: actualmente se elige entre los presentes.
- Teselas PMTiles: el mapa inicial usa GeoJSON local de las calles extraídas del prototipo.

El ruteo es una estimación, no una observación del trayecto: conecta el punto más cercano de cada captura al grafo, sigue la ruta de menor distancia y advierte si requiere contramano. El sentido escrito por el operador queda documentado pero todavía no condiciona el algoritmo. No modela restricciones de giro, cortes temporales ni validación del sentido de todas las calles. Para personas ignora la mano vehicular; no es todavía una red peatonal dedicada. Si no hay conexión o las cámaras de un mismo instante están demasiado separadas, muestra un aviso sin inventar un tramo. Las revisiones de la cámara se muestran como resumen visual; los intervalos exactos se consultan en la pestaña Revisiones.

Antes de un uso operativo: validar cartografía, permisos y flujos con la sala y verificar el despliegue y la restauración en el datacenter.

El documento fuente completo está conservado en [docs/CONCEPTO.md](docs/CONCEPTO.md). La lista anterior describe el alcance realmente implementado; las etapas del concepto son la hoja de ruta.
