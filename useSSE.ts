import { useEffect, useRef, useState } from 'react'

const useSSE = () => {
  const eventSourceRef = useRef<EventSource | null>(null)

  // 音频相关引用
  const audioContextRef = useRef<AudioContext | null>(null)
  // 音频数据队列
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  // 是否在播放
  const isPlayingRef = useRef<boolean>(false)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  // 添加索引计数器
  const currentIndexRef = useRef<number>(0)

  // 音频配置
  const audioConfigRef = useRef({
    sampleRate: null,
    bitDepth: null,
    channels: null,
  })

  /**
   * 核心：PCM转WAV（复用之前的核心函数，适配ArrayBuffer入参）
   * @param pcmBuffer PCM格式的ArrayBuffer（纯有效数据）
   * @param options 音频参数（必须匹配PCM实际参数）
   * @returns WAV格式的ArrayBuffer
   */
  function pcmToWav(
    pcmBuffer: ArrayBuffer,
    options: {
      sampleRate: number
      bitDepth: number
      channels: number
    },
  ): ArrayBuffer {
    const { sampleRate = 16000, bitDepth = 16, channels = 1 } = options
    const pcmLength = pcmBuffer.byteLength
    const wavHeaderLength = 44
    const wavLength = wavHeaderLength + pcmLength

    // 创建WAV缓冲区（头+PCM数据）
    const wavBuffer = new ArrayBuffer(wavLength)
    const view = new DataView(wavBuffer)
    // 1. 写入WAV文件头（RIFF标准格式）
    // ChunkID: "RIFF"
    view.setUint8(0, 0x52)
    view.setUint8(1, 0x49)
    view.setUint8(2, 0x46)
    view.setUint8(3, 0x46)
    // ChunkSize: 总长度 - 8
    view.setUint32(4, wavLength - 8, true)
    // Format: "WAVE"
    view.setUint8(8, 0x57)
    view.setUint8(9, 0x41)
    view.setUint8(10, 0x56)
    view.setUint8(11, 0x45)
    // Subchunk1ID: "fmt "
    view.setUint8(12, 0x66)
    view.setUint8(13, 0x6d)
    view.setUint8(14, 0x74)
    view.setUint8(15, 0x20)
    // Subchunk1Size: 16（PCM固定）
    view.setUint32(16, 16, true)
    // AudioFormat: 1（PCM格式）
    view.setUint16(20, 1, true)
    // NumChannels: 声道数
    view.setUint16(22, channels, true)
    // SampleRate: 采样率
    view.setUint32(24, sampleRate, true)
    // ByteRate: 采样率×声道数×位深/8
    view.setUint32(28, sampleRate * channels * (bitDepth / 8), true)
    // BlockAlign: 声道数×位深/8
    view.setUint16(32, channels * (bitDepth / 8), true)
    // BitsPerSample: 位深
    view.setUint16(34, bitDepth, true)
    // Subchunk2ID: "data"
    view.setUint8(36, 0x64)
    view.setUint8(37, 0x61)
    view.setUint8(38, 0x74)
    view.setUint8(39, 0x61)
    // Subchunk2Size: PCM数据长度
    view.setUint32(40, pcmLength, true)

    // 2. 写入PCM数据（从44字节开始）
    const pcmView = new Uint8Array(pcmBuffer)
    const wavView = new Uint8Array(wavBuffer)
    wavView.set(pcmView, wavHeaderLength)

    // const wavHeaderSampleRate = view.getUint32(24, true)
    // console.log('WAV 头采样率：', wavHeaderSampleRate, options) // 必须输出 16000

    return wavBuffer
  }

  // Base64编码的字符串转换为Uint8Array(二进制数据)
  const base64ToUint8Array = (base64: any) => {
    try {
      const binaryString = atob(base64)
      const len = binaryString.length
      const uint8Array = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        uint8Array[i] = binaryString.charCodeAt(i)
      }
      return uint8Array
    } catch (error) {
      return null
    }
  }

  // 添加音频数据到队列
  const addToAudioQueue = (uint8Array: Uint8Array) => {
    // 转换为ArrayBuffer
    const arrayBuffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength)
    // 添加到播放队列
    audioQueueRef.current.push(arrayBuffer)
    // 如果没有在播放，则开始播放
    if (!isPlayingRef.current) {
      playAudioQueue()
    }
  }

  // 播放音频队列
  const playAudioQueue = async () => {
    if (!audioContextRef.current || isPlayingRef.current || audioQueueRef.current.length === 0) {
      return
    }

    isPlayingRef.current = true

    // 获取队列中的第一个音频块
    const arrayBuffer = audioQueueRef.current.shift()
    if (!arrayBuffer) {
      isPlayingRef.current = false
      return
    }

    try {
      // 增加索引计数器
      currentIndexRef.current++

      const wavData = pcmToWav(arrayBuffer, {
        ...audioConfigRef.current,
      })
      if (!wavData) return

      // console.log(wavData)
      /**
       * 方案一
       */
      // 3. 生成WAV的Blob URL，供audio标签播放
      //  const wavBlob = new Blob([wavData], { type: 'audio/wav' });
      //  const wavUrl = URL.createObjectURL(wavBlob);

      // 4. 播放
      //  const audioPlayer = document.getElementById('audioPlayer');
      //  audioPlayer.src = wavUrl;
      //  audioPlayer.play();

      //  // 播放结束后释放Blob URL（避免内存泄漏）
      //  audioPlayer.onended = () => {
      //      URL.revokeObjectURL(wavUrl);
      //  };
      /** 方案二 */
      // 解码WAV数据  https://developer.mozilla.org/zh-CN/docs/Web/API/BaseAudioContext/decodeAudioData
      const audioBuffer = await audioContextRef.current.decodeAudioData(wavData)
      console.log(audioBuffer)
      // 创建音源并播放 https://developer.mozilla.org/zh-CN/docs/Web/API/BaseAudioContext/createBufferSource
      const source = audioContextRef.current.createBufferSource()

      source.buffer = audioBuffer
      // ADD
      sourceNodeRef.current = source
      // https://developer.mozilla.org/zh-CN/docs/Web/API/AudioNode/connect
      source.connect(audioContextRef.current.destination)

      source.start()
      /**
       * 播放完成后继续播放队列中的下一个
       * onended: https://developer.mozilla.org/zh-CN/docs/Web/API/AudioBufferSourceNode#%E4%BA%8B%E4%BB%B6
       */
      source.onended = () => {
        console.log('播放完毕----------', currentIndexRef.current)
        isPlayingRef.current = false
        sourceNodeRef.current = null
        // 继续播放队列中的其他音频块
        if (audioQueueRef.current.length > 0) {
          playAudioQueue()
        }
      }
    } catch (error) {
      console.error('音频播放失败:', error)
      isPlayingRef.current = false
    }
  }

  useEffect(() => {
    // 初始化SSE连接
    eventSourceRef.current = new EventSource('http://localhost:3000/api/pcm-stream')
    // 监听SSE消息
    eventSourceRef.current.onopen = () => {
      console.log('已连接SSE，等待PCM数据...')
    }

    eventSourceRef.current.onmessage = (e) => {
      const data = JSON.parse(e.data)

      // 处理结束标识
      if (data.type === 'end') {
        console.log(`推送完成，总块数：${data.index}`)
        eventSourceRef.current.close()
        return
      }

      // 处理错误
      if (data.type === 'error') {
        console.log(`错误：${data.message}`)
        eventSourceRef.current.close()
        return
      }
      // Base64 解码为 Uint8Array（PCM 二进制）
      const pcmBase64 = data.data

      // 更新音频配置（如果存在）
      if (data.config) {
        audioConfigRef.current = {
          sampleRate: data.config.sampleRate,
          bitDepth: data.config.bitDepth,
          channels: data.config.channels,
        }
      }

      const pcmUint8 = base64ToUint8Array(pcmBase64)

      if (pcmUint8) {
        if (!audioContextRef.current) {
          // 初始化音频上下文
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        }
        // 添加到音频队列并播放
        addToAudioQueue(pcmUint8)
      }
    }

    eventSourceRef.current.onerror = (err: any) => {
      console.log(`SSE连接错误：${err.message}`)
      eventSourceRef.current.close()
    }

    // 清理函数
    return () => {
      console.log(eventSourceRef.current, sourceNodeRef.current)
      eventSourceRef.current.close()
      // 停止当前播放
      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop()
      }
      // 关闭 audio context，同时释放占用的所有系统资源
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  const closeConnection = () => {
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
      eventSourceRef.current.close()
    }
  }

  return { closeConnection }
}

export default useSSE
