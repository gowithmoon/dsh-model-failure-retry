// Bundle src/client into client.js wrapped for DSH's browser module loader.
// react, react/jsx-runtime and the UI primitives are provided by the host page.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const result = await build({
  entryPoints: [new URL('../src/client/index.jsx', import.meta.url).pathname],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  write: false,
  legalComments: 'none',
});
const body = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${body}
return module.exports;
} });
`;
await writeFile(new URL('../client.js', import.meta.url), wrapped);
console.log(`client.js: ${wrapped.length} bytes`);
