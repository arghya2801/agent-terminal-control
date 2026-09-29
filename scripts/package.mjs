import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { root } from './playground.mjs';
if (!process.env.PACKAGE_SKIP_BUILD) execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const local = process.env.LOCALAPPDATA || '';
const paths = (process.env.PATH || '').split(delimiter);
function tool(name, extra) { const found = [...paths, ...extra].map((p) => join(p, name)).find(existsSync); if (!found) throw new Error(`${name} missing: install NSIS and WiX Toolset 3.x`); return found; }
const nsis = tool('makensis.exe', [process.env.NSIS_HOME || '', join(local, 'tauri', 'NSIS'), 'C:/Program Files (x86)/NSIS']);
const wix = [process.env.WIX ? join(process.env.WIX, 'bin') : '', join(local, 'tauri', 'WixTools314'), 'C:/Program Files (x86)/WiX Toolset v3.14/bin'];
const candle = tool('candle.exe', wix), light = tool('light.exe', wix);
const binary = join(root, 'build/bin/atc.exe'), icon = join(root, 'packaging/icon.ico');
const output = join(root, 'build/bin'); mkdirSync(output, { recursive: true });
execFileSync(nsis, [`/DVERSION=${version}`, `/DBINARY=${binary}`, `/DICON=${icon}`, `/DOUTPUT=${join(output, `ATC_${version}_x64-setup.exe`)}`, join(root, 'packaging/atc.nsi')], { stdio: 'inherit', windowsHide: true });
const object = join(output, 'atc.wixobj');
execFileSync(candle, ['-nologo', '-arch', 'x64', `-dVersion=${version}`, `-dBinary=${binary}`, `-dIcon=${icon}`, `-dLicense=${join(root, 'packaging/install.rtf')}`, '-out', object, join(root, 'packaging/atc.wxs')], { stdio: 'inherit', windowsHide: true });
execFileSync(light, ['-nologo', '-ext', 'WixUIExtension', '-out', join(output, `ATC_${version}_x64_en-US.msi`), object], { stdio: 'inherit', windowsHide: true });
