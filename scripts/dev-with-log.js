const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const logFile = path.join(process.cwd(), 'dev.log');
const stream = fs.createWriteStream(logFile, { flags: 'a' });
const nextCli = require.resolve('next/dist/bin/next');

function getListeningPid(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }

    execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      const lines = stdout.split(/\r?\n/);
      const match = lines.find((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
      if (!match) {
        resolve(null);
        return;
      }

      const pid = match.trim().split(/\s+/).pop();
      resolve(pid && /^\d+$/.test(pid) ? Number(pid) : null);
    });
  });
}

function killProcess(pid) {
  return new Promise((resolve) => {
    if (!pid || process.platform !== 'win32') {
      resolve(false);
      return;
    }

    execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

(async () => {
  const preferredPort = parseInt(process.env.PORT || process.env.npm_config_port || '3000', 10);
  const stalePid = await getListeningPid(preferredPort);
  if (stalePid) {
    await killProcess(stalePid);
  }

  const child = spawn(process.execPath, [nextCli, 'dev', '-p', String(preferredPort)], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(preferredPort) },
    shell: false,
  });

  function writeChunk(chunk, streamTarget) {
    const text = chunk.toString();
    if (!text) return;
    streamTarget.write(text);
    stream.write(text);
  }

  child.stdout.on('data', (chunk) => writeChunk(chunk, process.stdout));
  child.stderr.on('data', (chunk) => writeChunk(chunk, process.stderr));

  const shutdown = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  child.on('error', (error) => {
    console.error(error.message);
    stream.end();
    process.exit(1);
  });

  child.on('exit', (code) => {
    stream.end();
    process.exit(code ?? 0);
  });
})();
