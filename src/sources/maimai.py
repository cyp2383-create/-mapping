"""脉脉 — 需要登录"""
import urllib.parse, json, time
from .base import PlatformSource


class MaimaiSource(PlatformSource):
    name = "maimai"
    base_url = "https://maimai.cn"
    login_url = "https://maimai.cn/web/search_center?type=contact&query=test"
    cookie_file = "cookies/maimai.json"
    require_login = True

    def search_url(self, company: str, keywords: str = "") -> str:
        q = f"{keywords} {company}".strip() if keywords else company
        return f"https://maimai.cn/web/search_center?type=contact&query={urllib.parse.quote(q)}"

    def collect(self, company: str, keywords: str = "", max_results: int = 8) -> list[dict]:
        if not self._page:
            if not self.connect():
                return []
            self.load_cookies()
        url = self.search_url(company, keywords)
        self.goto(url); time.sleep(6)
        text = self.page_text()
        prompt = f"""Maimai search results. Extract all visible people.
Each: name, current_title, current_company, city, total_years, name_hidden(bool), source_profile.
Default company: {company}. Max {max_results}. JSON array.
Text: {text[:6000]}"""
        profiles = self.llm_extract(text, prompt)
        for p in profiles:
            p["source_platform"] = "maimai"
            p.setdefault("current_company", company)
            p["source_url"] = url
        return profiles
