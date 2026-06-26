#!/usr/bin/env node
// Dev launcher for the Electron client.
//
// VSCode (and some IDE terminals) export ELECTRON_RUN_AS_NODE=1 for their node
// subprocesses. If that leaks into `electron .`, Electron starts as plain Node
// with no GUI — `app` is undefined and the app crashes at `app.whenReady()`.
// Strip the var here so `npm start` works from any terminal or IDE.
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
