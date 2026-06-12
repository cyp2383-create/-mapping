"""
LinkedIn(领英)采集器

搜索: https://www.linkedin.com/search/results/people/?keywords=...
注意: 中国IP可能受限, 建议用国际版 linkedin.com
"""
import urllib.parse
import json
import time
from .base import PlatformSource, llm_ask


class LinkedInSource(PlatformSource):
    name = "linkedin"
    base_url = "https://www.linkedin.com"
    cookie_file = "cookies/linkedin.json"
    default_login_url = "https://www.linkedin.com/search/results/people/?keywords=test"

    def search_people(self, keywords: str = "", company: str = "",
                      max_results: int = 10) -> list[dict]:
        if not self.connect():
            return []

        query = f"{keywords} {company}".strip()
        encoded = urllib.parse.quote(query)
        url = f"https://www.linkedin.com/search/results/people/?keywords={encoded}"

        print(f"[linkedin] Search: {query}")
        self.goto(url)
        time.sleep(8)

        if "login" in self.page_url().lower() or "signin" in self.page_url().lower():
            print(f"[linkedin] Login required. Please login in browser.")
            self.save_cookies()
            return []

        text = self.page_text()
        profiles = self._extract_profiles(text, company, max_results)

        for p in profiles:
            p["source_platform"] = "linkedin"
            p["source_url"] = url
            p.setdefault("current_company", company)

        self.save_cookies()
        return profiles

    def _extract_profiles(self, text: str, company: str, max_n: int) -> list[dict]:
        prompt = f"""LinkedIn people search results. Extract real profiles only.
Each: name, current_title, current_company, city, total_years, education_summary, skills[], industry.
If name hidden or truncated, mark name_hidden:true.
Max {max_n}. JSON array only. Default company: {company}.
Text: {text[:8000]}"""
        result = llm_ask(prompt, 2500).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []

    def search_url(self, company: str, keywords: str = "") -> str:
        q = f"{keywords} {company}".strip() if keywords else company
        return f"https://www.linkedin.com/search/results/people/?keywords={urllib.parse.quote(q)}"

    def collect(self, company: str, keywords: str = "", max_results: int = 10) -> list[dict]:
        return self.search_people(keywords=keywords, company=company, max_results=max_results)
