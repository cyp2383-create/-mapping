"""
AI 结构化提取层 — 使用 DeepSeek API 从非结构化 Profile 文本提取标准化字段。

DeepSeek API: OpenAI 兼容格式，endpoint = https://api.deepseek.com/v1

输入: 原始文本 (如脉脉Profile、JD描述、LinkedIn概要)
输出: 结构化 dict
"""

import json
import re
from typing import Optional

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-chat"

EXTRACTION_PROMPT = """你是一位专业的人才数据解析师。从以下个人Profile文本中提取结构化信息。

规则：
1. 只提取文本中明确提到的信息，不要推测或编造
2. 如果某项信息文本中没有，填写空字符串 ""
3. 教育经历和过往公司用 JSON 数组
4. 姓名只取一个（最可能是本人姓名的那个）

返回严格的 JSON 格式（不要markdown代码块包裹）：

REQUIRED_FORMAT

文本:
TEXT_CONTENT"""


def _build_extraction_prompt(text: str) -> str:
    format_example = json.dumps({
        "name": "姓名",
        "current_company": "当前公司全称",
        "current_title": "当前职位全称",
        "city": "所在城市",
        "past_companies": ["公司1", "公司2"],
        "education": [{"school": "学校名", "degree": "学历", "major": "专业"}],
        "total_years": 0,
        "skills": ["技能1", "技能2"],
        "industry_tags": ["行业标签1"],
        "contact_hints": "文本中出现的任何联系线索",
        "raw_text_preview": "原文前200字"
    }, ensure_ascii=False, indent=2)
    return EXTRACTION_PROMPT.replace("REQUIRED_FORMAT", format_example).replace("TEXT_CONTENT", text[:4000])


def extract_profile(text: str, api_key: str = "", model: str = DEFAULT_MODEL) -> dict:
    """
    使用 DeepSeek API 从原始 Profile 文本提取结构化字段。
    如果 API 不可用，回退到基于正则的基础提取。
    """
    if not text or len(text.strip()) < 10:
        return _empty_result()

    if HAS_OPENAI and api_key:
        return _extract_with_deepseek(text, api_key, model)
    else:
        return _extract_with_regex(text)


def _extract_with_deepseek(text: str, api_key: str, model: str = DEFAULT_MODEL) -> dict:
    """使用 DeepSeek API 提取"""
    client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    prompt = _build_extraction_prompt(text)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
        )
        content = response.choices[0].message.content
    except Exception as e:
        print(f"[extractor] DeepSeek API error: {e}")
        return _extract_with_regex(text)

    # 清理可能的 markdown 包裹
    content = content.strip()
    content = re.sub(r'^```(?:json)?\s*\n?', '', content)
    content = re.sub(r'\n?```\s*$', '', content)

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        print(f"[extractor] JSON parse failed, raw: {content[:200]}")
        return _extract_with_regex(text)


def _extract_with_regex(text: str) -> dict:
    """基于正则的基础提取（API 不可用时的回退方案）"""
    result = _empty_result()
    result["raw_text_preview"] = text[:200]

    name_patterns = [
        r'姓\s*名[：:]\s*([一-鿿]{2,4})',
        r'^([一-鿿]{2,4})[\s，,]',
    ]
    for pat in name_patterns:
        m = re.search(pat, text)
        if m:
            result["name"] = m.group(1)
            break

    email_m = re.search(r'[\w.\-]+@[\w\-]+\.\w+', text)
    if email_m:
        result["contact_hints"] = email_m.group(0)

    phone_m = re.search(r'1[3-9]\d{9}', text)
    if phone_m:
        result["contact_hints"] = (result["contact_hints"] + " " + phone_m.group(0)).strip()

    return result


def extract_batch(profiles: list[dict], api_key: str = "", model: str = DEFAULT_MODEL) -> list[dict]:
    """批量提取"""
    results = []
    for p in profiles:
        text = p.get("text", "") or p.get("raw_text", "") or p.get("source_profile", "")
        extracted = extract_profile(text, api_key, model)
        merged = {**extracted, **{k: v for k, v in p.items() if v}}
        results.append(merged)
    return results


