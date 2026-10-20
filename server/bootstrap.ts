import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import argon2 from "argon2";
import { database } from "./db.ts";
import { importCameras } from "./cameras.ts";

const username = process.env.BOOTSTRAP_USER?.toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
if (
  !username ||
  !/^[a-z0-9._-]{3,80}$/.test(username) ||
  !password ||
  password.length < 12
) {
  throw new Error(
    "Configurar BOOTSTRAP_USER y BOOTSTRAP_PASSWORD (mínimo 12 caracteres)",
  );
}
const db = await database();
try {
  const existing = (
    await db.query("SELECT id FROM users WHERE username=$1", [username])
  ).rows[0];
  if (existing)
    throw new Error("El usuario ya existe. No se modificó su clave.");
  const userId = randomUUID();
  await db.transaction(async (tx) => {
    const department = (
      await tx.query(
        "SELECT id FROM departments WHERE name='Municipalidad de Río Tercero'",
      )
    ).rows[0];
    const depId = department?.id || randomUUID();
    if (!department)
      await tx.query("INSERT INTO departments(id,name,kind) VALUES($1,$2,$3)", [
        depId,
        "Municipalidad de Río Tercero",
        "municipal",
      ]);
    await tx.query(
      "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        userId,
        "Administrador",
        username,
        await argon2.hash(password),
        "admin",
        depId,
      ],
    );
  });
  console.log(`Administrador creado: ${username}`);
  if (process.env.CAMERA_KML) {
    const source = await readFile(process.env.CAMERA_KML, "utf8");
    console.log(
      await importCameras(
        db,
        source,
        userId,
        process.env.QUARANTINE_DUPLICATES === "true",
      ),
    );
  }
} finally {
  await db.close();
}
