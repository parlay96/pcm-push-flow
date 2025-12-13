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
  chunkSize: 64 * 1024, // 每次推送的PCM数据块大小（字节）
  sampleRate: 16000, // PCM采样率（需与文件一致）
  bitDepth: 16, // PCM位深（需与文件一致）
  pushInterval: null, // 自动计算推送间隔（匹配音频播放速度）
  channels: 1, // 频道
};

// 计算每块数据的播放时长（毫秒），作为推送间隔
// CONFIG.pushInterval = (CONFIG.chunkSize / ((CONFIG.bitDepth / 8) * CONFIG.channels) / CONFIG.sampleRate) * 1000

async function streamPcmBysse(res) {
  // 1. 验证PCM文件存在
  if (!fs.existsSync(CONFIG.pcmFilePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`PCM文件不存在：${CONFIG.pcmFilePath}`);
    return;
  }

  // 2. 设置SSE响应头（核心）
  res.writeHead(200, {
    "Content-Type": "text/event-stream", // SSE专属Content-Type
    "Cache-Control": "no-cache", // 禁用缓存
    Connection: "keep-alive", // 长连接
    "Access-Control-Allow-Origin": "*", // 跨域支持（根据需求调整）
  });

  // 3. 创建文件读取流
  const fileStream = fs.createReadStream(CONFIG.pcmFilePath, {
    highWaterMark: CONFIG.chunkSize, // 每次读取chunkSize字节
    encoding: "binary", // 二进制读取
  });

  // 4. 监听文件流数据，分块推送
  let chunkIndex = 1;
  fileStream.on("data", (chunk) => {
    try {
      // SSE格式：data: 二进制数据Base64编码\n\n, SSE不支持直接推送二进制，需转Base64
      const base64Chunk = Buffer.from(chunk, "binary").toString("base64");
      const byteSize = Buffer.byteLength(base64Chunk, "utf8");
      res.write(
        `data: ${JSON.stringify({
          id: chunkIndex,
          data: base64Chunk,
          byteSize,
          config: {
            // Base64编码会使数据体积增加约33%：
            desc: "Base64编码会使数据体积增加约33%：原始数据：64KB, Base64编码后：64KB × 1.33 ≈ 85.3KB",
            sampleRate: CONFIG.sampleRate,
            bitDepth: CONFIG.bitDepth,
            channels: CONFIG.channels,
            chunkSize: chunk.length,
          },
        })}\n\n`
      );
      chunkIndex++;
      // console.log(`推送第${chunkIndex}块PCM数据，大小：${chunk.length}字节`)
    } catch (err) {
      console.error("推送数据失败：", err);
      fileStream.destroy(); // 出错关闭流
    }
  });

  // 5. 监听流结束/错误
  fileStream.on("end", () => {
    console.log("PCM数据推送完成，总块数：", chunkIndex);
    // 推送结束标识
    res.write(
      `data: ${JSON.stringify({ type: "end", index: chunkIndex })}\n\n`
    );
    res.end();
  });

  fileStream.on("error", (err) => {
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
    );
    res.end();
    console.error("读取PCM文件失败：", err);
  });

  // 6. 监听客户端断开连接，清理资源
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
