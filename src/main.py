#!/usr/bin/env python3
"""
Talent Miner — AI 人才获取系统

流程:
  1. 创建岗位
  2. 采集(自动检测登录状态, 未登录则等用户)
  3. 入库 + 导出 + Web查看

用法:
  python main.py --mode init
  python main.py --mode position-create --name "市场品牌采购" --industry "互联网"
  python main.py --mode collect --position-id 1 --platform maimai
  python main.py --mode full --position-id 1
"""

import sys, json, yaml, time, argparse, urllib.parse, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, str(Path(__file__).parent))

from storage import (init_db, create_position, list_positions, get_position,
                     upsert_talent, upsert_jd, query_talents, query_jds,
                     count_talents, count_jds, position_stats)
from contact import enrich_contact
from exporter import export_excel, export_excel_jds

DEEPSEEK = os.getenv("DEEPSEEK_KEY", "")

SOURCES = {
    "maimai":    ("sources.maimai",   "MaimaiSource"),
    "liepin":    ("sources.liepin",   "LiepinSource"),
    "zhaopin":   ("sources.zhaopin",  "ZhaopinSource"),
    "boss":      ("sources.boss",     "BossSource"),
    "linkedin":  ("sources.linkedin", "LinkedInSource"),
    "websearch": ("sources.web_search", "WebSearchSource"),
}


def get_source(name: str):
    if name not in SOURCES: return None
    mod_path, cls_name = SOURCES[name]
    mod = __import__(mod_path, fromlist=[cls_name])
    return getattr(mod, cls_name)()


def load_config(path="config.yaml"):
    with open(path, "r", encoding="utf-8") as f: return yaml.safe_load(f)


# ======================== 命令 ========================

def cmd_init():
    init_db(); print("DB ready.")

def cmd_position_create(name, industry="", role=""):
    pid = create_position(name=name, industry=industry, role_direction=role)
    print(f"Position created: id={pid}")

def cmd_position_list():
    for p in list_positions():
        print(f"  [{p['id']}] {p['name']} ({p['status']})")

def cmd_login(platform):
    """打开浏览器等用户登录"""
    src = get_source(platform)
    if not src: return
    if not src.connect(): return
    src.wait_for_login()
    # 不关浏览器，等用户

def cmd_collect(position_id, platform, industry="", role="", config_path="config.yaml"):
    """采集：连接→登录→搜索→入库"""
    config = load_config(config_path)
    targets = config.get("targets", {})
    companies = targets.get("companies", [])
    max_total = config.get("collection", {}).get("max_total", 300)

    src = get_source(platform)
    if not src: return
    if not src.connect():
        print(f"[main] Browser failed")
        return

    # 登录检查
    if not src.wait_for_login():
        print(f"[main] Please login to {platform} in the browser, then re-run.")
        return

    if not src.resume_after_login():
        return

    # 公司列表：LLM生成或手配
    if not companies:
        from extractor import generate_target_companies
        ind = industry or targets.get("industry", "")
        rd = role or targets.get("job_keywords", [""])[0]
        if ind:
            comps = generate_target_companies(ind, rd, DEEPSEEK)
            companies = [c["name"] for c in comps]
            print(f"[main] AI generated {len(companies)} companies")

    if not companies:
        companies = ["字节跳动", "阿里巴巴", "腾讯", "美团", "百度", "京东", "快手"]

    print(f"[main] Searching {len(companies)} companies on {platform}...")
    total = 0
    for i, c in enumerate(companies):
        if i > 0: time.sleep(10)
        try:
            profiles = src.collect(c, max_results=5)
        except Exception as e:
            print(f"  {c}: error - {e}")
            continue

        for p in profiles:
            p["position_id"] = position_id
            p = enrich_contact(p)
            if platform in ("liepin", "zhaopin"):
                # JD存入jds表
                upsert_jd(_profile_to_jd(p, position_id))
            else:
                upsert_talent(p)
            total += 1
        print(f"  {c}: {len(profiles)} found ({total} total)")

    src.save_cookies()
    print(f"[main] Done: {total} items. Talents: {count_talents(position_id)}, JDs: {count_jds(position_id)}")


def _profile_to_jd(p: dict, pid: int) -> dict:
    skills = p.get("skills", [])
    if isinstance(skills, str): skills = [skills] if skills else []
    return {
        "position_id": pid,
        "title": p.get("current_title", "") or p.get("title", ""),
        "company": p.get("current_company", "") or p.get("company", ""),
        "salary": p.get("salary", ""),
        "location": p.get("city", "") or p.get("location", ""),
        "experience": p.get("experience", ""),
        "education": p.get("education", ""),
        "industry": p.get("industry", ""),
        "skills": json.dumps(skills, ensure_ascii=False),
        "responsibilities": str(p.get("responsibilities", ""))[:2000],
        "requirements": str(p.get("requirements", ""))[:2000],
        "source_platform": p.get("source_platform", ""),
        "source_url": p.get("source_url", ""),
        "search_query": p.get("search_query", ""),
        "confidence": p.get("confidence", 0.8),
    }


def cmd_export(position_id, fmt="excel"):
    talents = query_talents(position_id=position_id, limit=10000)
    jds = query_jds(position_id=position_id, limit=10000)
    if talents: export_excel(talents)
    if jds: export_excel_jds(jds)
    print(f"[main] Exported {len(talents)} talents + {len(jds)} JDs")


# ======================== main ========================

def main():
    p = argparse.ArgumentParser(description="Talent Miner")
    p.add_argument("--mode", default="full",
                   choices=["init","position-create","position-list","login","collect","full","export","stats"])
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--position-id", type=int, default=0)
    p.add_argument("--name", default="")
    p.add_argument("--platform", default="maimai")
    p.add_argument("--industry", default="")
    p.add_argument("--role", default="")
    p.add_argument("--format", default="excel")
    args = p.parse_args()

    if args.mode == "init":
        cmd_init()
    elif args.mode == "position-create":
        cmd_position_create(args.name, args.industry, args.role)
    elif args.mode == "position-list":
        cmd_position_list()
    elif args.mode == "login":
        cmd_login(args.platform)
    elif args.mode == "collect":
        if not args.position_id:
            print("Need --position-id"); return
        cmd_collect(args.position_id, args.platform, args.industry, args.role, args.config)
    elif args.mode == "full":
        if not args.position_id:
            print("Need --position-id"); return
        cmd_init()
        cmd_collect(args.position_id, args.platform, args.industry, args.role, args.config)
        cmd_export(args.position_id, args.format)
    elif args.mode == "export":
        cmd_export(args.position_id, args.format)
    elif args.mode == "stats":
        if args.position_id:
            s = position_stats(args.position_id)
            print(f"Talents: {s['total']}  By platform: {s['by_platform']}")


if __name__ == "__main__":
    main()
