export type Kind = 'comment' | 'string' | 'number' | 'keyword';
export interface Token { text: string; kind: Kind | null }

const KEYWORDS = new Set(
  ('as async await break case catch class const continue def default defer del do elif else enum export extends false fn for foreach from func function go if impl import in interface is lambda let match mut new nil none not null of or and package param pass pub raise return self static struct switch this throw true try type undefined use var void while with yield')
    .split(' '),
);
const HASH = /^(py|python|sh|bash|zsh|shell|ps1|powershell|pwsh|ya?ml|toml|rb|ruby|r|dockerfile|makefile|conf|ini)$/i;
const NO_SLASH = /^(py|python|sh|bash|zsh|shell|ps1|powershell|pwsh|ya?ml|toml|rb|ruby|r|html|xml|md|markdown|json|dockerfile|makefile|conf|ini)$/i;
const PLAIN = /^(text|txt|plain|plaintext|console|output|log|diff|md|markdown|csv)$/i;

export function tokens(code: string, lang: string | null | undefined): Token[] {
  if (!lang || PLAIN.test(lang)) return [{ text: code, kind: null }];
  const comments = [!NO_SLASH.test(lang) && String.raw`//.*|/\*[\s\S]*?\*/`, HASH.test(lang) && '#.*', '<!--[\\s\\S]*?-->'].filter(Boolean).join('|');
  const re = new RegExp(String.raw`(${comments})|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|` + '`(?:\\\\.|[^`\\\\])*`' + String.raw`)|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)`, 'g');
  const out: Token[] = [];
  let at = 0;
  for (const m of code.matchAll(re)) {
    const kind: Kind | null = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'number' : KEYWORDS.has(m[4].toLowerCase()) ? 'keyword' : null;
    if (!kind) continue;
    if (m.index > at) out.push({ text: code.slice(at, m.index), kind: null });
    out.push({ text: m[0], kind });
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push({ text: code.slice(at), kind: null });
  return out;
}
