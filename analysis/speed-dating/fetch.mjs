// Usage: node fetch.mjs <url> <outFile>
import { writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
const buf = Buffer.from(await res.arrayBuffer());
console.log(res.status, res.headers.get('content-type'), buf.length, 'bytes');
if (res.ok) writeFileSync(out, buf);
