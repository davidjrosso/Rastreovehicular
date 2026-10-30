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
- Menú **INFORMES** con todas las búsquedas autorizadas, filtro por estado y búsqueda por número, título, expediente o dependencia. Reportes de situación con mapa vectorial, cronología numerada, imágenes, incertidumbres y sugerencias; impresión y guardado como PDF desde el navegador.

Es una versión inicial para probar el flujo de trabajo. No es un sistema de evidencia judicial.

## Corregir títulos y recorridos

Los pedidos admiten tres modalidades en **Fecha de la búsqueda**: hecho con inicio y fin; **búsqueda abierta**, con inicio y sin fecha de cierre; o **sin fecha definida**, sin límites temporales. Son útiles para personas o vehículos que siguen siendo buscados. La modalidad no cambia automáticamente el estado del pedido: debe estar en curso para cargar capturas y sigue el circuito de revisión/entrega habitual.

**Editar fecha / búsqueda abierta** permite modificar pedidos existentes con los mismos permisos que el título. El cambio queda auditado y no admite reducir el período dejando capturas, revisiones o aportes fechados fuera de él. Los informes y listados muestran los límites abiertos sin inventar fechas. Cada captura conserva su fecha/hora; las búsquedas abiertas no admiten capturas futuras. Las consultas de HikCentral siempre requieren un intervalo concreto (grabaciones hasta 72 horas, patentes hasta 31 días); para períodos abiertos se precargan las últimas 24 horas, editables dentro de los límites informados. No se inicia vigilancia automática por seleccionar esta modalidad.

**Editar título**, debajo del nombre de la búsqueda, permite corregirlo sin cambiar su número ni sus registros. El personal de sala puede hacerlo en cualquier estado; un usuario externo sólo puede corregir su propio pedido mientras esté pendiente. Se conserva el título anterior y el autor del cambio en el historial. Si otro operador lo modificó mientras estaba abierto el formulario, se solicita volver a abrir la edición.

En una búsqueda **en curso**, debajo del mapa cada tramo entre capturas consecutivas tiene **Editar trazado y línea**. Arrastrar la línea agrega un punto en ese lugar; arrastrar los puntos blancos ajusta el recorrido. Clic derecho o Supr elimina un punto; **Deshacer punto** revierte hasta treinta pasos. Los extremos A/B permanecen anclados a las posiciones históricas de las capturas. **Empezar con línea directa** deja sólo esos extremos para dibujar un camino nuevo. El trazado manual no recalcula por calles ni impone manos de circulación: permite pasos peatonales, contramano y caminos que no figuran en el grafo. Admite hasta 5.000 puntos y 200 km por tramo; en trazados extensos se muestran hasta unos 250 puntos de control, pudiendo insertar nuevos al arrastrar cualquier parte de la línea.

El estilo se elige de forma independiente por tramo: **Continua**, **Discontinua**, **Punteada** o **Sin línea**. El estilo no modifica la certeza de las capturas. Se puede cambiar sólo el estilo conservando el cálculo automático. **Restablecer cálculo automático** elimina el trazado manual, la observación y el estilo elegido y vuelve al predeterminado discontinuo. Las ediciones, sus versiones y su autor se conservan en el historial; las escrituras concurrentes no sobrescriben cambios ajenos.

El mapa y los informes PDF conservan los trazados y estilos guardados, y distinguen los recorridos manuales de los calculados. KML conserva la geometría manual y omite los tramos sin línea; el estilo de guiones se describe como texto porque KML no lo representa. Un tramo marcado incierto sigue sin dibujarse: primero hay que retirar esa anotación para editarlo. Si se agrega o elimina una captura intermedia, el trazado antiguo no se aplica a un par diferente de eventos y aparece un aviso para revisar los tramos nuevos. Las búsquedas cerradas deben reabrirse para cambiar su recorrido.

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

## Informes de situación

En **INFORMES**, seleccionar cualquier búsqueda, en curso o cerrada. La portada presenta estado, período del evento, fecha de corte, indicadores y un mapa cuyos hitos corresponden a la cronología. El detalle incluye contexto, primeras y últimas apariciones confirmadas por objetivo, revisiones sin resultado, anotaciones de incertidumbre, aportes particulares y adjuntos de imagen. Los videos se enumeran para consultarlos en la búsqueda.

