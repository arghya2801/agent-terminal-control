// Prints the runtime.go constants for a Bun release: `bun scripts/pin-bun.mjs 1.4.5`.
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('usage: bun scripts/pin-bun.mjs <version>, e.g. 1.4.5');
const res = await fetch(`https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt`);
if (!res.ok) throw new Error(`SHASUMS256.txt for ${version}: HTTP ${res.status}`);
const sums = Object.fromEntries((await res.text()).trim().split('\n').map((l) => l.trim().split(/\s+/).reverse()));
const pick = (asset) => sums[asset] ?? (() => { throw new Error(`no ${asset} in ${version}`); })();
console.log(`bunVersion = "${version}"
true:  {"bun-windows-x64.zip", "${pick('bun-windows-x64.zip')}"},
false: {"bun-windows-x64-baseline.zip", "${pick('bun-windows-x64-baseline.zip')}"},`);
