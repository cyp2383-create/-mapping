"""
Web搜索采集器 — Tavily + DuckDuckGo 双引擎

Tavily: 专为AI Agent优化, 免费1000次/月, 需API Key (tavily.com)
DuckDuckGo: 完全免费, 无需注册, 中文稍弱但不限次数

优先级: Tavily > DuckDuckGo
"""
import json
from .base import PlatformSource, llm_ask


class WebSearchSource(PlatformSource):
    """不依赖浏览器, 纯API搜索。need_login=False"""
    name = "websearch"
    require_login = False

    def __init__(self, tavily_key: str = ""):
        super().__init__()
        self.tavily_key = tavily_key

    def search_jds(self, keywords: str = "", company: str = "",
                   max_results: int = 8) -> list[dict]:
        """搜索JD"""
        query = f"{company} {keywords} 招聘 岗位职责 任职要求" if company else keywords
        results = self._search(query, max_results)
        if not results:
            return []

        # LLM提取结构化JD，保留source URL
        items = []
        for r in results[:max_results]:
            items.append(f"URL:{r['url']}\n{r['title']}\n{r['snippet']}")
        text = "\n---\n".join(items)

        prompt = f"""Extract job listings from these search results about: {query}
Each JD: title, company, salary, location, experience, education, industry,
skills[](specific tools/tech), responsibilities(3-5 items), requirements(3-5 items),
source_url(the URL from the result).
Only real JDs. Max {max_results}. JSON array.
Results: {text[:8000]}"""
        jds = self.llm_extract(text, prompt)
        for jd in jds:
            jd["source_platform"] = "websearch"
            jd["search_query"] = query
            # Ensure URL is saved
            if not jd.get("source_url") or not jd["source_url"]:
                # Find matching URL from results
                for r in results:
                    if r.get("title","")[:30] in jd.get("title","")[:30]:
                        jd["source_url"] = r.get("url","")
                        break
        return jds

    def search_people(self, keywords: str = "", company: str = "",
                      max_results: int = 10) -> list[dict]:
        """搜索候选人 — 优先LinkedIn"""
        query = f'site:linkedin.com/in/ "{keywords}" {company}' if company else f'site:linkedin.com/in/ "{keywords}"'
        results = self._search(query, max_results)
        if not results:
            return []

        text = "\n---\n".join(f"URL:{r['url']}\n{r['title']}\n{r['snippet']}" for r in results[:max_results])
        prompt = f"""Extract people profiles from LinkedIn search results about: {keywords}
Each: name, current_title, current_company, city, country, linkedin_url(the URL), source_profile(snippet).
Only real people. Max {max_results}. JSON array.
Results: {text[:8000]}"""
        profiles = self.llm_extract(text, prompt)
        for p in profiles:
            p["source_platform"] = "linkedin"
            p["search_query"] = query
            if p.get("linkedin_url"):
                p["contact_type"] = "linkedin"
                p["contact_value"] = p["linkedin_url"]
                p["contact_confidence"] = 0.9
        return profiles

    def _search(self, query: str, max_n: int = 10) -> list[dict]:
        """先试Tavily, 不行用DuckDuckGo"""
        # Tavily
        if self.tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=self.tavily_key)
                resp = client.search(query, max_results=max_n, search_depth="advanced")
                results = []
                for r in resp.get("results", []):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("content", "")[:500],
                    })
                if results:
                    print(f"[websearch] Tavily: {len(results)} results for '{query[:50]}'")
                    return results
            except Exception as e:
                print(f"[websearch] Tavily error: {e}")

        # DuckDuckGo fallback (free, no key needed)
        try:
            from ddgs import DDGS
            results = []
            for r in DDGS().text(query, max_results=max_n):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")[:500],
                })
            print(f"[websearch] DuckDuckGo: {len(results)} results for '{query[:50]}'")
            return results
        except ImportError:
            print("[websearch] pip install ddgs")
        except Exception as e:
            print(f"[websearch] DDG error: {e}")

        return []