El reporte usa una lectura consistente de la base y queda fijo mientras se revisa. **Volver a generar** incorpora los cambios posteriores. Permite filtrar por objetivo, incluir u ocultar imágenes y sugerencias, y añadir una conclusión para esa emisión. La conclusión se conserva mientras esa vista permanezca abierta, pero no se guarda en la búsqueda ni en el servidor. El PDF descargado conserva el contenido emitido; la aplicación no almacena un historial de PDFs.

**Imprimir / guardar PDF** abre el diálogo del navegador. Elegir Guardar como PDF, papel A4 y desactivar encabezados y pies del navegador. El mapa es vectorial y usa las ubicaciones históricas de las capturas, sin depender de una captura WebGL o de servicios cartográficos externos. Los tramos inciertos no se dibujan y las demás líneas se identifican como estimaciones. Los puntos probables y dudosos se distinguen de los confirmados; los aportes particulares no se convierten en confirmaciones.

Las sugerencias, visibles sólo para la sala, se recalculan con el catálogo al generar el informe y usan dirección automática, horizonte de 15 minutos y los supuestos indicados en el propio reporte. No constituyen avistamientos ni garantizan disponibilidad histórica de grabación. Los externos sólo acceden a informes y adjuntos de su dependencia. El chat queda fuera del informe.

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

Guardar la configuración fuera del repositorio, en `~/.config/rastreo/production.env`, con permisos `600`:

```dotenv
DOMAIN=rastreo.ejemplo.gob.ar
POSTGRES_PASSWORD=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO
```

Usar una contraseña alfanumérica aleatoria larga para evitar problemas de escape en la URL de conexión. Apuntar el DNS al servidor y habilitar 80/443.

```sh
docker compose --env-file "$HOME/.config/rastreo/production.env" --env-file "$HOME/.config/rastreo/hikcentral.env" up -d --build
```

Las claves de HikCentral y My Maps se envían directamente desde esta PC por SSH a `~/.config/rastreo/hikcentral.env`. Ver [Claves privadas en producción](docs/PRODUCCION-CLAVES.md) para verificar, enviar y actualizar la configuración sin pasarla por Git. Si no se configuran integraciones, omitir el segundo `--env-file`.

Crear el administrador con las variables de bootstrap suministradas desde el entorno de la terminal:

