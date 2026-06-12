"""
SQLite 人才数据库

Schema:
  positions   — 岗位/招聘项目 (一个岗位 = 一个独立的候选人池)
  talents     — 候选人 (关联到岗位, 弹性维度)
  collection_logs — 采集日志
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data" / "talent.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        -- ===== 岗位表 =====
        CREATE TABLE IF NOT EXISTS positions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT    NOT NULL,             -- 岗位名称
            industry        TEXT    DEFAULT '',            -- 行业
            role_direction  TEXT    DEFAULT '',            -- 职能方向
            target_companies TEXT   DEFAULT '',            -- 目标公司列表(JSON)
            requirements    TEXT    DEFAULT '',            -- 用人要求(自由文本)
            status          TEXT    DEFAULT 'active',      -- active | paused | closed
            created_at      TEXT    DEFAULT (datetime('now')),
            updated_at      TEXT    DEFAULT (datetime('now'))
        );

        -- ===== 候选人表 =====
        CREATE TABLE IF NOT EXISTS talents (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id     INTEGER NOT NULL,             -- 关联岗位
            -- 基础信息 (有就填, 没有就空)
            name            TEXT    DEFAULT '',
            current_company TEXT    DEFAULT '',
            current_title   TEXT    DEFAULT '',
            city            TEXT    DEFAULT '',
            -- 经历 (有就填)
            total_years     INTEGER DEFAULT 0,
            skills          TEXT    DEFAULT '',            -- JSON array
            education       TEXT    DEFAULT '',            -- JSON array
            past_companies  TEXT    DEFAULT '',            -- JSON array
            industry_tags   TEXT    DEFAULT '',            -- JSON array
            -- 联系方式
            contact_type    TEXT    DEFAULT '',            -- maimai_link | boss_chat | linkedin | email | phone | none
            contact_value   TEXT    DEFAULT '',
            contact_confidence REAL DEFAULT 0.0,
            -- 来源
            source_platform TEXT    DEFAULT '',            -- maimai | boss | linkedin | public_web
            source_url      TEXT    DEFAULT '',
            source_profile  TEXT    DEFAULT '',            -- 原始 Profile 文本/截图URL
            -- 置信度
            confidence      REAL    DEFAULT 0.5,
            confidence_notes TEXT  DEFAULT '',
            -- 弹性扩展
            name_hidden     INTEGER DEFAULT 0,             -- 0=公开 1=姓名被平台隐藏
            extra_fields    TEXT    DEFAULT '{}',          -- JSON object (平台特有维度)
            -- HR 跟进
            hr_status       TEXT    DEFAULT 'new',         -- new|contacted|replied|interviewing|hired|rejected
            hr_notes        TEXT    DEFAULT '',
            created_at      TEXT    DEFAULT (datetime('now')),
            updated_at      TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_position ON talents(position_id);
        CREATE INDEX IF NOT EXISTS idx_company ON talents(current_company);
        CREATE INDEX IF NOT EXISTS idx_source ON talents(source_platform);
        CREATE INDEX IF NOT EXISTS idx_hr_status ON talents(hr_status);

        -- ===== JD表 (独立于候选人) =====
        CREATE TABLE IF NOT EXISTS jds (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id     INTEGER NOT NULL,
            title           TEXT    DEFAULT '',             -- 岗位名称
            company         TEXT    DEFAULT '',             -- 公司全名
            salary          TEXT    DEFAULT '',             -- 薪资范围
            location        TEXT    DEFAULT '',             -- 工作城市
            experience      TEXT    DEFAULT '',             -- 经验要求
            education       TEXT    DEFAULT '',             -- 学历要求
            industry        TEXT    DEFAULT '',             -- 所属行业
            company_size    TEXT    DEFAULT '',             -- 公司规模
            skills          TEXT    DEFAULT '',             -- 技能标签(JSON)
            responsibilities TEXT   DEFAULT '',             -- 岗位职责
            requirements    TEXT    DEFAULT '',             -- 任职要求
            bonus           TEXT    DEFAULT '',             -- 加分项/福利
            source_platform TEXT    DEFAULT '',             -- liepin/zhaopin/career
            source_url      TEXT    DEFAULT '',
            search_query    TEXT    DEFAULT '',             -- 搜索关键词
            confidence      REAL    DEFAULT 0.5,
            created_at      TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_jds_position ON jds(position_id);
        CREATE INDEX IF NOT EXISTS idx_jds_company ON jds(company);

        -- ===== 采集日志 =====
        CREATE TABLE IF NOT EXISTS collection_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL,
            platform    TEXT    NOT NULL,
            target      TEXT    NOT NULL,
            status      TEXT    DEFAULT 'running',
            collected   INTEGER DEFAULT 0,
            new_added   INTEGER DEFAULT 0,
            error_msg   TEXT    DEFAULT '',
            started_at  TEXT    DEFAULT (datetime('now')),
            finished_at TEXT,
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );
    """)
    conn.commit()
    conn.close()


