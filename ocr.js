/**
 * OCR 识别抽象层
 * - 默认：tesseract.js（纯 JS，零外部依赖，完全免费，Render 直接能跑）
 * - 可选：配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 时走腾讯云通用印刷体 OCR（识别率更高）
 *
 * 输出格式：
 *   [{ file, waybill, method, all_texts, candidates, candidate_confs?, error? }]
 *
 * 识别目标：顺丰运单号 SF + 12~13 位数字
 * 优化：tesseract.js 设 char_whitelist = 'SF0123456789'，只识别这些字符
 */

const fs = require('fs');
const path = require('path');

const WAYBILL_PATTERN = /SF\d{12,13}/g;
const CLEAN_PATTERN = /[\s:：()（）\-_/.,，。]/g;

// ============ tesseract.js OCR（默认，纯 JS 免费） ============

let tesseractWorker = null;
let tesseractLoading = null;

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  if (tesseractLoading) return tesseractLoading; // 防止并发重复创建

  const { createWorker } = require('tesseract.js');

  // 语言数据路径：优先项目内 tessdata/ 目录，其次环境变量，最后在线下载
  let langPath = undefined;
  const localTessdata = path.join(__dirname, 'tessdata');
  if (fs.existsSync(path.join(localTessdata, 'eng.traineddata'))) {
    langPath = localTessdata;
    console.log('[tesseract] 使用本地语言数据:', localTessdata);
  } else if (process.env.TESSDATA_PATH && fs.existsSync(process.env.TESSDATA_PATH)) {
    langPath = process.env.TESSDATA_PATH;
    console.log('[tesseract] 使用环境变量指定的语言数据:', langPath);
  } else {
    console.log('[tesseract] 本地无语言数据，首次将在线下载（约 4MB）...');
  }

  tesseractLoading = (async () => {
    const workerOptions = {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log('[tesseract]', m.status, Math.round(m.progress * 100) + '%');
        } else if (m.status && m.status.includes('loading')) {
          console.log('[tesseract]', m.status);
        }
      }
    };
    if (langPath) workerOptions.langPath = langPath;

    const worker = await createWorker('eng', 1, workerOptions);
    // 只识别 S、F 和数字，大幅提高顺丰运单号识别准确率
    await worker.setParameters({
      tessedit_char_whitelist: 'SF0123456789'
    });
    tesseractWorker = worker;
    tesseractLoading = null;
    return worker;
  })();

  return tesseractLoading;
}

async function recognizeByTesseract(buffer) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(buffer);

  const all_texts = [];
  const best_conf_by_waybill = {};

  // tesseract.js 返回 data.lines，每行带 confidence（0-100）
  const lines = data.lines || [];
  for (const line of lines) {
    const text = (line.text || '').trim();
    const conf = (line.confidence != null ? line.confidence : 0) / 100;
    if (text) all_texts.push(text);

    const cleaned = text.replace(CLEAN_PATTERN, '');
    const matches = cleaned.match(WAYBILL_PATTERN) || [];
    for (const m of matches) {
      const prev = best_conf_by_waybill[m] || 0;
      if (conf > prev) best_conf_by_waybill[m] = conf;
    }
  }

  // lines 为空时回退到全文匹配
  if (all_texts.length === 0 && data.text) {
    const fullText = data.text.trim();
    all_texts.push(fullText);
    const cleaned = fullText.replace(CLEAN_PATTERN, '');
    const matches = cleaned.match(WAYBILL_PATTERN) || [];
    for (const m of matches) {
      if (!(m in best_conf_by_waybill)) best_conf_by_waybill[m] = 0.5;
    }
  }

  if (Object.keys(best_conf_by_waybill).length > 0) {
    const ranked = Object.entries(best_conf_by_waybill)
      .sort((a, b) => b[1] - a[1]);
    return {
      waybill: ranked[0][0],
      method: 'tesseract',
      all_texts,
      candidates: ranked.map(x => x[0]),
      candidate_confs: ranked.map(x => Math.round(x[1] * 1000) / 1000)
    };
  }

  return {
    waybill: null,
    method: 'tesseract',
    all_texts,
    candidates: []
  };
}

// ============ 腾讯云 OCR（可选，配密钥才启用） ============
// 保留代码以备将来升级，未安装 tencentcloud-sdk-nodejs 时不会报错（lazy require）

let tencentClient = null;
function getTencentClient() {
  if (tencentClient) return tencentClient;
  const SecretId = process.env.TENCENT_SECRET_ID;
  const SecretKey = process.env.TENCENT_SECRET_KEY;
  if (!SecretId || !SecretKey) return null;

  const tencentcloud = require('tencentcloud-sdk-nodejs');
  const OcrClient = tencentcloud.ocr.v20181119.Client;

  const clientConfig = {
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: process.env.TENCENT_REGION || 'ap-guangzhou',
    profile: {
      httpProfile: { endpoint: 'ocr.tencentcloudapi.com' }
    }
  };
  tencentClient = new OcrClient(clientConfig);
  return tencentClient;
}

async function recognizeByTencent(buffer) {
  const client = getTencentClient();
  const ImageBase64 = buffer.toString('base64');
  const resp = await client.GeneralBasicOCR({ ImageBase64 });
  const detections = resp.TextDetections || [];

  const all_texts = [];
  const best_conf_by_waybill = {};

  detections.forEach(d => {
    const text = d.DetectedText || '';
    const conf = (d.Confidence != null ? d.Confidence : 0) / 100;
    all_texts.push(text);

    const cleaned = text.replace(CLEAN_PATTERN, '');
    const matches = cleaned.match(WAYBILL_PATTERN) || [];
    matches.forEach(m => {
      const prev = best_conf_by_waybill[m] || 0;
      if (conf > prev) best_conf_by_waybill[m] = conf;
    });
  });

  if (Object.keys(best_conf_by_waybill).length > 0) {
    const ranked = Object.entries(best_conf_by_waybill)
      .sort((a, b) => b[1] - a[1]);
    return {
      waybill: ranked[0][0],
      method: 'tencent-ocr',
      all_texts,
      candidates: ranked.map(x => x[0]),
      candidate_confs: ranked.map(x => Math.round(x[1] * 1000) / 1000)
    };
  }

  return {
    waybill: null,
    method: 'tencent-ocr',
    all_texts,
    candidates: []
  };
}

// ============ 统一入口 ============

/**
 * 识别一组图片
 * @param {Array<{buffer: Buffer, ext?: string}>} imageBuffers
 * @returns {Promise<Array>} [{ file, waybill, method, all_texts, candidates, candidate_confs?, error? }]
 */
async function recognize(imageBuffers) {
  const useTencent = !!(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);

  if (useTencent) {
    const results = [];
    for (const img of imageBuffers) {
      try {
        const r = await recognizeByTencent(img.buffer);
        results.push({ file: '', ...r });
      } catch (e) {
        results.push({
          file: '',
          waybill: null,
          method: 'tencent-ocr',
          error: e.message,
          all_texts: []
        });
      }
    }
    return results;
  }

  // 默认：tesseract.js（纯 JS，完全免费，零外部依赖）
  const results = [];
  for (const img of imageBuffers) {
    try {
      const r = await recognizeByTesseract(img.buffer);
      results.push({ file: '', ...r });
    } catch (e) {
      // worker 出错时重置，下次重建
      tesseractWorker = null;
      tesseractLoading = null;
      results.push({
        file: '',
        waybill: null,
        method: 'tesseract',
        error: e.message,
        all_texts: []
      });
    }
  }
  return results;
}

module.exports = { recognize };
