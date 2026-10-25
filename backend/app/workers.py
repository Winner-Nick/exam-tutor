"""持久任务 worker 与讲解优先级队列。"""
from __future__ import annotations

import inspect
import itertools
import logging
import queue
import threading
import time
from pathlib import Path

from . import events, llm, llm_schemas, pipeline, prompts, run_store, store
from .config import settings

logger = logging.getLogger(__name__)

JOB_WORKERS = 2
EXPLAIN_BATCH = 6
JOB_QUEUE_SIZE = 128

_job_q: queue.Queue = queue.Queue(maxsize=JOB_QUEUE_SIZE)
_explain_q: queue.PriorityQueue = queue.PriorityQueue()
_seq = itertools.count()
_started = False
_start_lock = threading.Lock()
_stop = threading.Event()
_threads: list[threading.Thread] = []
_last_due_scan = 0.0


def _offer(run_id: str) -> None:
    try:
        _job_q.put_nowait(run_id)
    except queue.Full:
        logger.warning("任务队列已满，run_id=%s 将在调度扫描后执行", run_id)


def _offer_due_runs() -> None:
    global _last_due_scan
    now = time.monotonic()
    if now - _last_due_scan < 0.5:
        return
    _last_due_scan = now
    for run in run_store.list_active_runs(due_only=True):
        _offer(run["id"])


def start() -> None:
    global _started, _threads, _stop
    with _start_lock:
        if _started:
            return
        _stop = threading.Event()
        _threads = []
        for index in range(JOB_WORKERS):
            thread = threading.Thread(target=_job_worker, name=f"job-worker-{index}", daemon=True)
            thread.start()
            _threads.append(thread)
        explain_thread = threading.Thread(target=_explain_worker, name="explain-worker", daemon=True)
        explain_thread.start()
        _threads.append(explain_thread)
        _started = True
        logger.info("后台 worker 已启动：job=%d explain=1", JOB_WORKERS)


def stop(timeout: float = 10.0) -> None:
    global _started, _threads
    with _start_lock:
        if not _started:
            run_store.recover_running()
            return
        _stop.set()
        deadline = time.monotonic() + timeout
        for thread in _threads:
            thread.join(max(0.0, deadline - time.monotonic()))
        alive = [thread.name for thread in _threads if thread.is_alive()]
        if alive:
            logger.warning("worker 停止超时，仍运行线程：%s", ", ".join(alive))
        _threads = []
        _started = False
        recovered = run_store.recover_running()
        if recovered:
            logger.info("停止时恢复 %d 个 running 任务为 queued", recovered)
        logger.info("后台 worker 已停止")


def enqueue_paper(paper_id: str, *, force: bool = False) -> None:
    paper = store.get_paper(paper_id)
    if not paper:
        return
    run, created = run_store.enqueue_run(
        "paper", paper_id, "process", paper["user_id"],
        options={"force": force}, max_attempts=5,
    )
    if created:
        _offer(run["id"])


def enqueue_job(job_id: str, *, force: bool = False) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    operation = "process_submission" if job["kind"] == "submission" else "process_legacy"
    run, created = run_store.enqueue_run(
        "job", job_id, operation, job["user_id"],
        options={"force": force}, max_attempts=5,
    )
    if created:
        _offer(run["id"])


def enqueue_paper_reconcile(paper_id: str, *, force: bool = False) -> int:
    pending = run_store.count_outdated_submissions(paper_id, force=force)
    if not pending:
        return 0
    paper = store.get_paper(paper_id)
    if not paper:
        return 0
    run, created = run_store.enqueue_run(
        "paper", paper_id, "reconcile", paper["user_id"],
        options={"force": force}, max_attempts=3,
    )
    if created:
        _offer(run["id"])
    return pending


def enqueue_job_cleanup(job: dict) -> None:
    files = store.job_files(job["id"])
    run, created = run_store.enqueue_run(
        "job", job["id"], "cleanup", job["user_id"],
        options={
            "paper_id": job.get("paper_id"),
            "sha256": [item.get("sha256") for item in files if item.get("sha256")],
        },
    )
    if created:
        _offer(run["id"])


def enqueue_paper_cleanup(paper: dict) -> None:
    run, created = run_store.enqueue_run("paper", paper["id"], "cleanup", paper["user_id"])
    if created:
        _offer(run["id"])


def enqueue_file_cleanup(resource_type: str, resource_id: str, owner_id: int,
                         paths: list[str]) -> None:
    run, created = run_store.enqueue_run(
        resource_type, resource_id, "cleanup_files", owner_id,
        options={"paths": paths},
    )
    if created:
        _offer(run["id"])


