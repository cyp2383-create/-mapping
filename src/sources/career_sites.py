"""
公司官方招聘网站采集器 — 100%合法, 零反爬

已知Career站点:
  - 字节跳动: https://jobs.bytedance.com/
  - 阿里巴巴: https://talent.alibaba.com/
  - 腾讯: https://careers.tencent.com/
  - 美团: https://zhaopin.meituan.com/
  - 百度: https://talent.baidu.com/
  - 京东: https://zhaopin.jd.com/
"""
import urllib.parse, json, time
from .base import PlatformSource, llm_ask


CAREER_SITES = {
    "字节跳动": "https://jobs.bytedance.com/search?keyword={query}&location=CT_11",
    "美团": "https://zhaopin.meituan.com/web/search?keyword={query}",
    "京东": "https://zhaopin.jd.com/web/search?keyword={query}",
    "腾讯": "https://careers.tencent.com/search.html?keyword={query}",
    "百度": "https://talent.baidu.com/jobs/search?keyword={query}&location=北京",
}


class CareerSiteSource(PlatformSource):
    name = "career"
    base_url = "https://jobs.bytedance.com"
    cookie_file = "cookies/career.json"
    default_login_url = "https://jobs.bytedance.com/"

    def search_company_jds(self, company: str, keywords: str = "",
                           max_results: int = 8) -> list[dict]:
        """搜指定公司的官方招聘站"""
        if not self.connect():
            return []

        # 找对应URL模板
        template = None
        for name, url_template in CAREER_SITES.items():
            if name in company or company in name:
                template = url_template
                break

        if not template:
            print(f"[career] No career site for {company}")
            return []

        query = keywords or "采购"
        encoded = urllib.parse.quote(query)
        url = template.format(query=encoded)

        print(f"[career] {company}: {url[:100]}")
        self.goto(url)
        time.sleep(10)

        text = self.page_text()
        jds = self._extract(text, company, max_results)

        for jd in jds:
            jd["source_platform"] = f"career_{company}"
            jd["source_url"] = url

        self.save_cookies()
        return jds

    def _extract(self, text: str, company: str, max_n: int) -> list[dict]:
        prompt = f"""公司官方招聘网站。提取所有可见岗位: title,company,salary,location,experience,education,responsibilities,requirements,skills,bonus。这是{company}的官方招聘。最多{max_n}个。JSON数组。文本:{text[:8000]}"""
        result = llm_ask(prompt, 2500).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: return json.loads(result)
        except: return []

    def collect(self, company: str, keywords: str = "", max_results: int = 8) -> list[dict]:
        return self.search_company_jds(company=company, keywords=keywords, max_results=max_results)
