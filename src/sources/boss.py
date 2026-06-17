"""
BOSS直聘采集器 — 双模式: JD采集(公开) + 候选人搜索(需登录)
"""
import urllib.parse
import json
from .base import PlatformSource, llm_ask


class BossSource(PlatformSource):
    name = "boss"
    base_url = "https://www.zhipin.com"
    cookie_file = "cookies/boss.json"
    default_login_url = "https://www.zhipin.com/web/geek?query=test"

    # ====== JD搜索 (公开，无需登录) ======

    def search_jds(self, keywords: str = "", company: str = "",
                   city_code: str = "101010100", max_results: int = 10) -> list[dict]:
        """搜索BOSS直聘JD —— 拦截API响应拿原始数据"""
        if not self.connect():
            return []

        query = f"{keywords} {company}".strip()
        encoded = urllib.parse.quote(query)
        url = f"https://www.zhipin.com/web/geek/job?query={encoded}&city={city_code}"

        print(f"[boss] Searching JDs: {query}")

        # 拦截API响应
        api_data = []

        def handle_response(response):
            if "/wapi/zppgw/search" in response.url or "/wapi/zpgeek/search" in response.url:
                try:
                    data = response.json()
                    api_data.append(data)
                except:
                    pass

        self._page.on("response", handle_response)

        self.goto(url)
        self.wait(8)
        try: self.scroll(times=3)
        except: pass
        self.wait(3)

        # 如果有API数据，直接解析
        if api_data:
            jds = self._parse_api_response(api_data, max_results)
            print(f"[boss] API intercepted: {len(jds)} JDs")
        else:
            # 回退到LLM从页面文本提取
            print("[boss] No API data, using page text...")
            text = self.page_text()
            jds = self._llm_extract_jds(text, max_results)

        for jd in jds:
            jd["source_platform"] = "boss"
            jd["source_url"] = url
            jd["search_query"] = query

        self.save_cookies()
        return jds

    def _llm_extract_jds(self, page_text: str, max_results: int) -> list[dict]:
        """用LLM从JD搜索页提取岗位信息"""
        # 只取可能包含JD的部分，避免LLM编造不相关的职位
        prompt = f"""This is a BOSS Zhipin job search result page. Extract ONLY real job listings visible in the text.
For each job: title, company, salary, location, experience, education, tags[], description_preview.
If the text doesn't contain real job listings matching the search query, return empty array [].
DO NOT fabricate jobs that aren't in the text.
Max {max_results} jobs. Return JSON array only.
Text: {page_text[:8000]}"""

        result = llm_ask(prompt, max_tokens=2500)
        try:
            result = result.strip()
            if result.startswith("```"): result = result.split("\n", 1)[1]
            if result.endswith("```"): result = result[:-3]
            return json.loads(result)
        except json.JSONDecodeError:
            return []

    def _parse_api_response(self, api_data: list, max_results: int) -> list[dict]:
        """解析BOSS API响应"""
        jds = []
        for data in api_data:
            zp_data = data.get("zpData", {}) or data
            jobs = zp_data.get("jobList", []) or zp_data.get("list", []) or []
            for job in jobs[:max_results]:
                jds.append({
                    "title": job.get("jobName", ""),
                    "company": job.get("brandName", "") or job.get("companyName", ""),
                    "salary": job.get("salaryDesc", ""),
                    "location": job.get("cityName", "") or job.get("areaDistrict", ""),
                    "experience": job.get("experienceName", ""),
                    "education": job.get("educationName", ""),
                    "tags": job.get("skills", []) or job.get("tags", []) or [],
                    "description_preview": (job.get("jobDescription", "") or job.get("description", ""))[:200],
                    "url": f"https://www.zhipin.com/job_detail/{job.get('jobId','')}.html" if job.get("jobId") else "",
                })
        return jds

    # ====== 候选人搜索 (需要登录) ======

    def search_url(self, company: str, keywords: str = "") -> str:
        query = f"{keywords} {company}".strip() if keywords else company
        return f"https://www.zhipin.com/web/geek?query={urllib.parse.quote(query)}&city=101010100"

    def collect_batch(self, companies: list[str], keywords: str = "",
                      max_per_company: int = 8) -> list[dict]:
        if not self.connect():
            return []
        self.load_cookies()

        if not self.llm_is_logged_in():
            print(f"[boss] Need recruiter login. Please login then tell me 'OK'.")
            return []

        print(f"[boss] Logged in. Searching {len(companies)} companies...")
        self.save_cookies()

        all_results = []
        for i, company in enumerate(companies):
            if i > 0:
                import time
                time.sleep(12)
            url = self.search_url(company, keywords)
            try:
                self.goto(url)
                self.wait(5)
                self.scroll(times=3)
                text = self.page_text()
                profiles = self.llm_extract_profiles(text, company, max_per_company)
                for p in profiles:
                    p["source_platform"] = self.name
                    p.setdefault("current_company", company)
                all_results.extend(profiles)
                print(f"[boss]   {company}: {len(profiles)}")
            except Exception as e:
                print(f"[boss]   {company} error: {e}")
                continue

        self.save_cookies()
        return all_results

    def collect(self, company: str, keywords: str = "",
                max_results: int = 8) -> list[dict]:
        return self.collect_batch([company], keywords, max_results)