# ========== 岗位管理 ==========

def create_position(name: str, industry: str = "", role_direction: str = "",
                    requirements: str = "", target_companies: list = None) -> int:
    conn = get_conn()
    tc = json.dumps(target_companies or [], ensure_ascii=False)
    cur = conn.execute(
        "INSERT INTO positions (name, industry, role_direction, requirements, target_companies) VALUES (?,?,?,?,?)",
        (name, industry, role_direction, requirements, tc)
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return pid


def list_positions(status: str = "") -> list[dict]:
    conn = get_conn()
    if status:
        rows = conn.execute("SELECT * FROM positions WHERE status=? ORDER BY created_at DESC", (status,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM positions ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_position(position_id: int) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM positions WHERE id=?", (position_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_position_status(position_id: int, status: str):
    conn = get_conn()
    conn.execute("UPDATE positions SET status=?, updated_at=datetime('now') WHERE id=?", (status, position_id))
    conn.commit()
    conn.close()


# ========== 候选人 CRUD ==========

def upsert_talent(data: dict) -> int:
    """插入或更新。去重: 同岗位+同姓名+同公司+同平台 = 更新"""
    conn = get_conn()

    pid = data.get("position_id", 0)
    name = data.get("name", "")
    company = data.get("current_company", "")
    platform = data.get("source_platform", "")

    # 序列化JSON字段
    for key in ("skills", "education", "past_companies", "industry_tags"):
        val = data.get(key, "")
        if isinstance(val, (list, dict)):
            data[key] = json.dumps(val, ensure_ascii=False)
    if "extra_fields" in data and isinstance(data["extra_fields"], dict):
        data["extra_fields"] = json.dumps(data["extra_fields"], ensure_ascii=False)

    # 去重检查
    existing = conn.execute(
        "SELECT id FROM talents WHERE position_id=? AND name=? AND current_company=? AND source_platform=?",
        (pid, name, company, platform)
    ).fetchone()

    if existing:
        tid = existing["id"]
        fields = [f"{k}=?" for k in data if k not in ("id", "created_at")]
        values = [data[k] for k in data if k not in ("id", "created_at")]
        values.append(tid)
        conn.execute(f"UPDATE talents SET {','.join(fields)}, updated_at=datetime('now') WHERE id=?", values)
    else:
        columns = ",".join(data.keys())
        placeholders = ",".join("?" for _ in data)
        cur = conn.execute(f"INSERT INTO talents ({columns}) VALUES ({placeholders})", list(data.values()))
        tid = cur.lastrowid

    conn.commit()
    conn.close()
    return tid


def query_talents(position_id: int = 0, company: str = "", title_kw: str = "",
                   source: str = "", hr_status: str = "", limit: int = 100, offset: int = 0) -> list[dict]:
    conn = get_conn()
    wheres = ["1=1"]
    params = []

    if position_id:
        wheres.append("position_id=?")
        params.append(position_id)
    if company:
        wheres.append("current_company LIKE ?")
        params.append(f"%{company}%")
    if title_kw:
        wheres.append("current_title LIKE ?")
        params.append(f"%{title_kw}%")
    if source:
        wheres.append("source_platform=?")
        params.append(source)
    if hr_status:
        wheres.append("hr_status=?")
        params.append(hr_status)

    rows = conn.execute(
        f"SELECT * FROM talents WHERE {' AND '.join(wheres)} ORDER BY confidence DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_talents(position_id: int = 0) -> int:
    conn = get_conn()
    if position_id:
        n = conn.execute("SELECT COUNT(*) as n FROM talents WHERE position_id=?", (position_id,)).fetchone()["n"]
    else:
        n = conn.execute("SELECT COUNT(*) as n FROM talents").fetchone()["n"]
    conn.close()
    return n


def update_hr_status(talent_id: int, status: str, notes: str = ""):
    conn = get_conn()
    conn.execute("UPDATE talents SET hr_status=?, hr_notes=?, updated_at=datetime('now') WHERE id=?",
                 (status, notes, talent_id))
    conn.commit()
    conn.close()


# ========== 岗位统计 ==========

def position_stats(position_id: int) -> dict:
    """岗位维度的统计"""
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) as n FROM talents WHERE position_id=?", (position_id,)).fetchone()["n"]
    by_platform = {}
    for row in conn.execute(
        "SELECT source_platform, COUNT(*) as n FROM talents WHERE position_id=? GROUP BY source_platform",
        (position_id,)
    ).fetchall():
        by_platform[row["source_platform"]] = row["n"]
    by_status = {}
    for row in conn.execute(
        "SELECT hr_status, COUNT(*) as n FROM talents WHERE position_id=? GROUP BY hr_status",
        (position_id,)
    ).fetchall():
        by_status[row["hr_status"]] = row["n"]
    conn.close()
    return {"total": total, "by_platform": by_platform, "by_status": by_status}


# ========== JD CRUD ==========

def upsert_jd(data: dict) -> int:
    conn = get_conn()
    title = data.get("title", "")
    company = data.get("company", "")
    platform = data.get("source_platform", "")

    for key in ("skills",):
        val = data.get(key, "")
        if isinstance(val, (list, dict)):
            data[key] = json.dumps(val, ensure_ascii=False)

    existing = conn.execute(
        "SELECT id FROM jds WHERE title=? AND company=? AND source_platform=?",
        (title, company, platform)
    ).fetchone()

    if existing:
        tid = existing["id"]
        fields = [f"{k}=?" for k in data if k != "id"]
        values = [data[k] for k in data if k != "id"] + [tid]
        conn.execute(f"UPDATE jds SET {','.join(fields)} WHERE id=?", values)
    else:
        columns = ",".join(data.keys())
        placeholders = ",".join("?" for _ in data)
        cur = conn.execute(f"INSERT INTO jds ({columns}) VALUES ({placeholders})", list(data.values()))
        tid = cur.lastrowid

    conn.commit()
    conn.close()
    return tid


def query_jds(position_id: int = 0, company: str = "", limit: int = 100) -> list[dict]:
    conn = get_conn()
    wheres = ["1=1"]
    params = []
    if position_id:
        wheres.append("position_id=?")
        params.append(position_id)
    if company:
        wheres.append("company LIKE ?")
        params.append(f"%{company}%")
    rows = conn.execute(
        f"SELECT * FROM jds WHERE {' AND '.join(wheres)} ORDER BY created_at DESC LIMIT ?",
        params + [limit]
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_jds(position_id: int = 0) -> int:
    conn = get_conn()
    if position_id:
        n = conn.execute("SELECT COUNT(*) as n FROM jds WHERE position_id=?", (position_id,)).fetchone()["n"]
    else:
        n = conn.execute("SELECT COUNT(*) as n FROM jds").fetchone()["n"]
    conn.close()
    return n


# ========== 采集日志 ==========

def start_collection(position_id: int, platform: str, target: str) -> int:
    conn = get_conn()
    cur = conn.execute("INSERT INTO collection_logs (position_id, platform, target) VALUES (?,?,?)",
                       (position_id, platform, target))
    conn.commit()
    log_id = cur.lastrowid
    conn.close()
    return log_id


def finish_collection(log_id: int, collected: int, new_added: int, error: str = ""):
    conn = get_conn()
    status = "error" if error else "done"
    conn.execute(
        "UPDATE collection_logs SET status=?, collected=?, new_added=?, error_msg=?, finished_at=datetime('now') WHERE id=?",
        (status, collected, new_added, error, log_id)
    )
    conn.commit()
    conn.close()
