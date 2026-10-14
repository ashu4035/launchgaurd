const {spawn} = require('node:child_process');
const {join, delimiter} = require('node:path');
const {existsSync} = require('node:fs');

const cli = join(process.env.APPDATA || '', 'npm', 'node_modules', '@webflow', 'webflow-cli', 'dist', 'index.js');
if (!existsSync(cli)) {
  console.error('Webflow CLI was not found in the Windows npm installation.');
  process.exit(1);
}
const child = spawn(process.execPath, [cli, 'extension', 'serve', '1337'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: {...process.env, NODE_PATH: [join(__dirname, '../../node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter)},
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
