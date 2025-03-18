const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const FormData = require('form-data');
const archiver = require('archiver');
const path = require('path');
const semver = require('semver');

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

async function LogToHybrid(postUrl, key = "", homeyId = "", packageName = "", pid = "", appVersion = "") {
  if (!postUrl) {
    throw new Error("postUrl is not defined");
  }

  const enableServer = !appVersion || semver.lt(semver.coerce(appVersion), '1.0.0');

  console.log('LogToHybrid enableServer : ', enableServer);

  // 실시간 로그 전송 시작
  if (enableServer) {
    await LogToServer(`${postUrl}/addLog`, key, homeyId, packageName, pid);
  }

  // 파일 기반 로깅 시작
  const { sendLogs } = await LogToFile({
    postUrl: `${postUrl}/addLogFILE`,
    key,
    homeyId,
    appId: packageName
  });

  return { sendLogs };
}

async function dynamicImport(module) {
  return await import(module);
}

async function LogToServer(postUrl, key = "", homeyId = "", packageName = "", pid = "") {
  if (!postUrl) {
    throw new Error("postUrl is not defined");
  }

  const { hookStd } = await dynamicImport('hook-std');
  const { default: fetch } = await dynamicImport('node-fetch');

  let buffer = '';

  // Capture stdout/stderr and write to file and send each line as a POST request
  hookStd({ silent: false }, async output => {
    buffer += output;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // 마지막 줄은 아직 완료되지 않은 줄이므로 버퍼에 유지

    for (const line of lines) {
      if (line.trim()) {
        // HTTP POST 요청 보내기
        try {
          await fetch(postUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-service-key': key
            },
            body: JSON.stringify({
              homey: homeyId,
              package: packageName,
              message: line,
              pid:pid,
              timestamp : new Date().getTime()
            })
          });
          // console.log('Line sent to', postUrl);
        } catch (error) {
          // console.error('Failed to send line:', error);
        }
      }
    }
  });
}

// 로그 저장 및 전송 기능
async function LogToFile(config) {
  const logDirectory = config.logDirectory || '/userdata/logs';
  const flags = config.flags || 'a';
  const postUrl = config.postUrl || '';
  const key = config.key || '';
  const homeyId = config.homeyId || 'unknown';
  const appId = config.appId || 'unknown';

  // 로그 디렉토리 생성
  await fs.mkdir(logDirectory, { recursive: true });

  // 로그 파일 이름 생성 및 열기
  const logfile = generateLogFileName(logDirectory);
  const logFileHandle = await fs.open(logfile, flags);

  // 오래된 파일 삭제
  await deleteOldFiles(logDirectory);

  // 표준 출력/에러를 로그 파일에 기록
  const { hookStd } = await import('hook-std');
  hookStd({ silent: false }, output => logFileHandle.write(output));

  // 로그 전송 함수
  async function sendLogs() {
    try {
      console.log('Compressing logs...');
      const compressedFile = await compressLogs(logDirectory);

      console.log('Sending logs...');
      const formData = new FormData();
      formData.append('logFile', createReadStream(compressedFile), 'logs.zip');

      const { default: fetch } = await import('node-fetch');
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'x-service-key': key,
          'homeyId': homeyId,
          'appId': appId,
          ...formData.getHeaders(),
        },
        body: formData,
      });

      if (response.ok) {
        console.log('Logs sent successfully');
        return { status: 'success', message: 'Logs sent successfully' };
      } else {
        throw new Error(response.statusText);
      }
    } catch (error) {
      console.error('Failed to send logs:', error);
      throw error;
    }
  }

  return {
    sendLogs, // 로그 전송 함수 반환
    logfile, // 현재 로그 파일 경로 반환
  };
}

module.exports = {
  LogToFile,
  LogToServer,
  LogToHybrid
};