def resume_pending() -> None:
    """恢复持久 run、旧 processing/deleting 记录和未同步提交。"""
    recovered = run_store.recover_running()
    if recovered:
        logger.info("重启恢复 %d 个 running 任务", recovered)
    for run in run_store.list_active_runs():
        _offer(run["id"])
    for paper_id in store.list_processing_paper_ids():
        enqueue_paper(paper_id)
    for job_id in store.list_processing_job_ids():
        enqueue_job(job_id)
    for paper_id in store.list_deleting_paper_ids():
        paper = store.get_paper(paper_id)
        if paper:
            enqueue_paper_cleanup(paper)
    for job_id in store.list_deleting_job_ids():
        job = store.get_job(job_id)
        if job:
            enqueue_job_cleanup(job)
    outdated_papers = {
        row[0] for row in store.get_conn().execute(
            """SELECT DISTINCT j.paper_id FROM jobs j JOIN papers p ON p.id = j.paper_id
               WHERE j.kind = 'submission' AND j.status != 'processing'
                 AND (j.applied_paper_revision IS NULL
                      OR j.applied_paper_revision < p.revision)"""
        ).fetchall()
    }
    for paper_id in outdated_papers:
        enqueue_paper_reconcile(paper_id)
    for job_id, qid in store.reset_stale_explanations():
        _explain_q.put((1, next(_seq), job_id, qid))


def _job_worker() -> None:
    while not _stop.is_set():
        try:
            run_id = _job_q.get(timeout=0.2)
        except queue.Empty:
            _offer_due_runs()
            continue
        try:
            _execute_run_id(run_id)
        except Exception:  # noqa: BLE001
            logger.exception("任务执行未被捕获 run_id=%s", run_id)
        finally:
            _job_q.task_done()
            _offer_due_runs()


def _execute_run_id(run_id: str) -> None:
    run = run_store.claim_run(run_id)
    if not run:
        return
    generation, attempt = run["generation"], run["attempt"]
    heartbeat_stop = threading.Event()

    def beat() -> None:
        while not heartbeat_stop.wait(2.0):
            if not run_store.heartbeat(run_id, generation, attempt):
                return

    heartbeat_thread = threading.Thread(target=beat, name=f"heartbeat-{run_id[:8]}", daemon=True)
    heartbeat_thread.start()
    logger.info(
        "任务开始 run_id=%s resource=%s/%s operation=%s generation=%s attempt=%s",
        run_id, run["resource_type"], run["resource_id"], run["operation"],
        generation, attempt,
    )
    try:
        _execute_run(run)
    except run_store.RetryLater as exc:
        state = run_store.mark_retry(run_id, generation, str(exc), exc.delay, attempt)
        if state == "error":
            _mark_resource_error(run, str(exc))
        logger.info("任务延迟/终止 run_id=%s state=%s error=%s", run_id, state, exc)
    except run_store.StaleRun:
        logger.warning("丢弃失效任务 run_id=%s generation=%s attempt=%s", run_id, generation, attempt)
    except Exception as exc:  # noqa: BLE001
        logger.exception("任务失败 run_id=%s", run_id)
        if run_store.mark_error(run_id, generation, f"{type(exc).__name__}: {exc}", attempt):
            _mark_resource_error(run, f"{type(exc).__name__}: {exc}")
    else:
        if run_store.mark_done(run_id, generation, attempt):
            logger.info("任务完成 run_id=%s", run_id)
            run_store.followups(run)
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=3.0)


def _call_pipeline(function, resource_id: str, run: dict, **kwargs):
    parameters = inspect.signature(function).parameters
    accepts_kwargs = any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
    )
    if not accepts_kwargs:
        kwargs = {key: value for key, value in kwargs.items() if key in parameters}
    if "run" in parameters:
        kwargs["run"] = run
    return function(resource_id, **kwargs)


def _execute_run(run: dict) -> None:
    resource_id, operation = run["resource_id"], run["operation"]
    run_store.assert_current(run["id"], run["generation"], run["attempt"])
    if operation == "process":
        paper = store.get_paper(resource_id)
        if not paper or paper["status"] == "deleting":
            return
        if paper["status"] != "processing":
            raise run_store.StaleRun("试卷已不在处理状态")
        _call_pipeline(
            pipeline.process_paper, resource_id, run,
            force=bool(run["options"].get("force")),
        )
    elif operation in ("process_submission", "process_legacy"):
        job = store.get_job(resource_id)
        if not job or job["status"] == "deleting":
            return
        if job["status"] != "processing":
            raise run_store.StaleRun("提交已不在处理状态")
        if operation == "process_submission" and job["kind"] == "submission":
            _call_pipeline(
                pipeline.process_submission, resource_id, run,
                force=bool(run["options"].get("force")),
            )
        elif operation == "process_legacy" and job["kind"] == "legacy":
            _call_pipeline(
                pipeline.process_job, resource_id, run,
                force=bool(run["options"].get("force")),
            )
        else:
            raise run_store.StaleRun("任务类型与记录不一致")
    elif operation == "reconcile":
        if store.get_paper(resource_id):
            _call_pipeline(
                pipeline.regrade_paper_submissions, resource_id, run,
                force=bool(run["options"].get("force")),
            )
    elif operation == "cleanup":
        _cleanup_resource(run)
    elif operation == "cleanup_files":
        _cleanup_files(run)
    else:
        raise ValueError(f"未知任务 operation: {operation}")
    run_store.assert_current(run["id"], run["generation"], run["attempt"])


