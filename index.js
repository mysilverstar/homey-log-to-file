const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('http');
const FormData = require('form-data'); // FormData 라이브러리 사용

async function dynamicImport(module) {
  return await import(module);
}

module.exports = async ({logfile = '/userdata/std.log', port = 8008, flags = 'a', postUrl = "", key = ""}) => {
  const { hookStd } = await import('hook-std');
  const { default: fetch } = await dynamicImport('node-fetch');
  const fh = await fs.open(logfile, flags);

  // Create HTTP server that will serve the file
  http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    createReadStream(logfile).pipe(res);

    // 파일을 POST로 전송하기 위한 부분
    try {
      const formData = new FormData();
      formData.append('logFile', createReadStream(logfile), 'std.log'); // logFile 필드에 std.log 파일 추가
      await fetch(postUrl, {
        method: 'POST',
        headers: {
          'x-service-key': key, // 이 부분은 파일과 함께 추가할 헤더 정보
          ...formData.getHeaders() // FormData에서 필요한 헤더 자동 설정
        },
        body: formData
      });
      // 파일의 내용 초기화
      await fs.writeFile(logfile, '', { encoding: 'utf8' }); // 파일을 빈 문자열로 덮어쓰기
      console.log('File sent and cleared successfully');
    } catch (error) {
      console.error('Failed to send file:', error);
    }

  }).listen(port);

  // Capture stdout/stderr and write to file
  hookStd({ silent: false }, output => { fh.write(output) });
}