```sh
docker compose --env-file "$HOME/.config/rastreo/production.env" --env-file "$HOME/.config/rastreo/hikcentral.env" exec -e BOOTSTRAP_USER -e BOOTSTRAP_PASSWORD app node --import tsx server/bootstrap.ts
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

El conector consulta `POST /artemis/api/resource/v1/cameras` con firma HMAC-SHA256 y todas sus páginas. Interpreta el campo `status` documentado como `0=desconocido`, `1=en línea`, `2=fuera de línea`. Requiere HTTPS y un certificado de confianza. Usar el nombre DNS incluido en el certificado, aunque el servicio esté en una IP privada. `scripts/start-local.ps1` agrega `--use-system-ca` cuando Node lo admite, para reconocer las autoridades ya confiables en Windows. Al iniciar manualmente con Node 24, se puede usar `node --use-system-ca --import tsx server/index.ts`. Si se usa otra CA privada, proporcionar su certificado con `NODE_EXTRA_CA_CERTS` al iniciar Node; no se desactiva la validación TLS.

La vinculación automática usa el prefijo `CAM-número` del nombre de HikCentral, sólo si es único. Para nombres distintos o números repetidos se puede configurar `HIK_CAMERA_MAPPING='{"276":"cameraIndexCode-en-HikCentral"}'`. No admite que dos números compartan el mismo identificador explícito. Cámaras sin correspondencia o sin permisos de lectura quedan sin información, nunca se consideran caídas por estar ausentes de la respuesta.

En **Red de cámaras**, el borde del punto indica conexión actual: verde en línea, rojo fuera de línea, gris sin información reciente. El relleno conserva los colores de capturas y revisiones. Una consulta fallida conserva los datos anteriores; después de tres intervalos (mínimo tres minutos) el estado se presenta como desconocido. Las respuestas incompletas no se aplican parcialmente. La conexión no garantiza imagen correcta ni grabación disponible. Las sugerencias de búsqueda histórica no excluyen cámaras por su estado actual.

### Grabaciones en la fecha del recorrido

Dentro de cada búsqueda, **Grabaciones para la fecha del recorrido** permite elegir una franja dentro del pedido (hasta 72 horas) y hasta 20 cámaras. El mapa del recorrido usa esta consulta histórica para sus bordes: verde indica intervalos que cubren toda la franja, ámbar cobertura parcial, rojo ausencia de archivos informados y gris consulta pendiente, fallida o vencida. La conexión presente se muestra aparte como **Ahora**. Las sugerencias de próximas cámaras consultan automáticamente la disponibilidad en el horario estimado de cada sugerencia, sin excluir cámaras por su estado actual.

Se usa `POST /artemis/api/video/v1/cameras/playbackURLs` con `cameraIndexCode`, `beginTime`, `endTime`, `recordType` y `mergeSegment=0`. El usuario asociado a OpenAPI requiere permisos de consulta/reproducción sobre esas cámaras. `HIK_RECORD_TYPE=0` consulta la grabación principal; `1` consulta la auxiliar. La respuesta sólo acredita el almacenamiento/tipo consultado, no todas las copias posibles. No se cambia la configuración de grabación. Esta consulta de disponibilidad sólo lee metadatos; la obtención de imágenes descrita abajo descarga un fragmento breve cuando el operador lo solicita.

El servidor recorre las páginas con `uuid`, valida los intervalos, recorta al horario solicitado, une solapamientos y muestra los huecos. Los horarios se envían con zona explícita `+00:00` y precisión de segundos, compatible con instalaciones que rechazan `Z` o milisegundos; se muestran en Argentina. Si el pedido incluye fracciones de segundo, se amplía la consulta al segundo anterior/siguiente y se recorta la cobertura al intervalo original. Las URLs y credenciales de reproducción se descartan y no llegan al navegador. Las consultas son para personal de sala autorizado, dentro de la franja del pedido, con hasta tres solicitudes simultáneas a HikCentral, cola acotada y caché de 30 segundos (10 para fallas). Los resultados visibles vencen a los cinco minutos y pueden volver a consultarse.

**Sin archivos encontrados** no significa que el equipo estuviera apagado: pudo no grabar, haberse borrado el video por retención o existir otra copia. Un equipo desconectado hoy puede tener video del hecho en un almacenamiento accesible. Si no se puede consultar el almacenamiento, hay un error de permisos o la respuesta no contiene intervalos verificables, se muestra **No verificable**. La existencia de intervalos no valida la calidad de la imagen ni prueba un avistamiento. No se reconstruye retrospectivamente el estado de conexión de la cámara.

Documentación oficial: [consulta histórica](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-25B1AA17-0A08-4AD0-8F21-CEE19F4E793C.html), [paginación y segmentos](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-D9894B27-3338-41A0-A17F-B53C6C792D87.html), [intervalos VideoInfo](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-0833665D-75F3-400E-87D6-BAF76A18D890.html). Cada instalación requiere sus propias credenciales y una verificación de catálogo y grabación real antes de dar por conectada la integración.

Contrato implementado según la documentación oficial de Hikvision: [habilitar OpenAPI](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-223990A6-B9D0-49FC-9249-3E24BC77F926.html), [autenticación](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-AC08DDFF-62E1-48F6-8D12-1DE85DDCDB20.html), [catálogo paginado](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-806B9EF1-0102-45BF-AC1D-C4A079DA4792.html) y [CameraInfo/status](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-5374ABDC-351D-4C41-B706-62622445E40E.html). Es necesario verificarlo contra la versión y permisos de la instalación antes de dar por conectada la integración real.

### Patentes e imágenes para capturas e informes

En una búsqueda, el personal de sala puede abrir **Buscar patente en HikCentral**, escribir la patente o tomarla de un objetivo y consultar un período dentro del pedido (máximo 31 días, sin horas futuras). Se descubren las cámaras con capacidad `event_veh` y se consultan sus lecturas históricas con `/artemis/api/pms/v1/crossRecords/page`. Se normalizan espacios, guiones y mayúsculas y se filtran coincidencias exactas. Cada cámara muestra si su consulta fue completa, parcial o falló. Hasta 32 cámaras, cinco páginas de 100 registros por cámara y 500 coincidencias por consulta; acotar el período si se alcanza un límite. Una consulta sin resultados no acredita que el vehículo no haya pasado.

Seleccionar una lectura permite **Ver foto de la lectura** (`/artemis/api/pms/v1/image`) e **Incorporar como captura** a un vehículo de la búsqueda. Por defecto queda probable: el operador debe valorar la lectura automática. Se puede adjuntar su foto junto con la captura; si la foto falla, la importación no se guarda y se puede volver a intentar o desmarcar esa opción. Se vincula por identificador HikCentral verificado; cuando no existe una correspondencia única, exige seleccionar una cámara del mapa explícitamente y conserva la asociación manual en el registro. Reimportar el mismo evento no lo duplica. La lectura original y su procedencia quedan en la captura y en la auditoría.

Cada captura tiene **Traer foto de grabación**. Permite consultar la hora registrada o ±2/±5 segundos, elegir entre las cámaras de esa captura, previsualizar el fotograma y **Adjuntar a la captura**. Se verifica cobertura histórica, se solicita un MP4 de hasta seis segundos con `/video/v1/download`, se espera `/video/v1/downloadURL` y se extrae el primer fotograma con FFmpeg. No se utiliza la captura en vivo. La hora solicitada se redondea hacia abajo al segundo y se conserva como tal: el primer fotograma puede tener desfase por codificación o por el reloj del equipo. Verificar visualmente la hora sobreimpresa cuando exista. No modifica la hora ni la certeza de la captura.

Los adjuntos conservan cámara, identificador de origen, fecha consultada o de lectura, fecha de obtención, almacenamiento consultado y hash SHA-256. Aparecen en la cronología y en **INFORMES → Incluir imágenes** al volver a generar el informe. Para incorporar capturas o adjuntos, la búsqueda debe estar en curso; las consultas también están disponibles en búsquedas cerradas, que pueden reabrirse mediante el flujo existente.

Se usan las mismas claves privadas de OpenAPI; habilitar permisos de consulta de lecturas ANPR, fotos, reproducción y descarga sobre los recursos correspondientes. `npm ci` instala el binario de `ffmpeg-static` para la plataforma; requiere acceso a su distribución de binarios en GitHub durante la instalación. El contenedor instala el binario Linux al construirse. El proxy de producción debe permitir solicitudes de hasta dos minutos. La integración de imágenes limita a dos operaciones simultáneas, 30 MB por fragmento y 10 MB por foto ANPR; los archivos temporales locales se eliminan al terminar. Las previsualizaciones y resultados privados vencen a los diez minutos o al reiniciar el servidor. Sólo las imágenes que el operador adjunta quedan guardadas. No se transmiten las claves, URLs de reproducción ni referencias privadas de las fotos al navegador. La descarga usa exclusivamente una ruta MP4 validada en el servidor HTTPS configurado, sin redirecciones.

Documentación oficial: [lecturas y fotos ANPR](https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/03-How%20to/How%20to%20get%20ANPR%20event%20from%20HCP%20via%20OpenAPI.pdf), [foto de lectura](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-5C0F1BD5-2AD6-410C-9526-DAFE6CFC4F13.html), [preparar descarga histórica](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-A80659B2-4FFE-4F16-88C0-48EB71C9BD5A.html), [obtener archivo preparado](https://enpinfo.hikvision.com/hkwsen/unzip/20240201150721_74009_doc/GUID-1DEFE0AF-3E01-4F41-93A8-C3D8C33AC39A.html).

## Pendientes respecto del concepto

- Telegram e infografía PNG independiente (el informe visual ya se puede guardar como PDF).
- PWA instalable y trabajo con conectividad intermitente.
- TOTP/2FA, retención configurable, prioridades y plazos y modo evidencia.
- Edición de registros existentes con historial de versiones: hoy se corrigen ocultando el registro y agregando uno nuevo.
- Menciones a usuarios desconectados: actualmente se elige entre los presentes.
- Teselas PMTiles: el mapa inicial usa GeoJSON local de las calles extraídas del prototipo.

El ruteo es una estimación, no una observación del trayecto: conecta el punto más cercano de cada captura al grafo, sigue la ruta de menor distancia y advierte si requiere contramano. El sentido escrito por el operador queda documentado pero todavía no condiciona el algoritmo. No modela restricciones de giro, cortes temporales ni validación del sentido de todas las calles. Para personas ignora la mano vehicular; no es todavía una red peatonal dedicada. Si no hay conexión o las cámaras de un mismo instante están demasiado separadas, muestra un aviso sin inventar un tramo. Las revisiones de la cámara se muestran como resumen visual; los intervalos exactos se consultan en la pestaña Revisiones.

Antes de un uso operativo: validar cartografía, permisos y flujos con la sala y verificar el despliegue y la restauración en el datacenter.

El documento fuente completo está conservado en [docs/CONCEPTO.md](docs/CONCEPTO.md). La lista anterior describe el alcance realmente implementado; las etapas del concepto son la hoja de ruta.
