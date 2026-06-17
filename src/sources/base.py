"""
平台采集器基类 — 登录等待 + DeepSeek提取

每个源定义:
  - name, base_url, login_url, cookie_file
  - require_login = True/False
  - search_url() / search_people()

流程: connect → wait_for_login(如果需要) → search → llm_extract → save
"""

import json, time, random, urllib.parse
from pathlib import Path
from abc import ABC
from typing import Optional

try:
    from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

CDP_URL = "http://localhost:9222"

_llm_client = None


def _get_llm():
    global _llm_client
    if _llm_client is None:
        try:
            from openai import OpenAI
            import os
            api_key = os.getenv("DEEPSEEK_KEY", "")
            if not api_key:
                print("[LLM] DEEPSEEK_KEY not set in environment")
                return None
            _llm_client = OpenAI(
                api_key=api_key,
                base_url="https://api.deepseek.com/v1"
            )
        except ImportError:
            return None
    return _llm_client


def llm_ask(prompt: str, max_tokens: int = 1500) -> str:
    client = _get_llm()
    if not client: return ""
    try:
        resp = client.chat.completions.create(
            model="deepseek-chat", messages=[{"role": "user", "content": prompt}],
            temperature=0.1, max_tokens=max_tokens)
        return resp.choices[0].message.content or ""
    except Exception as e:
        print(f"  [LLM] {e}"); return ""


class PlatformSource(ABC):
    name: str = "base"
    base_url: str = ""
    login_url: str = ""          # 触发登录的URL（搜索页等需要登录的页面）
    cookie_file: str = "cookies/base.json"
    require_login: bool = False  # True=必须先登录才能搜索

    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    # ========== 浏览器 ==========

    def connect(self) -> bool:
        if not HAS_PLAYWRIGHT: return False
        if self._browser and self._page: return True

        self._playwright = sync_playwright().start()
        try:
            self._browser = self._playwright.chromium.connect_over_cdp(CDP_URL)
            self._context = self._browser.contexts[0]
            self._page = self._context.new_page()
            print(f"[{self.name}] CDP connected")
            return True
        except:
            pass

        # CDP不可用，启动Playwright Chromium
        self._browser = self._playwright.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-first-run", "--window-size=1280,800"])
        self._context = self._browser.new_context(
            viewport={"width": 1280, "height": 800}, locale="zh-CN",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36")
        self._page = self._context.new_page()
        print(f"[{self.name}] Playwright Chromium ready")
        return True

    def disconnect(self):
        try: self._page.close()
        except: pass
        try: self._browser.close()
        except: pass
        try: self._playwright.stop()
        except: pass
        self._browser = self._context = self._page = self._playwright = None

    # ---- Cookie ----
    def save_cookies(self):
        Path(self.cookie_file).parent.mkdir(parents=True, exist_ok=True)
        if self._context:
            with open(self.cookie_file, "w", encoding="utf-8") as f:
                json.dump(self._context.cookies(), f, ensure_ascii=False, indent=2)

    def load_cookies(self) -> bool:
        path = Path(self.cookie_file)
        if not path.exists(): return False
        with open(path, "r", encoding="utf-8") as f:
            self._context.add_cookies(json.load(f))
        return True

    # ---- 页面 ----
    def goto(self, url: str, timeout: int = 20000):
        self._page.goto(url, wait_until="domcontentloaded", timeout=timeout)

    def wait(self, s=None): time.sleep(s or random.uniform(3, 6))
    def page_text(self) -> str: return self._page.inner_text("body")
    def page_url(self) -> str: return self._page.url

    def scroll(self, times=3):
        for _ in range(times):
            try: self._page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            except: break
            time.sleep(random.uniform(2, 3))

    # ========== 登录等待（核心流程）==========

    def wait_for_login(self) -> bool:
        """
        如果需要登录，打开登录页等待用户操作，阻塞直到登录成功。
        用DeepSeek判断是否已登录（不依赖URL检测）。
        """
        if not self.require_login:
            # 尝试加载已有Cookie
            self.load_cookies()
            return True

        # 打开需要登录的页面
        self.goto(self.login_url)
        self.wait(3)

        # 检查是否已登录
        if self._check_logged_in():
            print(f"[{self.name}] Already logged in (from cookies)")
            return True

        # 等待用户登录
        print(f"[{self.name}] ========================================")
        print(f"[{self.name}] 请在打开的浏览器中登录 {self.name}")
        print(f"[{self.name}] 登录完成后在此对话回复 'OK'")
        print(f"[{self.name}] ========================================")
        return False  # 返回False表示需要等用户

    def resume_after_login(self) -> bool:
        """用户确认已登录后调用。再次检查并保存Cookie。"""
        self.goto(self.login_url)
        self.wait(3)
        if self._check_logged_in():
            self.save_cookies()
            print(f"[{self.name}] Login confirmed, cookies saved")
            return True
        # 再试一次
        self.wait(5)
        if self._check_logged_in():
            self.save_cookies()
            return True
        print(f"[{self.name}] Still not logged in. Please try again.")
        return False

    def _check_logged_in(self) -> bool:
        """DeepSeek判断当前页面是否已登录"""
        text = self.page_text()[:1500]
        url = self.page_url()[:120]
        prompt = f"""Check if user is LOGGED IN on this page.
If the page shows login form, QR code, phone verification, register button → NOT logged in (return false).
If the page shows search results, user profile, navigation menu, content → logged in (return true).
URL: {url}
Text: {text}
Return ONLY 'true' or 'false'."""
        return "true" in llm_ask(prompt, 5).strip().lower()

    # ========== DeepSeek提取 ==========

    def llm_extract(self, text: str, prompt_template: str, max_tokens: int = 2000) -> list[dict]:
        result = llm_ask(prompt_template, max_tokens).strip()
        if result.startswith("```"): result = result.split("\n", 1)[1]
        if result.endswith("```"): result = result[:-3]
        try: data = json.loads(result)
        except:
            import re
            m = re.search(r'\[.*\]', result, re.DOTALL)
            if m:
                try: data = json.loads(m.group(0))
                except: return []
            else:
                return []

        # Filter fake data: reject entries with placeholder words
        fake_kw = ['示例', 'test', 'sample', '某公司', '公司A', '公司B', '占位', 'placeholder']
        clean = []
        for item in data:
            combined = str(item).lower()
            if not any(kw.lower() in combined for kw in fake_kw):
                clean.append(item)
        if len(clean) < len(data):
            print(f"  [filter] Rejected {len(data)-len(clean)} fake entries")
        return clean

    # ========== 子类实现 ==========

    def search_url(self, company: str, keywords: str = "") -> str:
        q = f"{keywords} {company}".strip() if keywords else company
        return f"{self.base_url}/search?q={urllib.parse.quote(q)}"

    def collect(self, company: str, keywords: str = "", max_results: int = 10) -> list[dict]:
        raise NotImplementedError
