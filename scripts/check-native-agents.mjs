import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {preparePlayground,root} from './playground.mjs';
const config=mkdtempSync(join(root,'playground','native-agents-'));
const env=preparePlayground(config,{ui:{restoreTabs:false,notifications:false}});
const app=spawn(join(root,'build/bin/atc.exe'),[],{windowsHide:false,stdio:'inherit',env:{...process.env,...env,ATC_SHELL_NO_PROFILE:'1'}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ps=(script,args)=>execFileSync('pwsh',['-NoProfile','-File',`scripts/${script}.ps1`,...args],{windowsHide:true,stdio:'inherit'});
const keys=k=>ps('sendkeys',['-ProcessId',String(app.pid),'-Keys',k,'-SettleMs','800']);
try {
 await delay(10000);
 for(const provider of ['claude','codex']) {
  keys('^+a');keys(provider==='claude'?'{ENTER}':'{TAB}{ENTER}');await delay(10000);
  ps('shot',['-ProcessId',String(app.pid),'-Out',`benchmarks/wails-native-${provider}-startup.png`]);
  keys('^c');keys('^c');await delay(1000);
 }
 keys('%{F4}');await delay(1500);
} finally {try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
