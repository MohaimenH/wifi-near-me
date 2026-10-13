// MapLibre 6 loads its web worker from a separate file. A bundled app must serve that file itself,
// so this copies it into public/ after every install (the path in components/MapView.tsx).
import fs from "node:fs";
import path from "node:path";

const from = path.join("node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const to = path.join("public", "maplibre-gl-worker.mjs");
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log(`copied ${from} -> ${to}`);
