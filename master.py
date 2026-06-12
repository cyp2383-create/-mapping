#!/usr/bin/env python3
"""
Talent Mapper — 一键人才地图生成

用法:
  python master.py --industry "AI大模型" --role "AI产品经理" --mode full
  python master.py --industry "新能源汽车" --role "电池研发" --mode quick
  python master.py --industry "金融科技" --role "合规总监" --mode jd_only

模式:
  quick    = JD搜索 + 报告 (无需浏览器, 2-3分钟)
  full     = JD搜索 + 脉脉候选人 + 报告 (需Chrome CDP登录脉脉)
  jd_only  = 仅JD搜索 (不生成报告)
"""

import os, sys, json, time, argparse, subprocess
sys.path.insert(0, 'src')

os.environ['NO_PROXY'] = 'api.deepseek.com,api.tavily.com'
DEEPSEEK_KEY = "sk-e7ccc027dcab4822bf054d96d052c032"
TAVILY_KEY   = "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"


def run(cmd):
    """Run a command, print output"""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip()[:500])
    return result.returncode


def step1_create_position(industry, role):
    """Create a new position in the database"""
    from storage import init_db, create_position
    init_db()
    pid = create_position(f"{role}-{industry}", industry, role)
    print(f"[Step 1] Position created: id={pid}")
    return pid


def step2_generate_companies(industry, role):
    """DeepSeek generates target companies"""
    from extractor import generate_target_companies
    companies = generate_target_companies(industry, role, DEEPSEEK_KEY)
    names = [c["name"] for c in companies]
    print(f"[Step 2] {len(names)} target companies generated")
    for c in companies[:10]:
        print(f"  [{c['tier']}] {c['name']}")
    return names


def step3_search_jds(companies, role, position_id):
    """Tavily API search for JDs"""
    from sources.web_search import WebSearchSource
    from storage import upsert_jd

    s = WebSearchSource(tavily_key=TAVILY_KEY)
    total = 0
    for c in companies[:12]:  # Max 12 companies to stay within API limits
        jds = s.search_jds(company=c, keywords=role, max_results=2)
        for jd in jds:
            try:
                upsert_jd({
                    "position_id": position_id,
                    "title": str(jd.get("title", "")),
                    "company": str(jd.get("company", "")),
                    "salary": str(jd.get("salary", "")),
                    "location": str(jd.get("location", "")),
                    "experience": str(jd.get("experience", "")),
                    "education": str(jd.get("education", "")),
                    "industry": str(jd.get("industry", "")),
                    "skills": json.dumps(jd.get("skills", []) if isinstance(jd.get("skills"), list) else [], ensure_ascii=False),
                    "responsibilities": str(jd.get("responsibilities", ""))[:2000],
                    "requirements": str(jd.get("requirements", ""))[:2000],
                    "source_platform": "websearch",
                    "confidence": 0.85,
                    "search_query": f"{c} {role}",
                })
                total += 1
            except:
                pass
        if jds:
            print(f"  {c}: {len(jds)} JDs")

    from storage import count_jds
    print(f"[Step 3] Total JDs: {count_jds(position_id)}")
    return total


def step4_maimai_candidates(companies, role, position_id):
    """Maimai CDP candidate search (requires Chrome)"""
    from sources.maimai import MaimaiSource
    from storage import upsert_talent
    from contact import enrich_contact

    s = MaimaiSource()
    if not s.connect():
        print("[Step 4] Maimai CDP not available — skip. Start Chrome with: chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\temp\\chrome-debug")
        return 0

    s.load_cookies()
    total = 0
    # STRICT RATE LIMIT: only 5 companies, 30s between each, to avoid Maimai ban
    search_companies = companies[:5]
    for i, c in enumerate(search_companies):
        if i > 0:
            time.sleep(30)
        try:
            profiles = s.collect(c, keywords=role, max_results=5)
            for p in profiles:
                p["position_id"] = position_id
                p = enrich_contact(p)
                upsert_talent(p)
                total += 1
            print(f"  {c}: {len(profiles)} candidates (delay 30s)")
        except Exception as e:
            print(f"  {c}: {e}")

    s.save_cookies()
    from storage import count_talents
    print(f"[Step 4] Total candidates: {count_talents(position_id)}")
    return total


