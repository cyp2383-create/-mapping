"""
智联招聘采集器 — 公开JD搜索

搜索: https://www.zhaopin.com/sou/?kw=...
"""
import urllib.parse, json, time
from .base import PlatformSource, llm_ask


class ZhaopinSource(PlatformSource):
    name = "zhaopin"
    base_url = "https://www.zhaopin.com"
    cookie_file = "cookies/zhaopin.json"
    default_login_url = "https://www.zhaopin.com/sou/?kw=test"

    def search_jds(self, keywords: str = "", company: str = "",
                   city: str = "北京", max_results: int = 5) -> list[dict]:
        if not self.connect():
            return []

        query = f"{keywords} {company}".strip()
        encoded = urllib.parse.quote(query)
        search_url = f"https://www.zhaopin.com/sou/?kw={encoded}&city={urllib.parse.quote(city)}"

        print(f"[zhaopin] Search: {query}")
        self.goto(search_url)
        time.sleep(8)

        # Get detail URLs from search results
        detail_urls = self._get_detail_urls(max_results)
        print(f"[zhaopin] Detail URLs: {len(detail_urls)}")

        all_jds = []
        if detail_urls:
            for i, url in enumerate(detail_urls):
                if i > 0: time.sleep(4)
                try:
                    self.goto(url)
                    time.sleep(5)
                    text = self.page_text()
                    jd = self._extract_detail(text)
                    if jd and jd.get("title"):
                        jd["source_platform"] = "zhaopin"
                        jd["source_url"] = url
                        jd["search_query"] = query
                        all_jds.append(jd)
                except Exception as e:
                    continue
        else:
            # Fallback: extract from search page
            text = self.page_text()
            all_jds = self._extract(text, max_results)
            for jd in all_jds:
                jd["source_platform"] = "zhaopin"
                jd["source_url"] = search_url
                jd["search_query"] = query

        self.save_cookies()
        return all_jds

    def _get_detail_urls(self, max_n: int) -> list[str]:
        urls = []
        seen = set()
        links = self._page.query_selector_all('a[href*="/job/"]')
        for link in links[:max_n * 2]:
            href = link.get_attribute("href")
            if href and "/job/" in href:
                import re
                m = re.search(r'/job/(\d+)', href)
                if m and m.group(1) not in seen:
                    seen.add(m.group(1))
                    if not href.startswith("http"):
                        href = "https:" + href if href.startswith("//") else "https://www.zhaopin.com" + href
                    urls.append(href)
        return urls[:max_n]

    def _extract_detail(self, text: str) -> dict:
        prompt = f"""Zhaopin job detail page. Extract ALL visible fields.
title, company, salary, location, experience, education, industry, company_size,
responsibilities(job duties from the page, 3-5 items as array),
requirements(qualifications from the page, 3-5 items as array),
skills(tags array), bonus(perks/benefits).
If text has job description content, include it in responsibilities.
Return JSON object. Text: {text[:6000]}"""
        result = llm_ask(prompt, 2500).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return {}

    def _extract(self, text: str, max_n: int) -> list[dict]:
        prompt = f"""智联招聘搜索结果。提取真实岗位。每个: title,company,salary,location,experience,education,industry,company_size,responsibilities,requirements,skills,bonus。只提取匹配搜索关键词的。最多{max_n}个。JSON数组。文本:{text[:8000]}"""
        result = llm_ask(prompt, 2500).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []

    def collect(self, company: str, keywords: str = "", max_results: int = 8) -> list[dict]:
        return self.search_jds(keywords=keywords, company=company, max_results=max_results)
