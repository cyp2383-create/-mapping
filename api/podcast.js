/** POST /api/podcast — 生成双人播客剧本 */
import { streamDeepSeek } from './report-builder.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { report_html, industry, role } = req.body;
    const report = report_html || '';
    if (!report) { send({step:'error',text:'缺少报告内容'}); res.end(); return; }

    // Strip HTML tags for prompt
    const text = report.replace(/<style[^>]*>.*?<\/style>/gs,'')
      .replace(/<script[^>]*>.*?<\/script>/gs,'')
      .replace(/<[^>]+>/g,' ')
      .replace(/\s+/g,' ').trim().substring(0,4000);

    send({step:'progress',text:'正在创作剧本...'});

    const prompt = `你是资深播客编剧。基于以下人才市场报告,创作一期双人访谈式播客对话稿(约1500-2000字,8-10分钟)。

## 人物
- 小研: 报告撰写人,理性客观,擅拆数据讲逻辑
- 小诺: 普通从业者,代表听众,擅抓痛点提问,举日常工作例子

## 要求
- 纯聊天式交互,有自然追问和观点碰撞,杜绝独白
- 所有信息严格来源报告,不得编造
- 专业名词时小诺追问,小研用生活化例子解释
- 口语化,适合朗读配音,无长难句
- 结构: 开篇寒暄→主体分段(技能趋势→热门技能→新增/上升/衰退→三档人才→招聘启示)→干货复盘→自然收尾

## 报告内容
${text}

## 输出格式
每句前标注【小研】或【小诺】,仅输出对话,无其他文字。每段不超过3句。`;

    const script = await streamDeepSeek(prompt, 3000, (chars) => {
      send({step:'progress',text:`剧本创作中...${chars}字`});
    });

    send({step:'done', script});
    res.end();
  } catch(e) { send({step:'error',text:e.message}); res.end(); }
}
