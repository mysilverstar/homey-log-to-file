const fs                   = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http                 = require('http');
const fetch = require('node-fetch');

// module.exports = async (logfile = '/userdata/std.log', port = 8008, flags = 'w') => {
//   const { hookStd } = await import('hook-std');
//   const fh          = await fs.open(logfile, flags);

//   // Create HTTP server that will serve the file
//   http.createServer((req, res) => {
//     res.writeHead(200, { 'Content-Type': 'text/plain; ; charset=utf-8' });
//     createReadStream(logfile).pipe(res);
//   }).listen(port);

//   // Capture stdout/stderr and write to file
//   hookStd({ silent : false }, output => { fh.write(output) });
// }

module.exports = async (postUrl = 'http://example.com/post', key = "", homeyId = "", package ="") => {
  const { hookStd } = await import('hook-std');
  // const fh = await fs.open(logfile, flags);

  let buffer = '';

  // // Create HTTP server that will serve the file
  // http.createServer((req, res) => {
  //   res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  //   createReadStream(logfile).pipe(res);
  // }).listen(port);

  // Capture stdout/stderr and write to file and send each line as a POST request
  hookStd({ silent: false }, async output => {
    buffer += output;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // 마지막 줄은 아직 완료되지 않은 줄이므로 버퍼에 유지

    for (const line of lines) {
      if (line.trim()) {
        // 로그 파일에 쓰기
        // await fh.write(line + '\n');
        // HTTP POST 요청 보내기
        try {
          await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', 'x-service-key': 'member_yuji' },
            body: {
              homey : homeyId,
              package : package,
              message : line
            }
          });
          console.log('Line sent to', postUrl);
        } catch (error) {
          console.error('Failed to send line:', error);
        }
      }
    }
  });
};