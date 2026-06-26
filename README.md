# Talent Miner — AI 驱动的人才地图生成器

根据输入的行业+岗位，**全自动搜索市场数据**并生成结构化的人才画像报告。帮助招聘负责人、HRBP 和猎头顾问快速摸清人才市场格局，精准定位挖猎目标。

🔗 在线体验: [talent-miner.vercel.app](https://talent-miner.vercel.app) (经典版) | [talent-miner-next.vercel.app](https://talent-miner-next.vercel.app) (Next.js重构版)

---

## 解决的问题

### 1. 传统人才 Mapping 太慢

传统做法需要 HR/猎头手动搜索 LinkedIn、脉脉、猎聘等多个平台，逐条整理候选人信息，再汇总成报告——一个岗位往往需要 **3-5 天**。Talent Miner 把这个过程缩短到 **2-3 分钟**：输入行业和岗位，AI 自动并行搜索、提取、归类、生成报告。

### 2. 信息分散，缺乏结构化

候选人信息散落在 LinkedIn 主页、招聘 JD、脉脉动态等不同来源，格式不一。Talent Miner 用 DeepSeek 大模型：
- 从 LinkedIn 摘录中提取**教育背景、语言能力、影响力评分、所在地**
- 从 JD 中提取**薪资范围、经验要求、技术栈工具**
- 将候选人按 T1/T2/T3 **三档分类**，一目了然

### 3. 招聘决策缺乏市场数据支撑

HR 跟业务方沟通"这个人要不要挖"时，往往只有感觉没有数据。Talent Miner 提供的报告包含：
- **技能趋势变化**（新增/上升/衰退技能）
- **三档人才能力画像**（高端/中端/入门的核心能力差异）
- **薪酬对标参考**（基于真实 JD 数据）

### 4. 追问环节缺少智能分析

拿到候选人列表后，HR 还想知道："这些大厂在做什么业务？""我的业务场景适合从哪挖人？" Talent Miner 内置的智能追问功能可以：
- 基于数据推断各公司业务方向
- 分析从每家挖人的优势与劣势
- 推荐匹配度最高的候选人

---

---

## 两个版本

| | 经典版 | Next.js 重构版 |
|------|--------|---------------|
| 地址 | [talent-miner.vercel.app](https://talent-miner.vercel.app) | [talent-miner-next.vercel.app](https://talent-miner-next.vercel.app) |
| 技术栈 | 单文件 HTML + CSS + JS | Next.js 14 + TypeScript + Tailwind + shadcn/ui |
| API | Vercel Serverless（Node.js） | 同上（代理到经典版） |
| 数据库 | Turso（libsql） | 同上 |
| 设计 | 暗色主题 · 毛玻璃 | Tailwind 暗色 · 组件化 |
| 结构 | 4 模块纵向堆叠 | Sidebar 导航 + 独立路由 |
| 适合 | 快速原型、轻量部署 | 持续迭代、团队开发 |

两版共享同一套后端 API 和 Turso 数据库，数据互通。

---

## 适用人群

| 角色 | 使用场景 |
|------|----------|
| **HRBP / 招聘负责人** | 接到新岗位需求时，快速摸清市场上有多少合适的人、在哪些公司、薪资范围多少，产出数据支撑的招聘计划 |
| **猎头顾问** | 拿到客户 Mandate 后，一键生成 Mapping 作为交付物，大幅提升效率 |
| **创业公司创始人 / Hiring Manager** | 想从大厂挖人但不了解对标公司人才分布，快速获取目标公司列表和候选人画像 |
| **招聘团队 Leader** | 多个岗位同时开启时，用系统评估每个岗位的人才市场供给情况，合理分配资源 |

---

## 核心功能

### 🗺️ 一键生成人才地图
- 输入行业 + 岗位（可选城市），自动搜索市场数据
- SSE 流式返回，实时看到进度

### 👥 候选人搜索 & 分类
- 通过 Tavily 搜索 LinkedIn 上的真实候选人
- DeepSeek 深度提取：教育、语言、影响力、技能
- 自动三档分层：**高端**（T1大厂+总监级）/ **中端** / **入门**

### 📋 JD 市场分析
- 搜索目标公司的在招岗位
- 提取薪资、经验、学历、技术栈等结构化字段

### 📊 智能报告
- **技能趋势分析**：新增技能 / 上升技能 / 衰退技能
- **三档能力画像**：每档的核心能力、项目级别、差异点
- 深色主题 HTML 报告，支持下载

### 💬 智能追问
- 业务方向分析：基于数据推断大厂的业务重点
- 挖人推荐：根据你的业务场景推荐目标公司
- 候选人匹配：从已搜集的人选中推荐最匹配的

### 📜 历史报告
- 所有生成的报告持久化存储（Turso 分布式数据库）
- 支持随时查看、重新生成

---

## 技术架构

```
┌──────────────────────────────────────────────────┐
│                   用户输入                         │
│         行业 + 岗位 + (可选)城市                    │
└──────────────────┬───────────────────────────────┘
                   │
     ┌─────────────▼─────────────┐
     │   DeepSeek 生成目标公司列表  │
     │   (15家, T1/T2/T3 分类)    │
     └─────────────┬─────────────┘
                   │
     ┌─────────────▼─────────────┐
     │   Tavily 并行搜索          │
     │   ├─ LinkedIn 候选人       │
     │   └─ 招聘 JD               │
     └─────────────┬─────────────┘
                   │
     ┌─────────────▼─────────────┐
     │   DeepSeek 深度提取        │
     │   ├─ 候选人: 教育/语言/    │
     │   │   影响力/地点          │
     │   └─ JD: 薪资/经验/工具    │
     └─────────────┬─────────────┘
                   │
     ┌─────────────▼─────────────┐
     │   三档分层 & 数据呈现       │
     │   ├─ 候选人表格            │
     │   ├─ JD 表格               │
     │   ├─ 趋势分析报告           │
     │   └─ 三档能力画像           │
     └─────────────┬─────────────┘
                   │
     ┌─────────────▼─────────────┐
     │   智能追问 (Chat)           │
     │   业务分析 / 挖人推荐       │
     └───────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|----|------|
| **前端** | 原生 HTML/CSS/JS，SSE 流式响应，毛玻璃深色主题 |
| **后端 API** | Vercel Serverless Functions (Node.js) |
| **数据库** | Turso (libsql) — 生产环境；SQLite — 本地调试 |
| **AI 引擎** | DeepSeek (deepseek-chat) |
| **搜索** | Tavily API (主)，DuckDuckGo (备) |
| **本地采集** | Python + Playwright（脉脉/猎聘/BOSS/知乎等平台） |

### 本地 Python CLI（可选）

除线上版本外，项目还提供 Python CLI 做深度浏览器采集：

```bash
# 快速模式（仅搜索+报告, 无需浏览器）
python master.py --industry "互联网" --role "市场采购总监" --mode quick

# 完整模式（搜索 + 脉脉候选人 + 报告）
python master.py --industry "AI大模型" --role "AI产品经理" --mode full
```

支持的采集源：脉脉、猎聘、BOSS直聘、LinkedIn、知乎、GitHub

---

## 数据来源 & 置信度

报告中的每个数据点都标注来源：

| 标记 | 含义 |
|------|------|
| `[JD data]` | 来自真实招聘 JD |
| `[Candidate data]` | 来自候选人公开 Profile |
| `[AI inference]` | AI 基于上下文推理（如技能趋势预测） |

---

## 本地开发

```bash
# 安装依赖
pip install -r requirements.txt

# 启动本地 Flask 数据查看器
python -c "from src.web.app import run; run(5000)"

# Vercel 开发
vercel dev
```

### 环境变量

创建 `.env` 文件：

```
TAVILY_KEY=tvly-xxx      # Tavily 搜索 API Key
DEEPSEEK_KEY=sk-xxx       # DeepSeek API Key
TURSO_URL=libsql://xxx    # Turso 数据库 URL
TURSO_TOKEN=eyJxxx        # Turso 认证 Token
```

---

## License

MIT

---

🤖 Built with Tavily · LinkedIn · GitHub · DeepSeek · Powered by AI
