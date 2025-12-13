const http = require("http");
const fs = require("fs");
const path = require("path");

/**
 * 8,000 Hz	8kHz	电话质量语音
  16,000 Hz	16kHz	语音识别、语音通信常用
  22,050 Hz	22.05kHz	低质量音乐
  44,100 Hz	44.1kHz	CD音质标准
  48,000 Hz	48kHz	DVD、蓝光音频标准
 */
// console.log(path.join(__dirname, '16k16bit.pcm'))
const CONFIG = {
  port: 3000, // 服务端口
  pcmFilePath: path.join(__dirname, "16k16bit.pcm"), // PCM文件路径（提前生成）
  chunkSize: 10 * 1024, // 每次推送的PCM数据块大小（字节）
  sampleRate: 16000, // PCM采样率（需与文件一致）
  bitDepth: 16, // PCM位深（需与文件一致）
  pushInterval: null, // 自动计算推送间隔（匹配音频播放速度）
  channels: 1, // 频道
};

// 计算每块数据的播放时长（毫秒），作为推送间隔
// CONFIG.pushInterval = (CONFIG.chunkSize / ((CONFIG.bitDepth / 8) * CONFIG.channels) / CONFIG.sampleRate) * 1000

async function streamPcmBysse(res) {
  // 验证PCM文件存在
  if (!fs.existsSync(CONFIG.pcmFilePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`PCM文件不存在：${CONFIG.pcmFilePath}`);
    return;
  }

  // 设置SSE响应头（核心）
  res.writeHead(200, {
    "Content-Type": "text/event-stream", // SSE专属Content-Type
    "Cache-Control": "no-cache", // 禁用缓存
    Connection: "keep-alive", // 长连接
    "Access-Control-Allow-Origin": "*", // 跨域支持（根据需求调整）
  });

  // 创建文件读取流
  const fileStream = fs.createReadStream(CONFIG.pcmFilePath, {
    highWaterMark: CONFIG.chunkSize, // 每次读取chunkSize字节
    encoding: "binary", // 二进制读取
  });

  // 新增：任务计数器（跟踪待执行的setTimeout任务）
  let pendingTasks = 0;
  // 监听文件流数据，分块推送
  let chunkIndex = 1;
  // 记录累计延迟时间（核心：每块延迟叠加）
  let delayTime = 0;
  fileStream.on("data", (chunk) => {
    // 每块延迟+1000ms，下一块的延迟是 1000/2000/3000...ms
    delayTime += 200;
    // 每新增一个延迟任务，计数器+1
    pendingTasks++;
    try {
      // SSE格式：data: 二进制数据Base64编码\n\n, SSE不支持直接推送二进制，需转Base64
      setTimeout(() => {
        try {
          const base64Chunk = Buffer.from(chunk, "binary").toString("base64");
          const byteSize = Buffer.byteLength(base64Chunk, "utf8");
          res.write(
            `data: ${JSON.stringify({
              id: chunkIndex,
              data: base64Chunk,
              byteSize,
              config: {
                desc: "Base64编码会使数据体积增加约33%：原始数据：64KB, Base64编码后：64KB × 1.33 ≈ 85.3KB",
                sampleRate: CONFIG.sampleRate,
                bitDepth: CONFIG.bitDepth,
                channels: CONFIG.channels,
                chunkSize: chunk.length,
              },
            })}\n\n`
          );
          chunkIndex++;
        } catch (err) {
          console.error("推送单块数据失败：", err);
        } finally {
          // 任务执行完成，计数器-1
          pendingTasks--;
          // 检查是否所有任务都完成，且流已结束 → 发送结束标识
          checkAndSendEndSignal(res);
        }
      }, delayTime);
      // console.log(`推送第${chunkIndex}块PCM数据，大小：${chunk.length}字节`)
    } catch (err) {
      console.error("推送数据失败：", err);
      pendingTasks--; // 出错也要减少计数器，避免死等
      fileStream.destroy(); // 出错关闭流
    }
  });

  // 监听流结束（仅标记流已读完，不立即发结束标识）
  let streamEnded = false;
  fileStream.on("end", () => {
    console.log("PCM文件流读取完成，待推送分块数：", chunkIndex);
    streamEnded = true; // 标记流已结束
    // 流结束后，检查是否所有延迟任务都完成
    checkAndSendEndSignal(res);
  });

  /**
   * 核心：检查是否满足「流已结束 + 所有延迟任务完成」，满足则发送结束标识
   */
  function checkAndSendEndSignal(res) {
    if (streamEnded && pendingTasks === 0) {
      console.log("所有分块推送完成，总块数：", chunkIndex);
      res.write(
        `data: ${JSON.stringify({ type: "end", total: chunkIndex })}\n\n`
      );
      // 延迟end，确保SSE结束标识能被客户端接收（可选）
      setTimeout(() => res.end(), 100);
    }
  }

  fileStream.on("error", (err) => {
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
    );
    res.end();
    console.error("读取PCM文件失败：", err);
  });

  // 监听客户端断开连接，清理资源
  res.on("close", () => {
    fileStream.destroy();
    console.log("客户端断开连接，停止推送");
  });
}

const server = http.createServer((req, res) => {
  // 仅处理SSE接口请求
  if (req.url === "/api/pcm-stream") {
    console.log("客户端连接SSE，开始推送PCM数据...");
    streamPcmBysse(res);
  } else {
    // 首页提示
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <h1>PCM SSE推送服务</h1>
      <p>接口地址：<a href="/api/pcm-stream">/api/pcm-stream</a></p>
      <p>配置：</p>
      <ul>
        <li>采样率：${CONFIG.sampleRate}Hz</li>
        <li>位深：${CONFIG.bitDepth}bit</li>
        <li>推送块大小：${CONFIG.chunkSize}字节</li>
      </ul>
    `);
  }
});

server.listen(CONFIG.port, () => {
  console.log(`SSE服务已启动：http://localhost:${CONFIG.port}`);
  console.log(`PCM文件路径：${CONFIG.pcmFilePath}`);
});
