"""后台 worker：作业处理队列 + 讲解优先级队列。

- 作业队列：固定 2 个 worker 线程，替代"每上传起一线程"，控制渲染/识别
  的内存峰值。
- 讲解队列：PriorityQueue，priority 0=用户点开插队，1=判分后预生成；
  单 worker 取出后凑同作业同优先级的题为一批，批量调 DeepSeek。
"""
from __future__ import annotations

import itertools
import queue
import threading

from . import events, llm, pipeline, prompts, store

JOB_WORKERS = 2
EXPLAIN_BATCH = 6  # 与 prompts.explain_user 的批量讲解能力匹配

_job_q: queue.Queue = queue.Queue()
_explain_q: queue.PriorityQueue = queue.PriorityQueue()
_seq = itertools.count()
_started = False
_start_lock = threading.Lock()


def start() -> None:
    global _started
    with _start_lock:
        if _started:
            return
        for i in range(JOB_WORKERS):
            threading.Thread(target=_job_worker, name=f"job-worker-{i}", daemon=True).start()
        threading.Thread(target=_explain_worker, name="explain-worker", daemon=True).start()
        _started = True


def enqueue_job(job_id: str) -> None:
    _job_q.put(("job", job_id))


def enqueue_paper(paper_id: str) -> None:
    _job_q.put(("paper", paper_id))


def enqueue_explanations(job_id: str, qids: list[str], priority: int = 1) -> list[str]:
    """入队待讲解题目。返回实际入队的 qid。

    priority=0（用户插队）时，已处于 queued 的题也重新投递高优先级条目；
    worker 端按 explain_state 去重，不会重复生成。
    """
    store.mark_explain_queued(job_id, qids)
    ready = [qid for qid in qids
             if (store.get_question(job_id, qid) or {}).get("explain_state") == "queued"]
    for qid in ready:
        _explain_q.put((priority, next(_seq), job_id, qid))
    return ready


def resume_pending() -> None:
    """重启续跑：processing 的试卷/作业重新入队；中断的讲解复位后重新入队。"""
    for paper_id in store.list_processing_paper_ids():
        enqueue_paper(paper_id)
    for job_id in store.list_processing_job_ids():
        enqueue_job(job_id)
    for job_id, qid in store.reset_stale_explanations():
        _explain_q.put((1, next(_seq), job_id, qid))


# ---------------------------------------------------------------------------
# worker 循环
# ---------------------------------------------------------------------------

def _job_worker() -> None:
    while True:
        kind, item_id = _job_q.get()
        try:
            if kind == "paper":
                pipeline.process_paper(item_id)
            else:
                job = store.get_job(item_id) or {}
                if job.get("kind") == "submission":
                    pipeline.process_submission(item_id)
                else:
                    pipeline.process_job(item_id)
        except Exception:  # noqa: BLE001 - 处理函数已把错误落库并发事件
            pass
        finally:
            _job_q.task_done()


def _explain_worker() -> None:
    while True:
        prio, _, job_id, qid = _explain_q.get()
        batch = [qid]
        deferred = []
        while len(batch) < EXPLAIN_BATCH:
            try:
                item = _explain_q.get_nowait()
            except queue.Empty:
                break
            if item[0] == prio and item[2] == job_id:
                batch.append(item[3])
            else:
                deferred.append(item)
        for item in deferred:
            _explain_q.put(item)
        try:
            _process_explain_batch(job_id, batch)
        except Exception:  # noqa: BLE001 - 单批失败不影响队列继续
            pass


def _process_explain_batch(job_id: str, qids: list[str]) -> None:
    targets = []
    for qid in qids:
        q = store.get_question(job_id, qid)
        if not q or q["explain_state"] != "queued":
            continue  # 已生成/正在生成（重复投递的高优先级条目落到这里）
        if q["status"] not in ("wrong", "unknown"):
            store.update_question(job_id, qid, explain_state="none")  # 改答后已不是错题
            continue
        store.update_question(job_id, qid, explain_state="generating")
        targets.append(q)
    if not targets:
        return

    try:
        res = llm.deepseek_json(prompts.EXPLAIN_SYSTEM, prompts.explain_user(targets))
        by_id = res.get("explanations") or {}
    except Exception:  # noqa: BLE001
        for q in targets:
            store.update_question(job_id, q["id"], explain_state="failed")
            events.publish(job_id, "question_explained", {"qid": q["id"], "state": "failed"})
        return

    for q in targets:
        exp = by_id.get(q["id"])
        if exp:
            fields = {"explanation": exp, "explain_state": "done"}
            if exp.get("knowledge_point") and not q.get("knowledge_point"):
                fields["knowledge_point"] = exp["knowledge_point"]
            store.update_question(job_id, q["id"], **fields)
            events.publish(job_id, "question_explained", {"qid": q["id"], "state": "done"})
        else:
            store.update_question(job_id, q["id"], explain_state="failed")
            events.publish(job_id, "question_explained", {"qid": q["id"], "state": "failed"})