def generate_target_companies(industry: str, role_direction: str = "", api_key: str = "") -> list[dict]:
    """
    让 LLM 根据行业知识生成目标公司列表。
    返回: [{"name": "公司名", "tier": "第一梯队", "reason": "理由"}, ...]
    """
    if not HAS_OPENAI or not api_key:
        print("[extractor] DeepSeek API not available, using built-in company list")
        return _get_fallback_companies(industry)

    client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    prompt = f"""你是中国互联网行业的资深猎头顾问。

请为"{industry}"行业（岗位方向：{role_direction or '不限'}）列出最重要的目标公司。

要求：
1. 列出10-15家公司，按梯队分类（第一梯队/第二梯队/第三梯队）
2. 第一梯队是行业标杆，人才最多、最值得挖猎
3. 第二梯队是核心竞品，能力高度匹配
4. 第三梯队是关联行业，能力可迁移
5. 每家公司写一句为什么它是Mapping目标
6. 企业规模写1-2个字的标签（如"15万+"、"50万+"、"2万+"）

返回严格的 JSON 格式（不要markdown代码块包裹）：
{json.dumps({"companies": [{"name": "示例公司", "tier": "第一梯队", "size": "15万+", "headquarters": "北京", "reason": "示例理由"}]}, ensure_ascii=False, indent=2)}"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2048,
        )
        content = response.choices[0].message.content.strip()
        content = re.sub(r'^```(?:json)?\s*\n?', '', content)
        content = re.sub(r'\n?```\s*$', '', content)
        data = json.loads(content)
        return data.get("companies", [])
    except Exception as e:
        print(f"[extractor] Company generation failed: {e}")
        return _get_fallback_companies(industry)


def _get_fallback_companies(industry: str) -> list[dict]:
    """内置回退——中国互联网头部企业"""
    fallback = [
        {"name": "字节跳动", "tier": "第一梯队", "size": "15万+", "headquarters": "北京",
         "reason": "综合流量最大，组织架构完善，人才密度高"},
        {"name": "阿里巴巴", "tier": "第一梯队", "size": "12.7万", "headquarters": "杭州",
         "reason": "电商+云计算双引擎，职级体系成熟"},
        {"name": "腾讯", "tier": "第一梯队", "size": "11.5万", "headquarters": "深圳",
         "reason": "社交+游戏+内容，产品文化浓厚"},
        {"name": "美团", "tier": "第一梯队", "size": "11万+", "headquarters": "北京",
         "reason": "本地生活霸主，业务线丰富"},
        {"name": "快手", "tier": "第二梯队", "size": "2.5万", "headquarters": "北京",
         "reason": "短视频+直播电商，增长迅速"},
        {"name": "百度", "tier": "第二梯队", "size": "3.4万", "headquarters": "北京",
         "reason": "AI转型中，搜索+自动驾驶"},
        {"name": "京东", "tier": "第二梯队", "size": "77万", "headquarters": "北京",
         "reason": "电商+物流，采销体系完整"},
        {"name": "小红书", "tier": "第二梯队", "size": "1万+", "headquarters": "上海",
         "reason": "种草社区，商业化增长快"},
        {"name": "拼多多", "tier": "第二梯队", "size": "2.5万", "headquarters": "上海",
         "reason": "电商新贵，人效极高"},
        {"name": "网易", "tier": "第二梯队", "size": "2.5万", "headquarters": "杭州",
         "reason": "游戏+内容，利润率高"},
        {"name": "滴滴", "tier": "第三梯队", "size": "2万+", "headquarters": "北京",
         "reason": "出行服务，自动驾驶方向"},
        {"name": "小米", "tier": "第三梯队", "size": "5.6万", "headquarters": "北京",
         "reason": "手机+汽车+IoT，硬件生态"},
        {"name": "bilibili", "tier": "第三梯队", "size": "1万+", "headquarters": "上海",
         "reason": "Z世代社区，内容生态独特"},
    ]
    # 如果行业不是通用互联网，返回通用的让用户自己改
    return fallback


def _empty_result() -> dict:
    return {
        "name": "", "current_company": "", "current_title": "",
        "city": "", "past_companies": [], "education": [],
        "total_years": 0, "skills": [], "industry_tags": [],
        "contact_hints": "", "raw_text_preview": "",
    }
