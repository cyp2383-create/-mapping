"""
Apollo.io People Search — 全球人才数据库

API: POST https://api.apollo.io/v1/mixed_people/search
Free tier: 250 contacts/month
"""
import json, httpx, time
from .base import PlatformSource


APOLLO_KEY = "ijP9CSVbFdnG3W63sXfqxg"
APOLLO_URL = "https://api.apollo.io/v1/mixed_people/search"


class ApolloSource(PlatformSource):
    name = "apollo"
    require_login = False  # Pure API, no browser needed

    def search_people(self, keywords: str = "", titles: list = None,
                      locations: list = None, companies: list = None,
                      max_results: int = 25) -> list[dict]:
        """Search Apollo people database"""
        if not keywords and not titles and not companies:
            return []

        body = {
            "q_keywords": keywords or "",
            "page": 1,
            "per_page": min(max_results, 25),
        }
        if titles:
            body["person_titles"] = titles
        if locations:
            body["organization_locations"] = locations
        if companies:
            body["q_organization_name"] = companies[0] if len(companies) == 1 else ""

        try:
            resp = httpx.post(APOLLO_URL, json=body,
                headers={"X-Api-Key": APOLLO_KEY, "Content-Type": "application/json"},
                timeout=30)
            data = resp.json()
            people = data.get("contacts", []) or data.get("people", [])
        except Exception as e:
            print(f"[apollo] Error: {e}")
            return []

        results = []
        for p in people[:max_results]:
            results.append({
                "name": p.get("name", ""),
                "current_title": p.get("title", ""),
                "current_company": p.get("organization_name", ""),
                "city": p.get("city", ""),
                "country": p.get("country", ""),
                "email": p.get("email", "") or "",
                "linkedin_url": p.get("linkedin_url", ""),
                "skills": json.dumps(p.get("keywords", []) or [], ensure_ascii=False),
                "education": json.dumps(p.get("education", []) or [], ensure_ascii=False),
                "total_years": p.get("years_of_experience", 0) or 0,
                "source_platform": "apollo",
                "source_url": p.get("linkedin_url", ""),
                "source_profile": f"{p.get('name','')} | {p.get('title','')} | {p.get('organization_name','')}",
                "confidence": 0.9,
                "contact_type": "linkedin" if p.get("linkedin_url") else ("email" if p.get("email") else "none"),
                "contact_value": p.get("linkedin_url", "") or p.get("email", ""),
                "contact_confidence": 0.85,
            })
        print(f"[apollo] {len(results)} people found for '{keywords[:50]}'")
        return results

    def collect(self, company: str = "", keywords: str = "",
                max_results: int = 25) -> list[dict]:
        return self.search_people(keywords=keywords, companies=[company] if company else None,
                                  max_results=max_results)
