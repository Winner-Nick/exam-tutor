from app import pipeline


def test_grade_submission_questions_uses_only_answer_data():
    paper_questions = [
        {
            "id": "q1", "number": "1", "type": "single_choice",
            "stem": "选择题一", "options": {"A": "甲", "B": "乙"},
            "correct_answer": "B",
        },
        {
            "id": "q2", "number": "2", "type": "single_choice",
            "stem": "选择题二", "options": {"A": "甲", "B": "乙"},
            "correct_answer": "A",
        },
        {
            "id": "q3", "number": "3", "type": "single_choice",
            "stem": "未作答", "options": {"A": "甲", "B": "乙"},
            "correct_answer": "A",
        },
        {
            "id": "q4", "number": "4", "type": "subjective",
            "stem": "作文", "options": None, "correct_answer": "略",
        },
        {
            "id": "q5", "number": "5", "type": "fill_blank",
            "stem": "首都", "options": None, "correct_answer": "Paris",
        },
        {
            "id": "q6", "number": "6", "type": None,
            "stem": "无选项字母答案", "options": None, "correct_answer": "A",
        },
        {
            "id": "q7", "number": "7", "type": "single_choice",
            "stem": "缺标准答案", "options": {"A": "甲"}, "correct_answer": None,
        },
    ]
    answers = {
        "1": " b ",
        "2": "B",
        "4": "我的作文",
        "5": " paris ",
        "6": "B",
        "7": "A",
    }

    graded = pipeline.grade_submission_questions(paper_questions, answers)

    assert [q["id"] for q in graded] == [f"q{i}" for i in range(1, 8)]
    assert [q["status"] for q in graded] == [
        "correct", "wrong", "unknown", "subjective", "correct", "wrong", "unknown",
    ]
    assert [q["student_answer"] for q in graded] == [
        " b ", "B", None, "我的作文", " paris ", "B", "A",
    ]
    assert all("status" not in question for question in paper_questions)
