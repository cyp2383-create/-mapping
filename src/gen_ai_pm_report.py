"""Generate AI PM talent mapping report"""
import os, sys, json
os.environ['NO_PROXY'] = 'api.deepseek.com'
sys.path.insert(0, '.')
from storage import query_talents, query_jds
from sources.base import llm_ask

talents = query_talents(position_id=4, limit=100)
jds = query_jds(position_id=4, limit=50)

# Build candidate profiles
cand_lines = []
for t in talents:
    cand_lines.append(
        f"{t.get('name','?')} | {t.get('current_company','')} | "
        f"{t.get('current_title','')} | skills:{t.get('skills','[]')} | "
        f"profile:{t.get('source_profile','')[:200]}"
    )

# Build JD summaries
jd_lines = []
for j in jds:
    jd_lines.append(
        f"{j.get('title','')} | {j.get('company','')} | "
        f"salary:{j.get('salary','')} | exp:{j.get('experience','')} | "
        f"edu:{j.get('education','')} | "
        f"resp:{j.get('responsibilities','')[:300]} | "
        f"reqs:{j.get('requirements','')[:300]}"
    )

prompt = f"""Based on 25 real Maimai candidates + 17 real JDs about AI Product Manager roles in Beijing internet companies, answer TWO questions in a concise HTML report:

Q1: WHAT DOES THE MARKET DEMAND? (from JDs)
- Common hard skills across companies (LLM/Agent/RAG/Prompt Engineering etc)
- Experience and education requirements
- Salary ranges by level
- What makes a candidate stand out

Q2: WHO ARE THESE PEOPLE? (from Maimai candidates)
- What companies do they come from?
- What titles/levels do they hold?
- What skills do they display?
- Any notable patterns (cross-industry, unique backgrounds)

Report format: Clean white HTML, body only, sections with clear headers.
Mark each data point: [JD data] or [Candidate data].

Candidates ({len(cand_lines)}):
{chr(10).join(cand_lines[:80])}

JDs ({len(jd_lines)}):
{chr(10).join(jd_lines[:30])}"""

report = llm_ask(prompt, 4000)
if report.startswith('```html'):
    report = report.split('\n', 1)[1]
if '```' in report[-20:]:
    report = report.rsplit('```', 1)[0]

with open('data/exports/talent_insight_report.html', 'w', encoding='utf-8') as f:
    f.write(report)
print(f'Report: {len(report)} chars')
