const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('http');
const FormData = require('form-data');
const getPort = require('get-port');

async function dynamicImport(module) {
  return await import(module);
}

async function startServer(logfile, flags, postUrl, key, homeyId, appId, startPort = 8008) {
  const { hookStd } = await import('hook-std');
  const { default: fetch } = await dynamicImport('node-fetch');
  const fh = await fs.open(logfile, flags);

  // 지정된 시작 포트부터 +100까지 포트 범위를 설정
  const port = await getPort({ port: getPort.makeRange(startPort, startPort + 100) });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      createReadStream(logfile).pipe(res);

      try {
        const formData = new FormData();
        formData.append('logFile', createReadStream(logfile), 'std.log');
        await fetch(postUrl, {
          method: 'POST',
          headers: {
            'x-service-key': key,
            'homeyId': homeyId,
            'appId': appId,
            ...formData.getHeaders()
          },
          body: formData
        });
        await fs.writeFile(logfile, '', { encoding: 'utf8' });
        console.log('File sent and cleared successfully');
      } catch (error) {
        console.error('Failed to send file:', error);
      }
    });

    server.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
      resolve(port);
    });

    server.on('error', (error) => {
      reject(error);
    });

    hookStd({ silent: false }, output => { fh.write(output) });
  });
}

module.exports = async (config) => {
  const port = await startServer(
    config.logfile || '/userdata/std.log',
    config.flags || 'a',
    config.postUrl || "",
    config.key || "",
    config.homeyId || "unknown",
    config.appId || "unknown",
    config.port || 8008 // 기본 시작 포트를 config에서 설정 가능
  );
  console.log(`Server successfully started on port: ${port}`);
  return port;
}