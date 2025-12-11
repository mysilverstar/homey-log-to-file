const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
// const FormData = require("form-data");
const tar = require("tar");
const path = require("path");
const semver = require("semver");

/* ---------------- Utility ---------------- */

function generateLogFileName(basePath) {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  return path.join(basePath, `std_${timestamp}.log`);
}

async function deleteOldFiles(directory, retentionDays = 15) {
  const files = await fs.readdir(directory);
  const now = Date.now();
  for (const file of files) {
    if (file.startsWith("std_")) {
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

// tar.gz compression
async function compressLogs(directory) {
  const outputFile = path.join(directory, "logs.tar.gz");
  const files = (await fs.readdir(directory)).filter((f) =>
    f.startsWith("std_")
  );

  await tar.c(
    {
      gzip: true,
      file: outputFile,
      cwd: directory,
      gzipOptions: { level: 9 },
    },
    files
  );

  console.log(`Compressed into: ${outputFile}`);
  return outputFile;
}

/* ---------------- Remote Live Logging ---------------- */

async function dynamicImport(module) {
  return await import(module);
}

async function LogToServer(
  postUrl,
  key = "",
  homeyId = "",
  packageName = "",
  pid = ""
) {
  if (!postUrl) {
    throw new Error("postUrl is not defined");
  }

  const { hookStd } = await dynamicImport("hook-std");

  let buffer = "";

  hookStd({ silent: false }, async (output) => {
    buffer += output;
    let lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        try {
          await fetch(postUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-service-key": key,
            },
            body: JSON.stringify({
              homey: homeyId,
              package: packageName,
              message: line,
              pid,
              timestamp: Date.now(),
            }),
          });
        } catch (_) {}
      }
    }
  });
}

/* ---------------- Buffered File Logging ---------------- */

async function LogToFile(config) {
  const logDirectory = config.logDirectory || "/userdata/logs";
  const flags = config.flags || "a";
  const postUrl = config.postUrl || "";
  const key = config.key || "";
  const homeyId = config.homeyId || "unknown";
  const appId = config.appId || "unknown";

  await fs.mkdir(logDirectory, { recursive: true });

  const logfile = generateLogFileName(logDirectory);
  const logFileHandle = await fs.open(logfile, flags);

  await deleteOldFiles(logDirectory);

  const { hookStd } = await import("hook-std");

  // Buffered write setup
  let logBuffer = [];
  let flushTimer = null;
  const MAX_BUFFER_LINES = 50;
  const FLUSH_INTERVAL_MS = 5000;

  async function flushLogs() {
    if (logBuffer.length === 0) return;

    const batch = logBuffer.join("");
    logBuffer = [];

    try {
      await logFileHandle.write(batch);
    } catch (err) {
      console.error("Failed flushing logs:", err);
    }

    flushTimer = null;
  }

  function checkFlush() {
    if (logBuffer.length >= MAX_BUFFER_LINES) {
      flushLogs();
      return;
    }

    if (!flushTimer) {
      flushTimer = setTimeout(flushLogs, FLUSH_INTERVAL_MS);
    }
  }

  hookStd({ silent: false }, (output) => {
    logBuffer.push(output);
    checkFlush();
  });

  /* --- sendLogs() uploads compressed logs --- */

  async function sendLogs() {
    try {
      await flushLogs();
      console.log("Compressing logs...");
      const compressedFile = await compressLogs(logDirectory);

      console.log("Sending logs...");

      // tar.gz 파일을 memory buffer로 읽기
      const fileBuffer = await fs.readFile(compressedFile);

      // WHATWG FormData + Blob 사용
      const formData = new FormData();
      formData.append("logFile", new Blob([fileBuffer], { type: "application/gzip" }), "logs.tar.gz");

      const response = await fetch(postUrl, {
        method: "POST",
        headers: {
          "x-service-key": key,
          homeyId,
          appId,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText} — ${errorText}`);
      }

      console.log("Logs sent successfully");
      return { status: "success", message: "Logs sent successfully" };

    } catch (error) {
      console.error("Failed to send logs:", error);
      throw error;
    }
  }
  return {
    sendLogs,
    logfile,
  };
}

/* ---------------- Hybrid Logging API ---------------- */

async function LogToHybrid(
  postUrl,
  key = "",
  homeyId = "",
  packageName = "",
  pid = "",
  appVersion = ""
) {
  if (!postUrl) {
    throw new Error("postUrl is not defined");
  }

  const enableServer =
    !appVersion || semver.lt(semver.coerce(appVersion), "1.0.0");

  console.log("LogToHybrid enableServer : ", enableServer);

  if (enableServer) {
    await LogToServer(`${postUrl}/addLog`, key, homeyId, packageName, pid);
  }

  const { sendLogs } = await LogToFile({
    postUrl: `${postUrl}/addLogFILE`,
    key,
    homeyId,
    appId: packageName,
  });

  return { sendLogs };
}

/* ---------------- export API ---------------- */

module.exports = {
  LogToFile,
  LogToServer,
  LogToHybrid,
};