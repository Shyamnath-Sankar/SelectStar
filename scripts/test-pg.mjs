import { Pool } from "pg";

const connStr = "postgresql://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs";
console.log("connectionString:", connStr);

const pool = new Pool({ connectionString: connStr, max: 2, connectionTimeoutMillis: 8000 });

console.log("Pool created. Attempting query...");
try {
  const client = await pool.connect();
  console.log("Connected OK");
  const res = await client.query("SELECT current_database() as db, version() as v");
  console.log("db:", res.rows[0].db);
  console.log("version:", res.rows[0].v.slice(0, 60));
  client.release();
  await pool.end();
} catch (e) {
  console.log("ERROR code:", e.code);
  console.log("ERROR message:", e.message);
  console.log("ERROR errno:", e.errno);
  console.log("ERROR syscall:", e.syscall);
  console.log("ERROR address:", e.address);
  console.log("ERROR port:", e.port);
  console.log("ERROR host:", e.host);
  try { await pool.end(); } catch {}
}
