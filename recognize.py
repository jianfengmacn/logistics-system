"""运单识别脚本：OCR 识别文字版运单号
用法: python recognize.py <图片路径> [图片路径...]
输出: JSON 数组 [{ file, waybill, method, all_texts, candidates }]
"""
import sys
import re
import json
from rapidocr_onnxruntime import RapidOCR

# 严格匹配顺丰运单号：SF + 12 或 13 位数字（顺丰常见 14/15 位两种长度）
# 避免误匹配 SFTB、SFX 等垃圾字符串
WAYBILL_PATTERN = re.compile(r'SF\d{12,13}')

# 初始化 OCR（首次会自动下载模型）
ocr = RapidOCR()


def recognize_image(img_path):
    """识别单张图片，返回运单号"""
    try:
        result, elapse = ocr(img_path)
        if not result:
            return {'file': img_path, 'waybill': None, 'method': 'ocr', 'all_texts': [], 'candidates': []}

        # 收集所有文字 + 置信度
        all_texts = []
        # 同时记录每个候选运单号对应的"最佳置信度"（用该候选所在文字行的最大 conf）
        best_conf_by_waybill = {}

        for line in result:
            text = line[1]
            conf = line[2]
            try:
                conf = float(conf)
            except Exception:
                conf = 0.0
            all_texts.append({'text': text, 'conf': conf})

            # 清洗：去掉空格、冒号、括号、连字符、下划线、斜杠、点
            cleaned = re.sub(r'[\s:：()（）\-_/.,，。]', '', text)
            matches = WAYBILL_PATTERN.findall(cleaned)
            for m in matches:
                # 取该候选所在文字行的最大置信度
                prev = best_conf_by_waybill.get(m, 0.0)
                if conf > prev:
                    best_conf_by_waybill[m] = conf

        if best_conf_by_waybill:
            # 按置信度从高到低排序，取最高的
            ranked = sorted(best_conf_by_waybill.items(), key=lambda x: x[1], reverse=True)
            best = ranked[0][0]
            return {
                'file': img_path,
                'waybill': best,
                'method': 'ocr',
                'all_texts': [t['text'] for t in all_texts],
                'candidates': [code for code, _ in ranked],
                'candidate_confs': [round(conf, 3) for _, conf in ranked]
            }
        else:
            return {
                'file': img_path,
                'waybill': None,
                'method': 'ocr',
                'all_texts': [t['text'] for t in all_texts],
                'candidates': []
            }
    except Exception as e:
        return {
            'file': img_path,
            'waybill': None,
            'method': 'ocr',
            'error': str(e),
            'all_texts': []
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': '没有提供图片路径'}))
        sys.exit(1)

    images = sys.argv[1:]
    results = []
    for img_path in images:
        r = recognize_image(img_path)
        results.append(r)

    # 输出 JSON
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

