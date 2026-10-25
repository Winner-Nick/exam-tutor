"""在本机重置 ExamTutor 账号密码：python -m backend.scripts.reset_password 用户名 新密码。"""
from __future__ import annotations

import argparse

from backend.app import auth, store
from backend.app.db import init_db


def main() -> None:
    parser = argparse.ArgumentParser(description="重置 ExamTutor 账号密码并使旧会话失效")
    parser.add_argument("username")
    parser.add_argument("password")
    args = parser.parse_args()
    if not 8 <= len(args.password) <= 128:
        parser.error("密码需为 8-128 个字符")
    init_db()
    user = store.get_user_by_username(args.username.strip())
    if not user:
        parser.error("账号不存在")
    store.set_password(user["id"], auth.hash_password(args.password))
    print(f"已重置 {user['username']} 的密码；其他登录会话已失效。")


if __name__ == "__main__":
    main()