def step5_enrich_skills():
    """Add inferred hard skills to all records"""
    from storage import get_conn
    from sources.base import llm_ask
    conn = get_conn()

    # Enrich talents
    talents = conn.execute("SELECT * FROM talents WHERE (skills IS NULL OR skills='[]' OR skills='')").fetchall()
    for t in talents:
        text = f"{t['current_title']} | {t['current_company']}"
        prompt = f"Infer 5-7 hard skills. JSON array. Text: {text}"
        result = llm_ask(prompt, 200).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try:
            conn.execute("UPDATE talents SET skills=? WHERE id=?", (result, t["id"]))
        except: pass

    conn.commit()
    conn.close()
    print("[Step 5] Skills enriched")


def step6_generate_report(position_id, industry, role):
    """Generate final HTML report with [真实]/[推理] markers"""
    from storage import query_talents, query_jds
    from sources.base import llm_ask

    talents = query_talents(position_id=position_id, limit=200)
    jds = query_jds(position_id=position_id, limit=100)

    cand_lines = []
    for t in talents:
        cand_lines.append(
            f"{t.get('name','?')} | {t.get('current_company','')} | "
            f"{t.get('current_title','')} | skills:{t.get('skills','[]')} | "
            f"profile:{t.get('source_profile','')[:200]}"
        )

    jd_lines = []
    for j in jds:
        jd_lines.append(
            f"{j.get('title','')} | {j.get('company','')} | "
            f"salary:{j.get('salary','')} | exp:{j.get('experience','')} | "
            f"edu:{j.get('education','')} | "
            f"resp:{j.get('responsibilities','')[:300]} | "
            f"reqs:{j.get('requirements','')[:300]}"
        )

    prompt = f"""Based on real job listings and candidate data about {role} in {industry}, answer in HTML:

Q1: WHAT DOES THE MARKET DEMAND? (from {len(jd_lines)} JDs)
- Common hard skills, experience/education requirements, salary ranges

Q2: WHO ARE THESE PEOPLE? (from {len(cand_lines)} candidates)
- Companies, titles, skills, notable patterns

Mark each data point: [JD data] or [Candidate data] or [AI inference].
White HTML, body only, sections with clear headers.

Candidates:
{chr(10).join(cand_lines[:80])}

JDs:
{chr(10).join(jd_lines[:40])}"""

    report = llm_ask(prompt, 4000)
    if report.startswith("```html"): report = report.split("\n", 1)[1]
    if "```" in report[-20:]: report = report.rsplit("```", 1)[0]

    path = f"data/exports/{industry}_{role}_report.html".replace(" ", "_")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"[Step 6] Report: {path} ({len(report)} chars)")
    return path


def main():
    parser = argparse.ArgumentParser(description="Talent Mapper")
    parser.add_argument("--industry", required=True, help="e.g. AI大模型, 新能源汽车")
    parser.add_argument("--role", required=True, help="e.g. AI产品经理, 电池研发工程师")
    parser.add_argument("--mode", default="quick", choices=["quick", "full", "jd_only"])
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Talent Mapper: {args.role} in {args.industry}")
    print(f"  Mode: {args.mode}")
    print(f"{'='*60}\n")

    # Step 1-2: Setup
    pid = step1_create_position(args.industry, args.role)
    companies = step2_generate_companies(args.industry, args.role)

    # Step 3: JD search (always)
    step3_search_jds(companies, args.role, pid)

    # Step 4: Candidates (only in full mode)
    if args.mode == "full":
        step4_maimai_candidates(companies, args.role, pid)

    # Step 5-6: Enrich + Report (skip in jd_only mode)
    if args.mode != "jd_only":
        step5_enrich_skills()
        path = step6_generate_report(pid, args.industry, args.role)
        print(f"\nDone! Report: {path}")
        # Try to open
        try:
            os.startfile(os.path.abspath(path))
        except:
            pass

    print(f"\nView all data: python -c \"from src.web.app import run; run(5000)\"")
    print(f"Then open: http://localhost:5000/?position_id={pid}")


if __name__ == "__main__":
    main()
