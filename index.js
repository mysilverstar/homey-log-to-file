const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const http = require('http');
const FormData = require('form-data');
const getPort = require('get-port');
const archiver = require('archiver');
const path = require('path');

// 로그 파일 이름 생성
function generateLogFileName(basePath) {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  return path.join(basePath, `std_${timestamp}.log`);
}

// 오래된 파일 삭제
async function deleteOldFiles(directory, retentionDays = 15) {
  const files = await fs.readdir(directory);
  const now = Date.now();
  for (const file of files) {
    if (file.startsWith('std_')) {
      const filePath = path.join(directory, file);
      const stats = await fs.stat(filePath);
      const age = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      if (age > retentionDays) {
        await fs.unlink(filePath);
        console.log(`Deleted old log file: ${filePath}`);
      }
    }
  }
}

// 오래된 파일 삭제 (기준: 분 단위)
// async function deleteOldFiles(directory, retentionMinutes = 1) {
//   const files = await fs.readdir(directory);
//   const now = Date.now();

//   for (const file of files) {
//     if (file.startsWith('std_')) {
//       const filePath = path.join(directory, file);
//       const stats = await fs.stat(filePath);
//       const ageInMinutes = (now - stats.mtimeMs) / (1000 * 60); // 파일 나이 계산 (분 단위)

//       if (ageInMinutes > retentionMinutes) {
//         await fs.unlink(filePath);
//         console.log(`Deleted old log file: ${filePath}`);
//       }
//     }
//   }
// }

// 로그 파일 압축
async function compressLogs(directory) {
  const files = await fs.readdir(directory);
  const outputFile = path.join(directory, 'logs.zip');

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Compressed ${archive.pointer()} total bytes into: ${outputFile}`);
      resolve(outputFile);
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // std_로 시작하는 모든 로그 파일 추가
    files
      .filter(file => file.startsWith('std_'))
      .forEach(file => archive.file(path.join(directory, file), { name: file }));

    archive.finalize();
  });
}

async function startServer(logDirectory, flags, postUrl, key, homeyId, appId, startPort = 8008) {
  const { hookStd } = await import('hook-std');
  const { default: fetch } = await import('node-fetch');

  // 로그 파일 이름 생성
  const logfile = generateLogFileName(logDirectory);
  const fh = await fs.open(logfile, flags);

  // 오래된 파일 삭제
  await deleteOldFiles(logDirectory);

  // 지정된 시작 포트부터 +100까지 포트 범위를 설정
  const port = await getPort({ port: getPort.makeRange(startPort, startPort + 100) });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      createReadStream(logfile).pipe(res);

      try {
        // 로그 파일 압축
        const compressedFile = await compressLogs(logDirectory);
        if (compressedFile) {
          const formData = new FormData();
          formData.append('logFile', createReadStream(compressedFile), 'logs.zip');

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
          console.log('Logs sent successfully');
        }
      } catch (error) {
        console.error('Failed to send logs:', error);
      }
    });

    server.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
      resolve(port);
    });

    server.on('error', (error) => {
      reject(error);
    });

    // 표준 출력/에러를 로그 파일에 기록
    hookStd({ silent: false }, output => { fh.write(output) });
  });
}

module.exports = async (config) => {
  const logDirectory = config.logDirectory || '/userdata/logs';
  await fs.mkdir(logDirectory, { recursive: true }); // 로그 디렉토리 생성

  const port = await startServer(
    logDirectory,
    config.flags || 'a',
    config.postUrl || "",
    config.key || "",
    config.homeyId || "unknown",
    config.appId || "unknown",
    config.port || 8008 // 기본 시작 포트를 config에서 설정 가능
  );
  console.log(`Server successfully started on port: ${port}`);
  return port;
};