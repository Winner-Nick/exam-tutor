"""核心处理流水线兼容 facade。"""
from __future__ import annotations

from .. import events, llm, llm_schemas, pdf_utils, prompts, run_store, store
from ..db import transaction
from .artifacts import (
    _cache_lock_for,
    _cache_locks,
    _cache_locks_guard,
    _is_blank_entry,
    _render_files,
    _supports_on_page,
    _vision_file_pages,
)
from .grading import (
    _answer_text,
    _choice_labels,
    _compare_fill,
    _grade_all,
    _grade_one,
    _numeric_value,
    _unreliable_reference,
)
from .identity import (
    _answer_for,
    _answer_stub,
    _ensure_unique_numbers,
    _global_numbering_ok,
    _identity_aliases,
    _legacy_identity_match,
    _mark_number_conflicts,
    _merge_pages,
    _merge_paper_continuation,
    _new_paper_occurrence,
    _normalize_full_page,
    _number_conflicts,
    _prepare_source_occurrences,
    _reconcile_paper_identity,
    _renumber_pages,
    build_paper_questions,
)
from .legacy import build_questions, process_job, _preserve_overrides
from .paper import _set_paper_progress, complete_knowledge_points, process_paper
from .reconcile import regrade_paper_submissions
from .shared import (
    _CONF,
    _PAGE_FOOTER,
    _SUBJECTIVE_HINT,
    _TITLE_BAD,
    _assert_run,
    _num_key,
    _set_progress,
    _stats,
    build_meta,
    regrade,
)
from .submission import (
    _answer_cache_mode,
    _assemble_submission_questions,
    _normalized_observations,
    _paper_source_quality,
    _submission_snapshot,
    grade_submission_questions,
    process_submission,
)

__all__ = [name for name in globals() if not name.startswith("__")]
