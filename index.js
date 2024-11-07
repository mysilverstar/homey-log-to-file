const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('http');
const FormData = require('form-data'); // FormData 라이브러리 사용

async function dynamicImport(module) {
  return await import(module);
}

async function startServer(logfile, port, flags, postUrl, key, homeyId, appId, retryCount = 0, maxRetries = 10) {
  const { hookStd } = await import('hook-std');
  const { default: fetch } = await dynamicImport('node-fetch');
  const fh = await fs.open(logfile, flags);

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

    server.on('error', async (error) => {
      if (error.code === 'EADDRINUSE') {
        if (retryCount < maxRetries) {
          console.log(`Port ${port} is in use, trying port ${port + 1}`);
          resolve(startServer(logfile, port + 1, flags, postUrl, key, homeyId, appId, retryCount + 1, maxRetries));
        } else {
          reject(new Error(`Failed to start server after ${maxRetries} attempts. Please check port availability.`));
        }
      } else {
        reject(error);
      }
    });

    server.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
      resolve(port); // 성공적으로 포트가 열렸을 때 해당 포트를 반환
    });

    hookStd({ silent: false }, output => { fh.write(output) });
  });
}

module.exports = async (config) => {
  const port = await startServer(
    config.logfile || '/userdata/std.log',
    config.port || 8008,
    config.flags || 'a',
    config.postUrl || "",
    config.key || "",
    config.homeyId || "unknown",
    config.appId || "unknown"
  );
  console.log(`Server successfully started on port: ${port}`);
  return port;
}