from __future__ import annotations

from ..db import transaction
from .. import events, store
from .shared import _assert_run
from .submission import _assemble_submission_questions, _submission_snapshot

def regrade_paper_submissions(paper_id: str, *, force: bool = False,
                              run: dict | None = None) -> int:
    """按稳定 qid 全集 reconcile；每个提交独立在一个 DB 事务内落盘。"""
    changed_submissions = 0
    with store.paper_lock(paper_id):
        _assert_run(run)
        paper = store.get_paper(paper_id)
        if not paper:
            return 0
        paper_questions = store.get_paper_questions(paper_id)
        for job_id in store.list_submission_ids_for_paper(paper_id):
            with store.job_lock(job_id):
                job = store.get_job(job_id)
                if not job or job["status"] == "processing":
                    continue
                if not force and job.get("applied_paper_revision") == paper["revision"]:
                    continue
                old_questions = store.get_questions(job_id)
                questions = _assemble_submission_questions(paper_questions, old_questions, None)
                meta, status, error = _submission_snapshot(job, paper, paper_questions, questions)
                with transaction():
                    _assert_run(run)
                    store.replace_questions(job_id, questions)
                    stats = store.refresh_stats(job_id)
                    store.update_job(
                        job_id, status=status, meta=meta, error=error,
                        applied_paper_revision=paper["revision"],
                    )
                changed_submissions += 1
                explain_targets = [
                    q["id"] for q in store.get_questions(job_id)
                    if q["status"] in ("wrong", "unknown") and not q.get("explanation")
                ]
                if explain_targets:
                    from .. import workers
                    workers.enqueue_explanations(job_id, explain_targets, priority=1)
                events.publish(job_id, "job_done", {
                    "status": status, "regraded": True, "stats": stats,
                    "applied_paper_revision": paper["revision"],
                })
    return changed_submissions
