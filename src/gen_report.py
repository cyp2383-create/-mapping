"""Generate talent profile report with [真实]/[推理] markers"""
import sys, json
sys.path.insert(0, '.')
from storage import query_talents
from sources.base import llm_ask
from collections import Counter

talents = query_talents(position_id=1, limit=200)

# === 硬统计（100%真实） ===
companies = Counter(t['current_company'] for t in talents if t.get('current_company'))
levels = Counter()
titles = [t.get('current_title','') for t in talents]
for t in titles:
    for kw in ['总监','经理','专家','负责人','主管','VP']:
        if kw in t: levels[kw] += 1; break
    else: levels['其他'] += 1

all_skills = []
for t in talents:
    try:
        s = json.loads(t.get('skills','[]'))
        if isinstance(s, list): all_skills.extend(s)
    except: pass
skill_counts = Counter(all_skills)

profiles = [t.get('source_profile','') for t in talents if t.get('source_profile','')]
profile_kw = Counter()
for p in profiles:
    for kw in ['曾任','采购','供应链','招标','供应商','ERP','SAP','海外','跨境','体系','项目','管理','负责']:
        if kw in p: profile_kw[kw] += 1

# Build candidate text
lines = []
for t in talents:
    lines.append(f"{t['name']} | {t['current_company']} | {t['current_title']} | skills:{t.get('skills','[]')} | profile:{t.get('source_profile','')[:200]}")

prompt = f"""基于66位真实候选人数据生成HTML人才画像报告。

## 规则：每个数据点必须标注来源 ##
- 数据直接来自DB的（公司/职级/技能统计）→ 标注 [真实数据]
- DeepSeek根据行业知识推断的（薪酬范围/软技能/趋势判断）→ 标注 [AI推理]

## 以下是100%真实数据，直接引用 ##
公司分布: {dict(companies.most_common(10))}
职级分布: {dict(levels.most_common())}
硬技能TOP15: {dict(skill_counts.most_common(15))}
经历关键词: {dict(profile_kw.most_common())}

## 报告板块（白色背景HTML，直接输出<body>）##

1.【数据概况】— 引用上面真实数据。标注[真实数据]。

2.【硬技能画像】— 从上面技能统计提取TOP10，按品类分组。[真实数据]

3.【软技能标签】— 从职位和经历推断。[AI推理]

4.【薪酬对标】— 按职级估算北京互联网大厂薪酬区间。[AI推理] 说明：候选人数据不含薪酬，以下为行业经验推断。

5.【人才流动信号】— 曾任职信息来自profile摘要，其余为推断。[真实+推理混合]

6.【寻访优先级】— P0/P1/P2分级，基于公司人才密度和可挖性。[AI推理]

7.【数据说明】— 数据源(脉脉66条Profile)、采集方式(CDP+DeepSeek提取)、置信度说明。

每个板块标题后标注[真实数据]/[AI推理]/[混合]。在板块内部，具体数字来自DB的标绿，AI推测的标灰。

候选原始数据:
{chr(10).join(lines[:100])}"""

report = llm_ask(prompt, max_tokens=4000)
if report.startswith('```html'): report = report.split('\n', 1)[1]
if '```' in report[-20:]: report = report.rsplit('```', 1)[0]
if '以下是' in report[:50]: report = report.split('\n', 1)[1]

with open('data/exports/talent_insight_report.html', 'w', encoding='utf-8') as f:
    f.write(report)
print(f'Report: {len(report)} chars')
