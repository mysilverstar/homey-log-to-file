const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('http');

async function dynamicImport(module) {
  return await import(module);
}

module.exports = async (postUrl, key = "", homeyId = "", packageName = "", pid = "") => {
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
};