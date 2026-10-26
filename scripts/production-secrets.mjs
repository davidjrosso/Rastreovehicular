import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parse } from "dotenv";

export const allowedKeys = [
  "HIK_OPENAPI_URL",
  "HIK_APP_KEY",
  "HIK_APP_SECRET",
  "HIK_INTERVAL_SECONDS",
  "HIK_RECORD_TYPE",
  "HIK_CAMERA_MAPPING",
  "MY_MAPS_ID",
  "MY_MAPS_INTERVAL_SECONDS",
];

// Only integration settings are transferred: never DB passwords, accounts or local paths.
export function integrationEnv(source) {
  if (Buffer.byteLength(source, "utf8") > 1024 * 1024)
    throw new Error("El archivo de configuración es demasiado grande.");
  const parsed = parse(source);
  for (const key of ["HIK_OPENAPI_URL", "HIK_APP_KEY", "HIK_APP_SECRET"])
    if (!parsed[key]?.trim())
      throw new Error(`Falta ${key} en el archivo local.`);
  let url;
  try {
    url = new URL(parsed.HIK_OPENAPI_URL);
  } catch {
    throw new Error("HIK_OPENAPI_URL no es una dirección válida.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/artemis", "/artemis/"].includes(url.pathname)
  )
    throw new Error(
      "HIK_OPENAPI_URL debe ser HTTPS, sin credenciales ni rutas del portal.",
    );
  const selected = allowedKeys.filter((key) => parsed[key] !== undefined);
  const lines = selected.map((key) => {
    const value = parsed[key];
    // Compose single quotes preserve $, # and spaces without interpolation.
    // Refuse ambiguous escapes instead of silently changing a credential.
    if (/[\x00-\x1f\x7f'\\]/.test(value) || value.length > 20000)
      throw new Error(
        `${key} contiene caracteres no admitidos para este formato de traslado.`,
      );
    return `${key}='${value}'`;
  });
  return {
    content:
      "# Configuración privada de integraciones. No versionar.\n" +
      lines.join("\n") +
      "\n",
    keys: selected,
  };
}

export function remoteInstallCommand(replace = false, byteLength) {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > 1024 * 1024
  )
    throw new Error("Tamaño de configuración inválido.");
  // Fixed destination, outside the checkout. Data arrives on stdin, never in shell arguments.
  return `set -eu
umask 077
fail() { printf '%s\\n' "$1" >&2; exit 1; }
test -n "\${HOME:-}" || fail 'No se pudo determinar el directorio personal remoto.'
test ! -L "$HOME/.config" || fail 'El directorio .config no puede ser un enlace simbólico.'
mkdir -p "$HOME/.config"
private_dir="$HOME/.config/rastreo"
test ! -L "$private_dir" || fail 'El directorio privado no puede ser un enlace simbólico.'
if test -d "$private_dir"; then
  test "$(stat -c %u "$private_dir")" = "$(id -u)" || fail 'El directorio privado pertenece a otro usuario.'
else
  mkdir "$private_dir"
fi
command -v git >/dev/null 2>&1 || fail 'Se requiere Git remoto para verificar que el destino esté fuera de un repositorio.'
if git -C "$private_dir" rev-parse --git-dir >/dev/null 2>&1; then
  fail 'El destino está dentro de un repositorio. No se guardaron claves.'
fi
chmod 700 "$private_dir"
target="$private_dir/hikcentral.env"
test ! -L "$target" || fail 'El archivo de destino no puede ser un enlace simbólico.'
if test -e "$target"; then
  test -f "$target" || fail 'El destino no es un archivo regular.'
  ${replace ? ": # Reemplazo solicitado explícitamente." : "fail 'Ya existe una configuración. Para actualizarla, repetí con --replace.'"}
fi
tmp=$(mktemp "$private_dir/.hikcentral.XXXXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
cat > "$tmp"
test -s "$tmp" || fail 'No se recibió configuración; se conserva el archivo anterior.'
test "$(wc -c < "$tmp")" -eq ${byteLength} || fail 'La transferencia está incompleta; se conserva el archivo anterior.'
chmod 600 "$tmp"
${replace ? 'mv -f "$tmp" "$target"' : 'ln "$tmp" "$target"'}
printf '%s\\n' "Configuración privada instalada en $target (permisos 600)."
`.replace(/\r\n/g, "\n");
}

export function sshArguments({
  host,
  port = "22",
  replace = false,
  byteLength,
}) {
  if (
    !host ||
    !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(host)
  )
    throw new Error(
      "Indicá --host usuario@servidor o un alias de tu configuración SSH.",
    );
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("El puerto SSH debe estar entre 1 y 65535.");
  return [
    "-T",
    "-p",
    String(port),
    "--",
    host,
    remoteInstallCommand(replace, byteLength),
  ];
}

export async function sendConfig(content, args, spawnProcess = spawn) {
  await new Promise((resolvePromise, reject) => {
    // SSH keeps its normal host-key and authentication checks. No credentials in argv or logs.
    const child = spawnProcess("ssh", args, {
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    });
    child.on("error", () =>
      reject(
        new Error(
          "No se pudo iniciar SSH. Instalá OpenSSH y verificá la conexión al servidor.",
        ),
      ),
    );
    child.stdin.on("error", () => {
      /* SSH reports connection failures through its exit status. */
    });
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              "La transferencia no terminó correctamente. Revisá el mensaje de SSH; no se publicaron claves en Git.",
            ),
          ),
    );
    child.stdin.end(content);
  });
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      env: { type: "string", default: ".env" },
      host: { type: "string" },
      port: { type: "string", default: "22" },
      replace: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || !positionals.length) {
    console.log(
      "Uso:\n  node scripts/production-secrets.mjs check [--env .env]\n  node scripts/production-secrets.mjs send --host usuario@servidor [--port 22] [--env .env] [--replace]\n\nLee sólo las variables de HikCentral y My Maps. Las envía por SSH a ~/.config/rastreo/hikcentral.env del usuario remoto. No imprime valores ni escribe una copia local.",
    );
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || !["check", "send"].includes(command))
    throw new Error("Comando desconocido. Usá check o send.");
  let source;
  try {
    source = await readFile(resolve(values.env), "utf8");
  } catch {
    throw new Error("No se pudo leer el archivo de configuración local.");
  }
  const config = integrationEnv(source);
  const args =
    command === "send"
      ? sshArguments({
          ...values,
          byteLength: Buffer.byteLength(config.content),
        })
      : null;
  console.log(
    `Configuración validada: ${config.keys.join(", ")}. Valores ocultos.`,
  );
  if (args) await sendConfig(config.content, args);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch(() => {
    // Parser/OS errors can echo arguments. Never print unfiltered exception messages.
    console.error(
      "No se pudo completar la operación. Verificá el archivo local, los parámetros y la salida de SSH. Usá --help para ver el formato.",
    );
    process.exitCode = 1;
  });
}
