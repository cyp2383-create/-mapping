"""
联系方式补全模块

策略（简化版）：
1. 优先使用平台链接（脉脉主页/BOSS直聘聊天/猎聘沟通）= 最高置信度
2. 从 Profile 文本中直接提取已有的邮箱/手机号
3. 找不到就留空 — 不推测、不编造

注意：Email推测功能已移除。中国互联网公司邮箱格式差异大，
      推测命中率极低，与其给错误邮箱不如留空让HR用平台私信。
"""

import re
from typing import Optional


def extract_contact_from_text(text: str) -> dict:
    """
    从 Profile 文本中直接提取联系方式。
    返回 {"type": "email|phone|wechat", "value": "...", "confidence": 0-1}
    """
    result = {"type": "", "value": "", "confidence": 0}

    if not text:
        return result

    # 邮箱
    email_m = re.search(r'[\w.\-]+@[\w\-]+\.\w{2,}', text)
    if email_m:
        result["type"] = "email"
        result["value"] = email_m.group(0)
        result["confidence"] = 0.9  # 直接提取，高置信
        return result

    # 手机号
    phone_m = re.search(r'(?<!\d)1[3-9]\d{9}(?!\d)', text)
    if phone_m:
        result["type"] = "phone"
        result["value"] = phone_m.group(0)
        result["confidence"] = 0.7
        return result

    # 微信号
    wechat_m = re.search(r'(?:微信|wechat|wx)[：:\s]*([a-zA-Z][\w\-]{4,19})', text, re.I)
    if wechat_m:
        result["type"] = "wechat"
        result["value"] = wechat_m.group(1)
        result["confidence"] = 0.5
        return result

    return result


def get_platform_contact(source_platform: str, source_url: str) -> dict:
    """
    根据来源平台生成联系方式。
    脉脉→个人主页链接（HR点开即可私信）
    BOSS→聊天链接
    猎聘→沟通链接
    """
    result = {"type": "", "value": "", "confidence": 0}

    if not source_url:
        return result

    if source_platform == "maimai":
        result["type"] = "maimai_link"
        result["value"] = source_url
        result["confidence"] = 1.0
    elif source_platform == "boss":
        result["type"] = "boss_chat"
        result["value"] = source_url
        result["confidence"] = 0.9
    elif source_platform == "liepin":
        result["type"] = "liepin_contact"
        result["value"] = source_url
        result["confidence"] = 0.9

    return result


def enrich_contact(profile: dict) -> dict:
    """
    为单个 Profile 补全联系方式。

    优先级：
    1. 平台链接（脉脉私信/BOSS聊天）→ 最高置信度
    2. Profile文本中直接提取的邮箱/手机/微信
    3. 找不到 → 标记为 none

    返回增强后的 profile，新增字段：
      contact_type, contact_value, contact_confidence
    """
    source_platform = profile.get("source_platform", "")
    source_url = profile.get("source_url", "")
    raw_text = profile.get("raw_text", "") or profile.get("source_profile", "") or profile.get("text", "")

    # 1. 平台链接优先
    platform_contact = get_platform_contact(source_platform, source_url)
    if platform_contact["type"]:
        profile["contact_type"] = platform_contact["type"]
        profile["contact_value"] = platform_contact["value"]
        profile["contact_confidence"] = platform_contact["confidence"]
        return profile

    # 2. 从文本提取
    extracted = extract_contact_from_text(raw_text)
    if extracted["type"]:
        profile["contact_type"] = extracted["type"]
        profile["contact_value"] = extracted["value"]
        profile["contact_confidence"] = extracted["confidence"]
        return profile

    # 3. 找不到
    profile["contact_type"] = "none"
    profile["contact_value"] = ""
    profile["contact_confidence"] = 0.0
    return profile
