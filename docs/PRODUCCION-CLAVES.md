# Claves privadas en producción

El comando copia las variables de HikCentral y My Maps del `.env` de esta PC al **servidor Linux de la aplicación**, mediante SSH. No es necesario copiarlas a GitHub ni escribirlas en la línea de comandos. El servidor de la aplicación puede ser distinto del servidor de HikCentral.

Requiere Node.js 24 y OpenSSH en la PC; SSH y Git en el servidor Linux. Usa la autenticación y la verificación de identidad habituales de SSH, incluida la configuración de `~/.ssh/config`. En el primer acceso, verificar la huella del servidor con su administrador.

## 1. Revisar y enviar desde esta PC

Desde la carpeta del proyecto, en PowerShell:

```powershell
.\scripts\send-production-secrets.ps1 -Check
.\scripts\send-production-secrets.ps1 -Server usuario@SERVIDOR_PRODUCCION
```

Reemplazar `usuario@SERVIDOR_PRODUCCION` por el destino SSH real. Para otro puerto agregar `-Port 2222`. Si se ejecuta sin `-Server`, lo pregunta. El chequeo sólo imprime los nombres de las variables, nunca sus valores. En Windows el script también puede usar el Node compatible incluido con Codex.

Alternativa con Node en el PATH, desde cualquier sistema:

```sh
npm run secrets:check
npm run secrets:send -- --host usuario@SERVIDOR_PRODUCCION
```

Se transfieren únicamente `HIK_OPENAPI_URL`, `HIK_APP_KEY`, `HIK_APP_SECRET`, `HIK_INTERVAL_SECONDS`, `HIK_RECORD_TYPE`, `HIK_CAMERA_MAPPING`, `MY_MAPS_ID` y `MY_MAPS_INTERVAL_SECONDS` que existan en el archivo local. No se transfieren la contraseña de la base, las credenciales de bootstrap ni la configuración local del servidor. Las tres primeras son obligatorias. El formato preserva signos `$`, `#` y espacios; rechaza saltos de línea, comillas simples y barras invertidas para evitar cambios silenciosos en las claves.

El destino fijo es `~/.config/rastreo/hikcentral.env`, dentro de la cuenta SSH elegida. El directorio queda con permisos `700` y el archivo con `600`. La herramienta rechaza destinos dentro de un repositorio y enlaces simbólicos. No sobrescribe un archivo existente salvo que se indique `-Replace` (o `--replace` en npm). La instalación es atómica y un envío vacío conserva el archivo anterior.

## 2. Cargarlo en Docker Compose

Estos pasos se ejecutan **en el servidor**, con la misma cuenta que recibió las claves. Mantener también la configuración general fuera del repositorio:

```sh
umask 077
mkdir -p "$HOME/.config/rastreo"
chmod 700 "$HOME/.config/rastreo"
nano "$HOME/.config/rastreo/production.env"
chmod 600 "$HOME/.config/rastreo/production.env"
```

En ese archivo guardar `DOMAIN` y `POSTGRES_PASSWORD`. Ejemplo de estructura, con valores a reemplazar en el editor:

```dotenv
DOMAIN=rastreo.ejemplo.gob.ar
POSTGRES_PASSWORD=REEMPLAZAR_POR_LA_CLAVE_DE_PRODUCCION
```

En una instalación existente, conservar **la contraseña que ya usa PostgreSQL**: cambiarla en este archivo no cambia la del volumen de la base. Para una instalación nueva usar una contraseña alfanumérica aleatoria larga, compatible con la URL de conexión. Configurar DNS y los puertos 80/443 como indica el README.

Desde la carpeta del repositorio en el servidor:

```sh
# Evita que variables antiguas de esta terminal reemplacen las del archivo privado.
unset HIK_OPENAPI_URL HIK_APP_KEY HIK_APP_SECRET HIK_INTERVAL_SECONDS HIK_RECORD_TYPE HIK_CAMERA_MAPPING MY_MAPS_ID MY_MAPS_INTERVAL_SECONDS DOMAIN POSTGRES_PASSWORD

docker compose --env-file "$HOME/.config/rastreo/production.env" --env-file "$HOME/.config/rastreo/hikcentral.env" config --quiet
docker compose --env-file "$HOME/.config/rastreo/production.env" --env-file "$HOME/.config/rastreo/hikcentral.env" up -d --build
```

Usar estos mismos dos argumentos `--env-file` en las demás operaciones de Compose, incluido el bootstrap del README. `config --quiet` valida sin mostrar valores; `config` sin esa opción imprime la configuración resuelta, incluidas las claves.

Compose carga ambos archivos y entrega las variables al contenedor mediante el `compose.yaml` existente. La precedencia está documentada por [Docker](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

## 3. Verificar y actualizar

Abrir **Administración → Sincronización de cámaras → Consultar estados** y comprobar una consulta de grabaciones para una fecha conocida. El servidor debe alcanzar HikCentral por la red municipal o VPN y confiar en su certificado HTTPS. La confianza instalada en Windows no se copia al contenedor Linux; si necesita una CA privada, instalarla o montar su certificado y configurar `NODE_EXTRA_CA_CERTS`, como indica el README.

Cuando cambien las claves, actualizar el `.env` local y ejecutar en esta PC:

```powershell
.\scripts\send-production-secrets.ps1 -Server usuario@SERVIDOR_PRODUCCION -Replace
```

Luego, desde el repositorio del servidor, con las variables de terminal limpiadas como en el paso anterior:

```sh
docker compose --env-file "$HOME/.config/rastreo/production.env" --env-file "$HOME/.config/rastreo/hikcentral.env" up -d --no-deps --force-recreate app
```

Recrear el contenedor aplica las nuevas variables; `restart` por sí solo conserva las anteriores. No elimina la base ni los adjuntos.

## Qué queda protegido

Las claves viajan cifradas por SSH y no aparecen en los argumentos del proceso ni en una copia de exportación local. Se guardan como texto en un archivo privado del servidor, accesible a su propietario y a administradores del sistema. Los administradores de Docker también pueden consultar el entorno del contenedor.

`.gitignore` y `.dockerignore` excluyen `.env*`, `production.env`, `hikcentral.env` y las carpetas `secrets` y `.secrets`. Sólo `.env.example`, con campos vacíos, se conserva en Git. Estas reglas evitan agregados normales y copias al contexto de construcción; no borran secretos de un historial anterior ni impiden un `git add -f` deliberado. Los respaldos de configuración deben tratarse como privados.
