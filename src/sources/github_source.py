"""
GitHub API — 免费技术人才搜索

搜索: GET /search/users?q=location:Beijing+language:Python
详情: GET /users/{username}
限制: 无认证60次/小时, 有Token 5000次/小时
"""
import json, time
import httpx
from .base import PlatformSource


GITHUB_API = "https://api.github.com"
GITHUB_TOKEN = ""  # Optional: increase rate limit to 5000/hr


class GitHubSource(PlatformSource):
    name = "github"
    require_login = False

    def _api(self, path, params=None):
        headers = {"Accept": "application/vnd.github.v3+json"}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"
        resp = httpx.get(f"{GITHUB_API}{path}", params=params, headers=headers, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 403 and "rate limit" in resp.text.lower():
            print(f"[github] Rate limited. Wait or add token.")
        return None

    def search_people(self, keywords: str = "", location: str = "China",
                      language: str = "", max_results: int = 15) -> list[dict]:
        """Search developers by keyword, location, language"""
        q_parts = []
        if keywords:
            q_parts.append(keywords)
        if location:
            q_parts.append(f"location:{location}")
        if language:
            q_parts.append(f"language:{language}")

        q = " ".join(q_parts)
        data = self._api("/search/users", {"q": q, "per_page": min(max_results, 30)})
        if not data:
            return []

        users = data.get("items", [])[:max_results]
        print(f"[github] Found {len(users)} users for '{q[:60]}'")

        results = []
        for u in users:
            # Get detailed profile
            detail = self._api(f"/users/{u['login']}")
            time.sleep(0.5)  # Rate limit safety

            profile = {
                "name": (detail.get("name") or u.get("login", "")) if detail else u.get("login", ""),
                "current_title": (detail.get("bio") or "")[:200] if detail else "",
                "current_company": (detail.get("company") or "") if detail else "",
                "city": (detail.get("location") or location) if detail else location,
                "email": (detail.get("email") or "") if detail else "",
                "linkedin_url": "",
                "skills": json.dumps([language] if language else [], ensure_ascii=False),
                "total_years": 0,
                "source_platform": "github",
                "source_url": u.get("html_url", ""),
                "source_profile": json.dumps(detail, ensure_ascii=False) if detail else "",
                "confidence": 0.85,
                "contact_type": "github",
                "contact_value": u.get("html_url", ""),
                "contact_confidence": 0.9,
                # Extra GitHub-specific fields
                "extra_fields": json.dumps({
                    "public_repos": detail.get("public_repos", 0) if detail else 0,
                    "followers": detail.get("followers", 0) if detail else 0,
                    "blog": detail.get("blog", "") if detail else "",
                    "hireable": detail.get("hireable", False) if detail else False,
                    "twitter": detail.get("twitter_username", "") if detail else "",
                }, ensure_ascii=False),
            }
            results.append(profile)
            if detail:
                print(f"  {profile['name'][:25]:25s} | {profile['current_company'][:20]:20s} | repos:{profile['extra_fields'].count('public_repos')}")

        return results

    def collect(self, company: str = "", keywords: str = "",
                location: str = "China", max_results: int = 15) -> list[dict]:
        return self.search_people(keywords=keywords or company, location=location,
                                  max_results=max_results)
