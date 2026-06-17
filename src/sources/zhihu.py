"""
知乎采集器 — 从专业回答中提取人才信号

搜索: https://www.zhihu.com/search?type=people&q=...
       https://www.zhihu.com/search?type=content&q=...  (从回答内容中提取)

公开, 无需登录, 无反爬
"""
import urllib.parse
import json
import time
from .base import PlatformSource, llm_ask


class ZhihuSource(PlatformSource):
    name = "zhihu"
    base_url = "https://www.zhihu.com"
    cookie_file = "cookies/zhihu.json"
    default_login_url = "https://www.zhihu.com/search?type=people&q=test"

    def search_people(self, keywords: str = "", company: str = "",
                      max_results: int = 10) -> list[dict]:
        """搜索知乎用户（按人搜索）"""
        if not self.connect():
            return []

        query = f"{keywords} {company}".strip()
        encoded = urllib.parse.quote(query)
        url = f"https://www.zhihu.com/search?type=people&q={encoded}"

        print(f"[zhihu] People search: {query}")
        self.goto(url)
        time.sleep(6)

        text = self.page_text()
        profiles = self._extract_profiles(text, company, max_results)

        for p in profiles:
            p["source_platform"] = "zhihu"
            p["source_url"] = url

        self.save_cookies()
        return profiles

    def search_experts(self, topic: str = "", max_results: int = 10) -> list[dict]:
        """从话题/问题的回答者中提取专家身份"""
        if not self.connect():
            return []

        encoded = urllib.parse.quote(topic)
        url = f"https://www.zhihu.com/search?type=content&q={encoded}"

        print(f"[zhihu] Content search: {topic}")
        self.goto(url)
        time.sleep(8)

        text = self.page_text()
        profiles = self._extract_experts(text, max_results)

        for p in profiles:
            p["source_platform"] = "zhihu"
            p["source_url"] = url

        self.save_cookies()
        return profiles

    def _extract_profiles(self, text: str, company: str, max_n: int) -> list[dict]:
        prompt = f"""Zhihu search results. Extract ALL visible user cards.
Each card shows: username, headline(contains company+title), follower count.
Extract: name=username, headline, company(from headline), title(from headline), followers.
If the card shows real user data, include it. Skip navigation/UI elements.
Target company context: {company}. Max {max_n}. JSON array.
Text: {text[:8000]}"""
        result = llm_ask(prompt, 2000).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []
        result = llm_ask(prompt, 2000).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []

    def _extract_experts(self, text: str, max_n: int) -> list[dict]:
        prompt = f"""这是知乎话题搜索结果页。提取回答者的身份信息。
每人: name, headline(一句话简介中的公司+职位), company, title。
只提取真实存在的。最多{max_n}人。JSON数组。文本:{text[:8000]}"""
        result = llm_ask(prompt, 2000).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []

    def search_url(self, company: str, keywords: str = "") -> str:
        q = f"{keywords} {company}".strip() if keywords else company
        return f"https://www.zhihu.com/search?type=people&q={urllib.parse.quote(q)}"

    def collect(self, company: str, keywords: str = "", max_results: int = 10) -> list[dict]:
        return self.search_people(keywords=keywords, company=company, max_results=max_results)
