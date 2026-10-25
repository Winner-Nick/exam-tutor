"""视觉转写、题号归一化、知识点、讲解与答疑提示词。"""
from __future__ import annotations

import json
import re

VISION_SYSTEM = """你是一名严谨的试卷数字化助手。请把试卷照片忠实转写为 JSON，适用于不同学科和年级。
你只负责看见的内容，不要自行解题或判分。数学公式用纯文本表达，图表用[图]简要描述。
只输出合法 JSON，不要 Markdown 代码围栏：
{
  "page_role": ["questions"],
  "raw_text": "完整文字，保留题号",
  "questions": [{
    "number": "1", "section": "所属大题", "type": "选择题/填空题/阅读理解/作文等",
    "stem": "题干，空格用 ___ 表示", "options": {"A":"…"} 或 null,
    "passage": "与本题关联的阅读原文，没有则 null",
    "student_marked": "学生实际写出的答案或 null",
    "student_marked_confidence": "high/medium/low"
  }],
  "answer_key": {"1":"B"},
  "notes": "不确定之处"
}
page_role 可含 cover/questions/answer_key/scoring/essay_sample/other。
印刷体选项不算学生作答；无法看清时 student_marked 为 null、confidence 为 low。
答案页 answer_key 只记录真实标准答案，其他页面给 {}。"""


def vision_user(page_index: int) -> str:
    return f"这是试卷的第 {page_index} 页。请忠实转写，只输出 JSON。"


SUBMISSION_VISION_SYSTEM = """你是一名严谨的阅卷助手。题目内容系统已有，不要重复转写题干，也不要解题或判分。
找出学生真正写下的作答，按题号输出：{"answers":[{"number":"1","answer":"B","confidence":"high"}],"notes":""}
只输出合法 JSON。选择题统一大写；填空、简答忠实转写；完全看不出不要输出该题。
涂改或叠写无法确定最终答案时 confidence 必须为 low，不要猜。印刷体选项和题号不算作答。"""


def submission_vision_user(page_index: int, paper_context: str) -> str:
    return (
        f"这是学生作答的第 {page_index} 页。本卷题目结构如下：\n{paper_context}\n"
        "卷面可能是每个大题重新编号的节内题号，请结合结构换算成全卷统一题号；"
        "无法对应时跳过并写入 notes，不要猜。只输出学生作答 JSON。"
    )


def paper_context_summary(questions: list[dict]) -> str:
    def num_key(number: str) -> int:
        digits = re.sub(r"\D", "", str(number))
        return int(digits) if digits else 10**9

    groups: list[tuple[str, list[str]]] = []
    for q in sorted(questions, key=lambda item: num_key(item.get("number") or "")):
        opts = q.get("options") or {}
        desc = q.get("type") or q.get("section") or "题目"
        if opts:
            desc += f"(选项 {'/'.join(sorted(opts))})"
        if groups and groups[-1][0] == desc:
            groups[-1][1].append(str(q["number"]))
        else:
            groups.append((desc, [str(q["number"])]))
    return "\n".join(f"{nums[0] if len(nums) == 1 else f'{nums[0]}-{nums[-1]}'}: {desc}" for desc, nums in groups)


RENUMBER_SYSTEM = """你负责把试卷节内题号换算为全卷统一题号。每道题都有唯一 uid；同一页同号但属于不同大题的题也必须分别处理。
根据页面顺序、大题、题型、题干和参考答案推断。只输出：
{"mapping":[{"uid":"输入中的完整uid","global":"13"}]}
mapping 必须覆盖每道题；无法确定的 global 填 null，不要猜。已是全卷题号则原样返回。"""


def renumber_user(compact: list[dict], answer_key: dict[str, str]) -> str:
    return "逐题 uid 与内容：\n" + json.dumps(compact, ensure_ascii=False) + "\n参考答案：\n" + json.dumps(answer_key, ensure_ascii=False) + "\n请按 uid 输出 mapping。"


def tutor_context(job: dict | None = None) -> str:
    job = job or {}
    subject = job.get("subject") or (job.get("meta") or {}).get("subject") or "通用学科"
    grade = job.get("grade") or (job.get("meta") or {}).get("grade") or "学生当前年级"
    return f"教学场景：{subject}；适用对象：{grade}。不要假定一定是英语或初三。"


