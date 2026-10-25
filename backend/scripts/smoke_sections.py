"""真实中转的分节同号试卷端到端验收；只使用合成数据。"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
from pathlib import Path


def _write_pdf(path: Path, texts: list[str]) -> str:
    import fitz

    path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    for text in texts:
        page = document.new_page()
        page.insert_textbox(fitz.Rect(60, 60, 540, 760), text, fontsize=15)
    document.save(path)
    document.close()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(data_dir: Path, keep: bool) -> None:
    os.environ["EXAMTUTOR_DATA_DIR"] = str(data_dir.resolve())
    from backend.app import llm, pipeline, prompts, store, workers
    from backend.app.db import init_db

    init_db()
    workers.enqueue_explanations = lambda *_args, **_kwargs: []
    pipeline.complete_knowledge_points = lambda *_args, **_kwargs: 0
    user_id = store.create_user("section-e2e", "unused")
    student = store.create_student(user_id, "Section Student")
    paper_id = "section-paper"
    job_id = "section-job"
    try:
        store.create_paper(paper_id, user_id, "Section Practice")
        file_id = store.add_paper_file(paper_id, "mixed", "sections.pdf", None)
        path = store.paper_dir(paper_id) / "files" / f"{file_id}.pdf"
        sha = _write_pdf(path, [
            "Section A\n1. What is 1+1?\nA. 1\nB. 2",
            "Section B\n1. What is 2+2?\nA. 3\nB. 4",
            "Answer Key\nSection A: 1=B\nSection B: 1=A",
        ])
        store.set_paper_file_sha(file_id, sha)
        pipeline.process_paper(paper_id)
        paper = store.get_paper(paper_id)
        if paper["status"] != "ready":
            raise AssertionError(f"分节试卷未就绪：{paper['status']} {paper.get('error')}")
        questions = sorted(store.get_paper_questions(paper_id), key=lambda item: int(item["number"]))
        if [item["correct_answer"] for item in questions] != ["B", "A"]:
            raise AssertionError(f"分节标准答案错配：{questions}")
        ids = [item["id"] for item in questions]

        pipeline.process_paper(paper_id, force=True)
        rerun = sorted(store.get_paper_questions(paper_id), key=lambda item: int(item["number"]))
        if [item["id"] for item in rerun] != ids or [item["correct_answer"] for item in rerun] != ["B", "A"]:
            raise AssertionError("强制重识后题目身份或标准答案变化")

        store.create_job(job_id, user_id, "answers.pdf", kind="submission",
                         paper_id=paper_id, student_id=student["id"])
        manifest = []
        for number, answer in ((1, "B"), (2, "A")):
            answer_id = store.new_job_id()
            answer_path = store.job_dir(job_id) / "files" / f"{answer_id}.pdf"
            answer_sha = _write_pdf(answer_path, [f"Student answer\n{number}. {answer}"])
            manifest.append({"id": answer_id, "filename": f"answer-{number}.pdf", "sha256": answer_sha})
        store.save_job_files(job_id, manifest)
        pipeline.process_submission(job_id)
        statuses = {item["number"]: item["status"] for item in store.get_questions(job_id)}
        if statuses != {"1": "correct", "2": "correct"}:
            raise AssertionError(f"分节作答判分错误：{statuses}")

        answer = llm.deepseek_chat([
            {"role": "system", "content": prompts.CHAT_SYSTEM},
            {"role": "user", "content": "1+1等于几？只回答数字。"},
        ], max_tokens=512)
        if "2" not in answer:
            raise AssertionError(f"答疑结果异常：{answer}")
        print({"paper": paper["status"], "answers": ["B", "A"], "submission": statuses, "chat": answer})
    finally:
        if not keep:
            shutil.rmtree(data_dir, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="真实模型分节同号端到端验收")
    parser.add_argument("--data-dir", type=Path, required=True, help="独立测试数据目录")
    parser.add_argument("--keep", action="store_true", help="保留测试数据")
    args = parser.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):
        parser.error("--data-dir 必须为空或不存在")
    args.data_dir.mkdir(parents=True, exist_ok=True)
    run(args.data_dir, args.keep)


if __name__ == "__main__":
    main()
