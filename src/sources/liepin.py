"""猎聘 — 搜索页公开，详情页需登录"""
import urllib.parse, json, time
from .base import PlatformSource


class LiepinSource(PlatformSource):
    name = "liepin"
    base_url = "https://www.liepin.com"
    login_url = "https://www.liepin.com/zhaopin/?key=test"
    cookie_file = "cookies/liepin.json"
    require_login = True  # 详情页

    def collect(self, company: str = "", keywords: str = "", max_results: int = 8) -> list[dict]:
        """从搜索页提取JD（详情页需登录后深入）"""
        if not self._page:
            if not self.connect():
                return []
            self.load_cookies()

        query = f"{keywords} {company}".strip()
        encoded = urllib.parse.quote(query)
        search_url = f"https://www.liepin.com/zhaopin/?key={encoded}"

        self.goto(search_url); time.sleep(8)
        text = self.page_text()
        prompt = f"""Liepin search results. Extract job listings.
Each: title, company, salary, location, experience, education, industry, skills[](tags), description_preview.
Max {max_results}. JSON array. Text: {text[:8000]}"""
        jds = self.llm_extract(text, prompt)
        for jd in jds:
            jd["source_platform"] = "liepin"
            jd["source_url"] = search_url
            jd["search_query"] = query
        return jds
