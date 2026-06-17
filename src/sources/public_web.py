"""
公开Web来源采集器

从以下公开渠道搜索人才信息：
  - 行业会议演讲嘉宾
  - 专利申请数据库
  - 知乎专业内容
  - 公司官网团队页面
  - 新闻报道中的高管信息

不依赖平台账号，纯公开数据。
"""

import re
import json
from typing import Optional


def search_public_web(
    industry: str = "",
    companies: list[str] = [],
    job_keywords: list[str] = [],
    max_results: int = 30,
    _search_func=None,
) -> list[dict]:
    """
    从公开Web来源采集人才信息。

    Args:
        industry: 行业关键词
        companies: 目标公司列表
        job_keywords: 岗位关键词
        max_results: 最大返回数
        _search_func: WebSearch函数注入（Agent环境使用）

    Returns:
        list of dict: 每条包含 {name, company, title, source, text, url}
    """
    results = []

    if _search_func is None:
        print("[public_web] No search function provided, using mock data for testing")
        return _mock_results(companies[:5], job_keywords[:3])

    # 对每个目标公司执行不同维度的搜索
    for company in companies[:10]:
        queries = []

        # 维度1：行业会议演讲者
        queries.append(f"{company} 演讲嘉宾 行业峰会 2024 2025")

        # 维度2：专利发明人
        queries.append(f"{company} 专利 发明人")

        # 维度3：知乎专业回答
        queries.append(f"site:zhihu.com {company} {job_keywords[0] if job_keywords else ''}")

        for query in queries[:2]:  # 限制每个公司的搜索次数
            try:
                raw_results = _search_func(query)
                for r in raw_results[:5]:
                    extracted = _extract_person_from_snippet(
                        r.get("snippet", "") or r.get("title", ""),
                        source_url=r.get("url", ""),
                        source_type="public_web",
                        search_query=query,
                    )
                    if extracted.get("name") or extracted.get("company"):
                        extracted["raw_text"] = r.get("snippet", "")
                        results.append(extracted)
            except Exception as e:
                print(f"[public_web] Search failed for '{query}': {e}")
                continue

    return results[:max_results]


def _extract_person_from_snippet(
    snippet: str,
    source_url: str = "",
    source_type: str = "public_web",
    search_query: str = "",
) -> dict:
    """从搜索摘要中提取人名和公司"""
    result = {
        "name": "",
        "company": "",
        "title": "",
        "source": source_type,
        "url": source_url,
        "search_query": search_query,
        "text": snippet,
    }

    # 中文姓名匹配
    name_patterns = [
        r'([一-鿿]{2,4})[（(].*?(?:创始人|CEO|总裁|总监|经理|工程师|专家|负责人)',
        r'(?:创始人|CEO|总裁|总监|经理)[：:]*\s*([一-鿿]{2,4})',
    ]
    for pat in name_patterns:
        m = re.search(pat, snippet)
        if m:
            result["name"] = m.group(1)
            break

    # 公司名匹配
    company_kw = ["字节跳动", "美团", "快手", "京东", "百度", "腾讯", "阿里巴巴",
                  "小红书", "小米", "滴滴", "宁德时代", "比亚迪", "华为", "网易"]
    for kw in company_kw:
        if kw in snippet:
            result["company"] = kw
            break

    # 职位匹配
    title_kw = ["CEO", "CTO", "CFO", "COO", "总裁", "总监", "经理", "工程师",
                "专家", "负责人", "VP", "副总裁", "创始人"]
    for kw in title_kw:
        if kw in snippet:
            result["title"] = kw
            break

    return result


def _mock_results(companies: list[str], keywords: list[str]) -> list[dict]:
    """Mock 数据用于测试"""
    return [
        {
            "name": "示例用户",
            "company": companies[0] if companies else "某公司",
            "title": keywords[0] if keywords else "某职位",
            "source": "public_web",
            "url": "https://example.com",
            "search_query": f"{companies[0]} {keywords[0]}",
            "text": "这是一个mock结果，实际使用时需提供 _search_func",
        }
    ]
