import fs from "node:fs";
import { config } from "dotenv";
import { createSql } from "../lib/db";
import { importPlaces, parseOverpass } from "../lib/osm";

config();

const [file, countryArg] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run import:osm -- data/istanbul.json [TR]");
  process.exit(1);
}
const country = countryArg ? countryArg.toUpperCase() : null;
if (country && !/^[A-Z]{2}$/.test(country)) {
  console.error("COUNTRY_CODE must be two letters, for example TR");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const seeds = parseOverpass(JSON.parse(fs.readFileSync(file, "utf8"))).map((s) => ({ ...s, country_code: country }));
console.log(`parsed ${seeds.length} places from ${file}`);

const sql = createSql(url);
try {
  let written = 0;
  for (let i = 0; i < seeds.length; i += 1000) written += await importPlaces(sql, seeds.slice(i, i + 1000));
  console.log(`wrote ${written} places`);
} finally {
  await sql.end();
}
