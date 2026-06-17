"""Flask Web - 人才+JD双表可视化"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, render_template_string, request
from storage import get_conn, list_positions, get_position, query_talents, query_jds, position_stats, count_talents, count_jds

app = Flask(__name__)

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Talent Miner</title>
<style>
:root{--p:#1a56db;--s:#10b981;--w:#f59e0b;--d:#ef4444;--bg:#f3f4f6;--c:#fff;--t:#111827;--ts:#6b7280;--b:#e5e7eb}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--t)}
.container{max-width:1500px;margin:0 auto;padding:24px}
.header{background:linear-gradient(135deg,#1a56db,#3b82f6);color:#fff;padding:28px 36px;border-radius:12px;margin-bottom:24px}
.header h1{font-size:22px}.header p{opacity:.8;font-size:13px;margin-top:4px}

.tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.tab{padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;text-decoration:none;border:1px solid var(--b);background:var(--c);color:var(--t)}
.tab.active{background:var(--p);color:#fff;border-color:var(--p)}
.tab .cnt{font-size:11px;opacity:.7;margin-left:4px}

.card{background:var(--c);border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid var(--b)}
.card h2{font-size:17px;margin-bottom:14px}

.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.stat{text-align:center;padding:10px;background:var(--bg);border-radius:8px}
.stat .num{font-size:26px;font-weight:700;color:var(--p)}
.stat .lbl{font-size:11px;color:var(--ts);margin-top:2px}

.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f9fafb;padding:8px 6px;text-align:left;font-weight:600;border-bottom:2px solid var(--b);white-space:nowrap}
td{padding:7px 6px;border-bottom:1px solid var(--b);vertical-align:top;max-width:300px;word-break:break-all}
tr:hover td{background:#f9fafb}

.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;margin:1px}
.bg-green{background:#d1fae5;color:#065f46}.bg-yellow{background:#fef3c7;color:#92400e}
.bg-red{background:#fee2e2;color:#991b1b}.bg-blue{background:#dbeafe;color:#1e40af}
.bg-purple{background:#ede9fe;color:#5b21b6}

.section-label{font-size:11px;color:var(--ts);margin:8px 0 2px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
</style>
</head>
<body>
<div class="container">
<div class="header">
  <h1>Talent Miner — 人才数据库</h1>
  <p>{{ total_positions }}个岗位 | 候选人 {{ total_talents }}人 | JD {{ total_jds }}条</p>
</div>

<div class="tabs">
  {% for p in positions %}
  <a href="?position_id={{ p.id }}" class="tab {% if p.id==current_id %}active{% endif %}">
    {{ p.name[:18] }}<span class="cnt">(T:{{p.talent_count}}/JD:{{p.jd_count}})</span>
  </a>
  {% endfor %}
</div>

{% if current_pos %}
<div class="card">
  <h2>{{ current_pos.name }}</h2>
  <div class="stat-row">
    <div class="stat"><div class="num">{{ talent_count }}</div><div class="lbl">候选人</div></div>
    <div class="stat"><div class="num">{{ jd_count }}</div><div class="lbl">招聘JD</div></div>
    {% for plat, cnt in platform_stats.items() %}
    <div class="stat"><div class="num">{{ cnt }}</div><div class="lbl">{{ plat }}</div></div>
    {% endfor %}
  </div>
</div>

{% if talents %}
<div class="card">
  <h2>候选人 ({{ talent_count }})</h2>
  <div class="table-wrap">
  <table>
    <thead><tr>
      <th>姓名</th><th>公司</th><th>职位</th><th>城市</th><th>年限</th>
      <th>技能</th><th>联系方式</th><th>来源</th><th>置信度</th>
    </tr></thead>
    <tbody>
    {% for t in talents %}
    <tr>
      <td><strong>{{ t.name or '***' }}</strong></td>
      <td>{{ t.current_company[:20] if t.current_company else '' }}</td>
      <td>{{ t.current_title[:50] if t.current_title else '' }}</td>
      <td>{{ t.city }}</td>
      <td>{{ t.total_years if t.total_years else '' }}</td>
      <td>
        {% for s in (t._skills or [])[:4] %}
        <span class="badge bg-blue">{{ s[:15] }}</span>
        {% endfor %}
      </td>
      <td>
        {% if t.contact_type and t.contact_type != 'none' %}
        <span class="badge bg-green">{{ t.contact_type }}</span>
        {% else %}<span style="color:#ccc">--</span>{% endif %}
      </td>
      <td><span class="badge bg-yellow">{{ t.source_platform }}</span></td>
      <td>
        {% if t.confidence >= 0.7 %}<span class="badge bg-green">高</span>
        {% elif t.confidence >= 0.4 %}<span class="badge bg-yellow">中</span>
        {% else %}<span class="badge bg-red">低</span>{% endif %}
      </td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
  </div>
</div>
{% endif %}

{% if jds_high %}
<div class="card">
  <h2>高端JD — 总监/经理级 ({{ jds_high|length }})</h2>
  <div class="table-wrap">
  <table>
    <thead><tr>
      <th>职位</th><th>公司</th><th>薪资</th><th>地点</th><th>经验</th><th>学历</th>
      <th>行业</th><th>公司规模</th><th>技能</th><th>职责</th><th>要求</th><th>来源</th>
    </tr></thead>
    <tbody>
    {% for jd in jds_high %}
    <tr>
      <td><strong>{{ jd.title[:35] if jd.title else '' }}</strong></td>
      <td>{{ jd.company[:20] if jd.company else '' }}</td>
      <td>{{ jd.salary }}</td>
      <td>{{ jd.location }}</td>
      <td>{{ jd.experience }}</td>
      <td>{{ jd.education }}</td>
      <td>{{ jd.industry[:15] if jd.industry else '' }}</td>
      <td>{{ jd.company_size }}</td>
      <td>
        {% for s in (jd._skills or [])[:5] %}
        <span class="badge bg-purple">{{ s[:15] }}</span>
        {% endfor %}
      </td>
      <td style="max-width:250px">{{ (jd.responsibilities or '')[:200] }}</td>
      <td style="max-width:250px">{{ (jd.requirements or '')[:200] }}</td>
      <td><span class="badge bg-yellow">{{ jd.source_platform }}</span></td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
  </div>
</div>
{% endif %}

{% if jds_low %}
<div class="card">
  <h2>低端JD — 专员/助理级 ({{ jds_low|length }})</h2>
  <div class="table-wrap">
  <table>
    <thead><tr>
      <th>职位</th><th>公司</th><th>薪资</th><th>地点</th><th>经验</th><th>学历</th>
      <th>行业</th><th>公司规模</th><th>技能</th><th>职责</th><th>要求</th><th>来源</th>
    </tr></thead>
    <tbody>
    {% for jd in jds_low %}
    <tr>
      <td><strong>{{ jd.title[:35] if jd.title else '' }}</strong></td>
      <td>{{ jd.company[:20] if jd.company else '' }}</td>
      <td>{{ jd.salary }}</td>
      <td>{{ jd.location }}</td>
      <td>{{ jd.experience }}</td>
      <td>{{ jd.education }}</td>
      <td>{{ jd.industry[:15] if jd.industry else '' }}</td>
      <td>{{ jd.company_size }}</td>
      <td>
        {% for s in (jd._skills or [])[:5] %}
        <span class="badge bg-purple">{{ s[:15] }}</span>
        {% endfor %}
      </td>
      <td style="max-width:250px">{{ (jd.responsibilities or '')[:200] }}</td>
      <td style="max-width:250px">{{ (jd.requirements or '')[:200] }}</td>
      <td><span class="badge bg-yellow">{{ jd.source_platform }}</span></td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
  </div>
</div>
{% endif %}

{% endif %}
</div>
</body>
</html>"""


