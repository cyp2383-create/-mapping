"""Batch Maimai collection via CDP"""
import sys, json, time, urllib.parse
sys.path.insert(0, '.')
from playwright.sync_api import sync_playwright
from sources.base import llm_ask
from storage import upsert_talent, count_talents
from contact import enrich_contact

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://localhost:9222')
    ctx = browser.contexts[0]
    page = ctx.new_page()

    companies = ['字节跳动','阿里巴巴','腾讯','美团','百度','京东','快手','小红书','拼多多','网易']
    total = 0

    for i, c in enumerate(companies):
        if i > 0:
            time.sleep(10)

        for kw in ['采购总监', '间接采购', '市场采购']:
            q = urllib.parse.quote(f'{kw} {c}')
            url = f'https://maimai.cn/web/search_center?type=contact&query={q}'
            page.goto(url, timeout=15000)
            time.sleep(5)

            if 'login' in page.url.lower():
                print(f'  LOGIN REDIRECT {c}/{kw}')
                continue

            text = page.inner_text('body')
            result = llm_ask(
                f'Maimai search. Extract people: name, current_title, current_company, city, total_years, name_hidden, source_profile. Max 4. Default company: {c}. JSON array. Text: {text[:6000]}',
                2000
            )
            result = result.strip()
            if result.startswith('```'):
                result = result.split('\n', 1)[1]
            if result.endswith('```'):
                result = result[:-3]

            try:
                profiles = json.loads(result)
            except:
                profiles = []

            for p in profiles:
                p['position_id'] = 1
                p['source_platform'] = 'maimai'
                p = enrich_contact(p)
                upsert_talent(p)
                total += 1

        print(f'{c}: {total} total')

    page.close()
    print(f'\nDone: {total} added, DB total: {count_talents(1)}')
