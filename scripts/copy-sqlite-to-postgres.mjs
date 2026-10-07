// Copies every table from the SQLite development database into a PostgreSQL database that already has the
// CareHub schema (prisma migrate deploy). Column types come from prisma/schema.prisma, so DateTime (stored as
// epoch milliseconds in SQLite) and Boolean (0/1) are converted. Foreign-key checks are relaxed for the load.
//
//   node scripts/copy-sqlite-to-postgres.mjs prisma/dev.db "postgresql://user:pw@localhost:5432/carehub_test"
//
// Run it once per database; it truncates the target tables first.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const [sqlitePath, pgUrl] = process.argv.slice(2);
if (!sqlitePath || !pgUrl) {
  console.error("usage: node scripts/copy-sqlite-to-postgres.mjs <sqlite file> <postgres url>");
  process.exit(1);
}

// ---- schema: model -> { field -> type } for scalar columns
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const models = new Map();
for (const m of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
  const fields = new Map();
  for (const raw of m[2].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [name, typeRaw] = parts;
    const type = typeRaw.replace(/[?\[\]]/g, "");
    const isList = typeRaw.endsWith("[]");
    const scalar = ["String", "Int", "Float", "Boolean", "DateTime", "BigInt", "Decimal", "Json", "Bytes"].includes(type);
    // A relation field (type is another model) has no column; a scalar list is not used in this schema.
    if (scalar && !isList) fields.set(name, type);
  }
  models.set(m[1], fields);
}

// ---- SQLite side
const src = new DatabaseSync(sqlitePath, { readOnly: true });
const tables = src
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'")
  .all()
  .map((r) => r.name)
  .filter((t) => models.has(t));

// ---- PostgreSQL side
const client = new pg.Client({ connectionString: pgUrl });
await client.connect();
await client.query("SET session_replication_role = replica"); // skip FK checks while loading
// Empty every target table in one statement first: a per-table TRUNCATE ... CASCADE would wipe tables loaded earlier.
await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
let total = 0;
for (const table of tables) {
  const fields = models.get(table);
  const cols = src.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name).filter((c) => fields.has(c));
  const rows = src.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${table}"`).all();
  if (rows.length === 0) continue;
  const convert = (c, v) => {
    if (v === null || v === undefined) return null;
    switch (fields.get(c)) {
      case "DateTime":
        return typeof v === "number" ? new Date(v) : new Date(String(v));
      case "Boolean":
        return v === 1 || v === true || v === "1" || v === "true";
      case "Int":
        return Number(v);
      case "Float":
        return Number(v);
      default:
        return typeof v === "bigint" ? v.toString() : v;
    }
  };
  const batch = 200;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values = [];
    const tuples = chunk.map((row, r) => `(${cols.map((c, k) => { values.push(convert(c, row[c])); return `$${r * cols.length + k + 1}`; }).join(", ")})`);
    await client.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`, values);
  }
  total += rows.length;
  console.log(`${table}: ${rows.length}`);
}
await client.query("SET session_replication_role = DEFAULT");
await client.end();
src.close();
console.log(`done: ${total} rows across ${tables.length} tables`);