def _mark_resource_error(run: dict, error: str) -> None:
    resource_id = run["resource_id"]
    if run["operation"] == "process" and store.get_paper(resource_id):
        store.update_paper(resource_id, status="error", stage="done", error=error)
    elif run["operation"] in ("process_submission", "process_legacy") and store.get_job(resource_id):
        store.update_job(resource_id, status="error", stage="done", error=error)


def _cleanup_resource(run: dict) -> None:
    resource_id = run["resource_id"]
    try:
        if run["resource_type"] == "job":
            store.delete_job(resource_id)
            store.cleanup_path(store.JOBS_DIR / resource_id)
            paper_id = run["options"].get("paper_id")
            if paper_id:
                for sha in run["options"].get("sha256") or []:
                    store.cleanup_answer_cache(paper_id, sha)
        else:
            store.delete_paper(resource_id)
            store.cleanup_path(store.PAPERS_DIR / resource_id)
    except OSError as exc:
        raise run_store.RetryLater(f"文件清理失败，将重试: {exc}", delay=2.0) from exc


def _cleanup_files(run: dict) -> None:
    try:
        for raw_path in run["options"].get("paths") or []:
            store.cleanup_path(Path(raw_path))
    except OSError as exc:
        raise run_store.RetryLater(f"文件清理失败，将重试: {exc}", delay=2.0) from exc


def enqueue_explanations(job_id: str, qids: list[str], priority: int = 1) -> list[str]:
    """入队待讲解题目。返回实际入队的 qid。"""
    store.mark_explain_queued(job_id, qids)
    ready = [qid for qid in qids
             if (store.get_question(job_id, qid) or {}).get("explain_state") == "queued"]
    for qid in ready:
        _explain_q.put((priority, next(_seq), job_id, qid))
    return ready


def _explain_worker() -> None:
    while not _stop.is_set():
        try:
            prio, _, job_id, qid = _explain_q.get(timeout=0.2)
        except queue.Empty:
            continue
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
            _explain_q.task_done()
        try:
            _process_explain_batch(job_id, batch)
        except Exception:  # noqa: BLE001
            logger.exception("讲解批处理失败 job=%s qids=%s", job_id, batch)
        finally:
            for _ in batch:
                _explain_q.task_done()


def _process_explain_batch(job_id: str, qids: list[str]) -> None:
    targets = []
    with store.job_lock(job_id):
        for qid in qids:
            q = store.get_question(job_id, qid)
            if not q or q["explain_state"] != "queued":
                continue
            if q["status"] not in ("wrong", "unknown"):
                store.update_question(job_id, qid, explain_state="none")
                continue
            store.update_question(job_id, qid, explain_state="generating")
            targets.append(q)
    if not targets:
        return

    handled: set[str] = set()
    try:
        try:
            res = llm.deepseek_json(prompts.explain_system(store.get_job(job_id) or {}), prompts.explain_user(targets))
            by_id = llm_schemas.validate_explanations(res)
        except Exception:  # noqa: BLE001
            logger.exception("讲解模型调用失败 job=%s", job_id)
            by_id = {}

        for q in targets:
            revision = q["revision"]
            try:
                exp = by_id.get(q["id"])
                if exp and not isinstance(exp, dict):
                    raise TypeError("单题讲解必须是对象")
                with store.job_lock(job_id):
                    if exp:
                        written = store.write_explanation(
                            job_id, q["id"], revision, exp, exp.get("knowledge_point"),
                        )
                        state = "done" if written else "stale"
                    else:
                        store.fail_explanation(job_id, q["id"], revision)
                        state = "failed"
            except Exception:  # noqa: BLE001
                logger.exception("讲解写入失败 job=%s qid=%s", job_id, q["id"])
                with store.job_lock(job_id):
                    store.fail_explanation(job_id, q["id"], revision)
                state = "failed"
            handled.add(q["id"])
            events.publish(job_id, "question_explained", {"qid": q["id"], "state": state})
    finally:
        for q in targets:
            if q["id"] in handled:
                continue
            with store.job_lock(job_id):
                store.fail_explanation(job_id, q["id"], q["revision"])
            events.publish(job_id, "question_explained", {"qid": q["id"], "state": "failed"})