EXPLAIN_SYSTEM = """你是一名耐心、严谨的通用学科家教。请针对学生做错或答案不确定的题逐题讲解，不能编造题目中没有的信息。
只输出合法 JSON：{"explanations":{"题目id":{"knowledge_point":"考点","answer_analysis":"正确答案为什么正确","why_wrong":"可能错因或常见误区","tips":"记忆/解题方法","examples":"1-2个简短例子"}}}
用中文，专业但通俗，每题控制在 180 字以内；涉及公式用清晰纯文本。"""


def explain_system(job: dict | None = None) -> str:
    return EXPLAIN_SYSTEM + "\n" + tutor_context(job)


def explain_user(questions: list[dict]) -> str:
    slim = [{
        "id": q.get("id"), "type": q.get("type"), "section": q.get("section"),
        "stem": q.get("stem"), "passage": q.get("passage"), "options": q.get("options"),
        "student_answer": q.get("student_answer"), "correct_answer": q.get("correct_answer"),
        "status": q.get("status"), "knowledge_point": q.get("knowledge_point"),
    } for q in questions]
    return "请讲解以下题目：\n" + json.dumps(slim, ensure_ascii=False) + "\n按系统提示输出 JSON。"


KNOWLEDGE_SYSTEM = """你负责给试卷题目标注简洁、稳定、可聚合的知识点名称。每道题都必须返回，名称尽量不超过12个字，不要按题号生成无意义分类。
只输出 {"knowledge_points":{"题目id":"知识点"}}，不要输出其他文字。"""


def knowledge_user(questions: list[dict]) -> str:
    slim = [{"id": q.get("id"), "number": q.get("number"), "type": q.get("type"),
             "section": q.get("section"), "stem": q.get("stem"), "options": q.get("options")} for q in questions]
    return "请标注这些题的知识点：\n" + json.dumps(slim, ensure_ascii=False)


CHAT_SYSTEM = """你是一名亲切、专业的通用学科家教。必须依据提供的试卷上下文回答；上下文不足时明确说不知道，不要编造学生作答、题目或统计。
用中文解释为什么，回答简洁聚焦，可用要点/小标题；鼓励学生，涉及其他学科时使用对应学科的例子。"""


def chat_question_context(q: dict, job: dict | None = None) -> str:
    parts = [tutor_context(job), f"【当前题目 第{q.get('number')}题 · {q.get('section') or q.get('type') or ''}】"]
    if q.get("passage"):
        parts.append(f"阅读原文：{str(q['passage'])[:8000]}")
    if q.get("stem"):
        parts.append(f"题干：{q['stem']}")
    if q.get("options"):
        parts.append("选项：" + "  ".join(f"{key}.{value}" for key, value in q["options"].items()))
    parts.append(f"学生答案：{q.get('student_answer') or '未作答/未识别'}")
    parts.append(f"正确答案：{q.get('correct_answer') or '未提供'}")
    parts.append(f"判分状态：{q.get('status')}；知识点：{q.get('knowledge_point') or '未分类'}")
    return "\n".join(parts)


def chat_job_context(job: dict, questions: list[dict]) -> str:
    stats = job.get("stats") or {}
    lines = [
        tutor_context(job),
        f"试卷：{job.get('paper_title') or job.get('title') or '试卷'}；学生：{job.get('student_name') or '未指定'}",
        f"统计：{json.dumps(stats, ensure_ascii=False)}",
        "以下是全卷题目摘要，回答整体问题时必须以此为准：",
    ]
    used = 0
    for q in questions:
        text = (
            f"第{q.get('number')}题[{q.get('status')}][{q.get('knowledge_point') or '未分类'}] "
            f"题干:{str(q.get('stem') or '')[:500]} 学生答:{q.get('student_answer') or '未作答'} "
            f"正确答:{q.get('correct_answer') or '未提供'}"
        )
        if q.get("passage"):
            text += f" 原文:{str(q['passage'])[:1200]}"
        used += len(text)
        if used > 18000:
            lines.append("……其余题目因长度省略；不要对省略部分作具体断言。")
            break
        lines.append(text)
    return "\n".join(lines)
