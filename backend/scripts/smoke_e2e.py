"""使用合成试卷和真实 DeepSeek 中转执行端到端冒烟；不读取真实用户数据。"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
from pathlib import Path


def _write_pdf(path: Path, text: str) -> str:
    import fitz

    path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    page = document.new_page()
    page.insert_textbox(fitz.Rect(60, 60, 540, 760), text, fontsize=14)
    document.save(path)
    document.close()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(data_dir: Path, keep: bool) -> None:
    os.environ["EXAMTUTOR_DATA_DIR"] = str(data_dir.resolve())
    from backend.app import pipeline, store, workers
    from backend.app.db import init_db

    init_db()
    workers.enqueue_explanations = lambda *_args, **_kwargs: []
    pipeline.complete_knowledge_points = lambda *_args, **_kwargs: 0
    user_id = store.create_user("synthetic-e2e", "unused")
    student = store.create_student(user_id, "Synthetic Student")
    paper_id = "synthetic-paper"
    job_id = "synthetic-job"
    try:
        store.create_paper(paper_id, user_id, "Synthetic Practice")
        paper_file = store.add_paper_file(paper_id, "mixed", "paper.pdf", None)
        paper_path = store.paper_dir(paper_id) / "files" / f"{paper_file}.pdf"
        sha = _write_pdf(
            paper_path,
            "Synthetic Practice\n\n"
            "1. What is 1+1?\nA. 1\nB. 2\n\n"
            "2. What is 2+2?\nA. 3\nB. 4\n\n"
            "Answer Key\n1. B\n2. B",
        )
        store.set_paper_file_sha(paper_file, sha)
        pipeline.process_paper(paper_id)
        paper = store.get_paper(paper_id)
        if paper["status"] != "ready":
            raise AssertionError(f"试卷未就绪：{paper['status']} {paper.get('error')}")
        identified = {q["source_key"]: q["id"] for q in store.get_paper_questions(paper_id)}
        if not all(identified):
            raise AssertionError("OCR 题缺少稳定 source identity")
        paper_revision = paper["revision"]
        pipeline.process_paper(paper_id)
        paper = store.get_paper(paper_id)
        if {q["source_key"]: q["id"] for q in store.get_paper_questions(paper_id)} != identified:
            raise AssertionError("缓存重识别改变了题目 qid")
        if paper["revision"] != paper_revision:
            raise AssertionError("无内容变化的缓存重识别推进了 paper revision")

        store.create_job(
            job_id, user_id, "answers.pdf", kind="submission",
            paper_id=paper_id, student_id=student["id"],
        )
        manifest = []
        for number, answer in ((1, "B"), (2, "A")):
            file_id = store.new_job_id()
            path = store.job_dir(job_id) / "files" / f"{file_id}.pdf"
            sha = _write_pdf(path, f"Student Answers\n{number}. {answer}")
            manifest.append({"id": file_id, "filename": f"answer-{number}.pdf", "sha256": sha})
        store.save_job_files(job_id, manifest)
        pipeline.process_submission(job_id)
        initial = {q["number"]: q["status"] for q in store.get_questions(job_id)}
        if initial != {"1": "correct", "2": "wrong"}:
            raise AssertionError(f"初次判分不符合预期：{initial}")

        removed = manifest.pop()
        store.save_job_files(job_id, manifest)
        for path in (store.job_dir(job_id) / "files").glob(f"{removed['id']}.*"):
            path.unlink()
        pipeline.process_submission(job_id)
        rerun = {q["number"]: q["status"] for q in store.get_questions(job_id)}
        if rerun != {"1": "correct", "2": "unknown"}:
            raise AssertionError(f"删除文件后判分不符合预期：{rerun}")
        print({"paper": paper["status"], "initial": initial, "after_delete": rerun})
    finally:
        if not keep:
            shutil.rmtree(data_dir, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="真实模型端到端合成数据冒烟")
    parser.add_argument("--data-dir", type=Path, required=True, help="独立测试数据目录，禁止现有数据目录")
    parser.add_argument("--keep", action="store_true", help="保留测试数据供检查")
    args = parser.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):
        parser.error("--data-dir 必须为空或不存在")
    args.data_dir.mkdir(parents=True, exist_ok=True)
    run(args.data_dir, args.keep)


if __name__ == "__main__":
    main()
