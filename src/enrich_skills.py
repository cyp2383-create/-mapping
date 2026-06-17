"""Enrich all talents and JDs with inferred skills via DeepSeek"""
import sys, json
sys.path.insert(0, '.')
from storage import get_conn
from sources.base import llm_ask

conn = get_conn()

# === Talents ===
talents = conn.execute('SELECT * FROM talents WHERE position_id=1').fetchall()
print(f'Talents: {len(talents)}')
for i, t in enumerate(talents):
    title = t['current_title'] or ''
    company = t['current_company'] or ''
    profile = t['source_profile'] or ''
    text = f'{title} | {company} | {profile[:200]}'

    prompt = f'Infer 5-7 hard skills from this profile title. Be specific: tools, certifications, methodologies. Return ONLY a JSON array. Text: {text}'
    result = llm_ask(prompt, 300)
    result = result.strip()
    if result.startswith('```'): result = result.split('\n', 1)[1]
    if result.endswith('```'): result = result[:-3]

    try:
        skills = json.loads(result)
        conn.execute('UPDATE talents SET skills=? WHERE id=?',
                     (json.dumps(skills, ensure_ascii=False), t['id']))
        if i % 10 == 0:
            print(f'  {i} {t["name"]}: {len(skills)} skills')
    except Exception as e:
        pass

# === JDs ===
jds = conn.execute('SELECT * FROM jds WHERE position_id=1').fetchall()
print(f'JDs: {len(jds)}')
for i, j in enumerate(jds):
    title = j['title'] or ''
    company = j['company'] or ''
    salary = j['salary'] or ''
    exp = j['experience'] or ''
    text = f'{title} | {company} | salary:{salary} | exp:{exp}'

    prompt = f'Infer 5-7 hard skills for this JD. Be specific: tools, certifications. Return ONLY a JSON array. Text: {text}'
    result = llm_ask(prompt, 300)
    result = result.strip()
    if result.startswith('```'): result = result.split('\n', 1)[1]
    if result.endswith('```'): result = result[:-3]

    try:
        skills = json.loads(result)
        conn.execute('UPDATE jds SET skills=? WHERE id=?',
                     (json.dumps(skills, ensure_ascii=False), j['id']))
        if i % 10 == 0:
            print(f'  {i} {title[:30]}: {len(skills)} skills')
    except Exception as e:
        pass

conn.commit()

# Verify
t = conn.execute('SELECT skills FROM talents LIMIT 1').fetchone()
j = conn.execute('SELECT skills FROM jds LIMIT 1').fetchone()
print(f'\nVerify talent: {t["skills"][:80]}')
print(f'Verify JD: {j["skills"][:80]}')
conn.close()
print('Done')