@app.route("/")
def index():
    positions = list_positions()
    current_id = request.args.get("position_id", type=int) or (positions[0]["id"] if positions else 0)

    conn = get_conn()
    for p in positions:
        p["talent_count"] = conn.execute("SELECT COUNT(*) as n FROM talents WHERE position_id=?", (p["id"],)).fetchone()["n"]
        p["jd_count"] = conn.execute("SELECT COUNT(*) as n FROM jds WHERE position_id=?", (p["id"],)).fetchone()["n"]
    conn.close()

    total_talents = sum(p["talent_count"] for p in positions)
    total_jds = sum(p["jd_count"] for p in positions)

    current_pos = None
    talents, jds = [], []
    talent_count = jd_count = 0
    platform_stats = {}

    if current_id:
        current_pos = get_position(current_id)
        if current_pos:
            talents = query_talents(position_id=current_id, limit=300)
            for t in talents:
                try: t["_skills"] = json.loads(t.get("skills", "[]"))
                except: t["_skills"] = []

            jds = query_jds(position_id=current_id, limit=300)
            for j in jds:
                try: j["_skills"] = json.loads(j.get("skills", "[]"))
                except: j["_skills"] = []

            # Classify JDs: high-end vs low-end
            jds_high, jds_low = [], []
            low_edu = ["大专", "中专", "高中", "不限", ""]
            low_exp = ["1-3年", "1年", "应届", "不限", "无经验", ""]

            for j in jds:
                title = (j.get("title") or "")
                edu = (j.get("education") or "")
                exp = (j.get("experience") or "")

                # 学历: 本科及以上
                has_degree = not any(kw in edu for kw in low_edu)
                # 经验: 3年以上
                has_exp = not any(kw in exp for kw in low_exp) and any(
                    kw in exp for kw in ["3", "5", "8", "10", "以上"]
                )
                # 职位: 经理/总监/主管/专家/高级
                is_senior = any(kw in title for kw in [
                    "总监", "经理", "主管", "负责人", "专家", "高级", "VP", "head", "director", "manager"
                ])

                if has_degree and has_exp and is_senior:
                    jds_high.append(j)
                else:
                    jds_low.append(j)

            talent_count = len(talents)
            jd_count = len(jds)

            # Platform stats
            for t in talents:
                plat = t.get("source_platform", "unknown")
                platform_stats[plat] = platform_stats.get(plat, 0) + 1
            for j in jds:
                plat = j.get("source_platform", "unknown")
                platform_stats[plat] = platform_stats.get(plat, 0) + 1

    return render_template_string(
        PAGE,
        positions=positions, current_id=current_id, current_pos=current_pos,
        talents=talents, jds_high=jds_high, jds_low=jds_low,
        talent_count=talent_count, jd_count=jd_count,
        platform_stats=platform_stats,
        total_positions=len(positions),
        total_talents=total_talents, total_jds=total_jds,
    )


def run(port=5000):
    print(f"[web] http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
