const fs = require("node:fs/promises");
const path = require("path");
const tar = require("tar");
const semver = require("semver");
const winston = require("winston");

/* ======================================================
 * Winston Logger (파일 관리 전담)
 * ====================================================== */

const DEFAULT_LOG_OPTIONS = {
  maxSize: 1 * 1024 * 1024, // 1MB
  maxFiles: 10,
};

/**
 * - 지정된 파일명 기준으로 로그 기록 (기본: app.log)
 * - 파일당 1MB
 * - 최대 10개 (약 10MB)
 * - 오래된 파일 자동 삭제
 */
function createFileLogger(logDirectory, options = {}) {
  const {
    filename = "app.log",
    maxSize = DEFAULT_LOG_OPTIONS.maxSize,
    maxFiles = DEFAULT_LOG_OPTIONS.maxFiles,
  } = options;

  return winston.createLogger({
    level: "info",
    format: winston.format.printf(info => info.message),
    transports: [
      new winston.transports.File({
        dirname: logDirectory,
        filename,
        maxsize: maxSize,   // 🔥 override 가능
        maxFiles: maxFiles, // 🔥 override 가능
        tailable: true,
      }),
    ],
  });
}

/* ======================================================
 * Legacy Log Cleanup (전환 1회용)
 * ====================================================== */

/**
 * 기존 구현에서 사용하던 로그 파일 전부 삭제
 * - std_*.log
 * - std.log*
 * - app.log* (커스텀 파일명 사용 시)
 */
async function cleanLegacyLogs(logDirectory, filename = "app.log") {
  const files = await fs.readdir(logDirectory);
  const cleanAppLog = filename !== "app.log";

  for (const file of files) {
    if (
      file.startsWith("std_") ||
      file.startsWith("std.log") ||
      (cleanAppLog && /^app\d*\.log$/.test(file))
    ) {
      await fs.unlink(path.join(logDirectory, file));
    }
  }

  console.log("[log] legacy logs cleared");
}

/* ======================================================
 * stdout / stderr → Winston
 * ====================================================== */

async function hookStdoutToWinston(logger) {
  const { hookStd } = await import("hook-std");

  let buffer = "";

  hookStd({ silent: false }, output => {
    buffer += output;
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        logger.info(line);
      }
    }
  });
}

/* ======================================================
 * Log Compression (스냅샷)
 * ====================================================== */

/**
 * 현재 존재하는 모든 Winston 로그 파일
 * - 지정된 파일명 기준 (기본: app.log)
 * - write 중이어도 그대로 압축 (스냅샷)
 */
async function compressAllLogs(logDirectory, filename = "app.log") {
  const { name, ext } = path.parse(filename);
  const pattern = new RegExp(`^${name}\\d*\\${ext}$`);
  const files = (await fs.readdir(logDirectory))
    .filter(f => pattern.test(f));

  if (files.length === 0) return null;

  const outputFile = path.join(logDirectory, "logs.tar.gz");

  await tar.c(
    {
      gzip: true,
      file: outputFile,
      cwd: logDirectory,
      gzipOptions: { level: 9 },
    },
    files
  );

  return outputFile;
}

/* ======================================================
 * Remote Live Logging (라인 단위)
 * ====================================================== */

async function LogToServer(
  postUrl,
  key = "",
  homeyId = "",
  packageName = "",
  pid = ""
) {
  if (!postUrl) throw new Error("postUrl is not defined");

  const { hookStd } = await import("hook-std");
  let buffer = "";

  hookStd({ silent: false }, async output => {
    buffer += output;
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
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
  });
}

/* ======================================================
 * File Logging (Winston 기반)
 * ====================================================== */

async function LogToFile(config) {
  const logDirectory = config.logDirectory || "/userdata/logs";
  const postUrl = config.postUrl || "";
  const key = config.key || "";
  const homeyId = config.homeyId || "unknown";
  const appId = config.appId || "unknown";

  const filename = config.filename || "app.log";

  await fs.mkdir(logDirectory, { recursive: true });

  // 🔥 Winston 전환 시점: 기존 로그 완전 정리
  await cleanLegacyLogs(logDirectory, filename);

  // 1️⃣ Winston logger 생성
  const logger = createFileLogger(logDirectory, {
    filename,
    maxSize: config.maxSize,
    maxFiles: config.maxFiles,
  });

  // 2️⃣ stdout / stderr → Winston 연결
  await hookStdoutToWinston(logger);

  /* -------- sendLogs -------- */

  async function sendLogs() {
    try {
      const compressedFile = await compressAllLogs(logDirectory, filename);

      if (!compressedFile) {
        return { status: "empty", message: "No logs to send" };
      }

      const fileBuffer = await fs.readFile(compressedFile);
      const formData = new FormData();

      formData.append(
        "logFile",
        new Blob([fileBuffer], { type: "application/gzip" }),
        "logs.tar.gz"
      );

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
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${text}`);
      }

      // ✔ 업로드 후 로컬 로그 유지
      await fs.unlink(compressedFile);

      return { status: "success", message: "Logs sent successfully" };
    } catch (err) {
      console.error("sendLogs failed:", err);
      throw err;
    }
  }

  return { sendLogs };
}

/* ======================================================
 * Hybrid Logging API
 * ====================================================== */

async function LogToHybrid(
  postUrl,
  key = "",
  homeyId = "",
  packageName = "",
  pid = "",
  appVersion = "",
  options = {}
) {
  if (!postUrl) throw new Error("postUrl is not defined");

  // 🔥 options 안전 처리
  const {
    filename,
    maxSize,
    maxFiles,
  } = (options && typeof options === "object") ? options : {};

  const enableServer =
    !appVersion || semver.lt(semver.coerce(appVersion), "1.0.0");

  if (enableServer) {
    await LogToServer(`${postUrl}/addLog`, key, homeyId, packageName, pid);
  }

  const { sendLogs } = await LogToFile({
    postUrl: `${postUrl}/addLogFILE`,
    key,
    homeyId,
    appId: packageName,
    filename,
    maxSize,
    maxFiles,
  });

  return { sendLogs };
}

/* ======================================================
 * export API
 * ====================================================== */

module.exports = {
  LogToFile,
  LogToServer,
  LogToHybrid,
};