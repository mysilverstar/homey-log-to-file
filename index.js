const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('http');
const { Client } = require('@elastic/elasticsearch');

async function dynamicImport(module) {
  return await import(module);
}

module.exports = async (postUrl, key = "", homeyId = "", packageName = "", pid = "") => {
  if (!postUrl) {
    throw new Error("postUrl is not defined");
  }

  // Elasticsearch 클라이언트 생성
  const client = new Client({
    node: postUrl, // Elasticsearch 주소
  });
  
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
        try {

          const response = await client.index({
            index: packageName, // 저장할 Elasticsearch 인덱스 이름
            body: {
              timestamp: new Date().toISOString(), // 타임스탬프
              message: line, // 로그 메시지
              homeyId,
              pid,
              packageName
            },
          });

          // console.log('Line sent to', postUrl);
        } catch (error) {
          // console.error('Failed to send line:', error);
        }
      }
    }
  });
};