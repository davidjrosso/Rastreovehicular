# Rastreo · Río Tercero

Primera implementación del sistema de trabajo colaborativo para la sala de monitoreo, Policía y Fiscalía de la Municipalidad de Río Tercero.

## Funciones disponibles

- Acceso por usuario y contraseña, Argon2id, sesiones por cookie httpOnly, límites de intentos y protección de solicitudes entre sitios.
- Administrador, supervisor, operador y externo. Los externos sólo consultan los pedidos de su dependencia y aportan información; las capturas y revisiones pertenecen a la sala.
- Pedidos correlativos, expediente, franja horaria y estados: pedida, en curso, en revisión, entregada, archivada y rechazada. Devolución y reapertura con observaciones.
- Varios objetivos, capturas con varias cámaras y objetivos, certeza, sentido observado y fecha con segundos.
- Fotos y clips de hasta 50 MB por archivo, descargables con autorización de la búsqueda. SHA-256 registrado y archivos fuera de la carpeta pública.
- Revisiones sin resultado por cámara, horario y objetivo; aportes con coordenadas opcionales.
- Mapa MapLibre con calles locales del prototipo, 7.895 nodos de OpenStreetMap, ruteo Dijkstra en el servidor, manos de circulación, avisos de contramano y velocidad inusual. Los puntos dudosos no forman el recorrido.
- Chat, menciones a usuarios conectados, presencia, actualizaciones Socket.IO y avisos internos.
- Historial de estados, registros y adjuntos; eliminación lógica de registros.
- CSV con separador `;`, hora argentina y protección contra fórmulas; KML con capturas y recorridos.
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

## Pendientes respecto del concepto

- Sincronización programada desde My Maps: por ahora se importa KML manualmente.
- Sugerencias de próximas cámaras y ventanas de tiempo, Telegram, informe PDF e infografía PNG.
- PWA instalable y trabajo con conectividad intermitente.
- TOTP/2FA, retención configurable, prioridades y plazos, integración HikCentral y modo evidencia.
- Edición de registros existentes con historial de versiones: hoy se corrigen ocultando el registro y agregando uno nuevo.
- Menciones a usuarios desconectados: actualmente se elige entre los presentes.
- Teselas PMTiles: el mapa inicial usa GeoJSON local de las calles extraídas del prototipo.

El ruteo es una estimación, no una observación del trayecto: conecta el punto más cercano de cada captura al grafo, sigue la ruta de menor distancia y advierte si requiere contramano. El sentido escrito por el operador queda documentado pero todavía no condiciona el algoritmo. No modela restricciones de giro, cortes temporales ni validación del sentido de todas las calles. Para personas ignora la mano vehicular; no es todavía una red peatonal dedicada. Si no hay conexión o las cámaras de un mismo instante están demasiado separadas, muestra un aviso sin inventar un tramo. Las revisiones de la cámara se muestran como resumen visual; los intervalos exactos se consultan en la pestaña Revisiones.

Antes de un uso operativo: validar cartografía, permisos y flujos con la sala y verificar el despliegue y la restauración en el datacenter.

El documento fuente completo está conservado en [docs/CONCEPTO.md](docs/CONCEPTO.md). La lista anterior describe el alcance realmente implementado; las etapas del concepto son la hoja de ruta.

