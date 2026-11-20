"""予約ルール（docs/js/schedule.js と core.js）を Apps Script 用の gas/Shared.gs にまとめる。

画面とサーバーで同じルールを使うための変換。ルールを直したら、これを実行してから
gas/ の中身を Apps Script に貼り直す。

    python tools/build_gas.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = [ROOT / "docs/js/schedule.js", ROOT / "docs/js/core.js"]
OUT = ROOT / "gas/Shared.gs"


def convert(text: str) -> str:
    text = re.sub(r"^import[\s\S]*?from\s+\"[^\"]+\";\s*$", "", text, flags=re.M)  # import文を消す
    text = re.sub(r"^export\s+", "", text, flags=re.M)                              # export を消す
    text = re.sub(r"\basync\s+(?=function|\(|[A-Za-z_$][\w$]*\s*\()", "", text)    # Apps Scriptは同期で動かす
    text = re.sub(r"\bawait\s+", "", text)
    return text


def main() -> None:
    parts = ["// 自動生成ファイル。直接編集しない（docs/js/schedule.js と core.js を直して tools/build_gas.py を実行）\n"]
    for f in SRC:
        parts.append(f"\n// ===== {f.name} =====\n")
        parts.append(convert(f.read_text(encoding="utf-8")))
    body = "".join(parts)
    for word in ("import ", "export ", "await "):
        if re.search(rf"^\s*{word}", body, flags=re.M):
            raise SystemExit(f"変換しきれない記述があります: {word.strip()}")
    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(body.splitlines())} lines)")

    # 貼り付け1回で済む1ファイル版（Shared + Code + 管理画面HTML）
    admin_html = (ROOT / "gas/Admin.html").read_text(encoding="utf-8")
    if "`" in admin_html or "${" in admin_html:
        raise SystemExit("Admin.html にバッククォートや ${ があると1ファイル版にできません")
    code = (ROOT / "gas/Code.gs").read_text(encoding="utf-8")
    bundle = (
        "// mowaプログラミング教室 予約システム（1ファイル版・自動生成）\n"
        "// このファイルの中身を Apps Script の「コード.gs」に丸ごと貼り付ける。\n\n"
        + body + "\n\n// ===== Admin.html =====\nconst ADMIN_HTML = `" + admin_html + "`;\n\n// ===== Code.gs =====\n" + code
    )
    dist = ROOT / "gas/dist/Bundle.gs"
    dist.parent.mkdir(exist_ok=True)
    dist.write_text(bundle.replace("\r\n", "\n"), encoding="utf-8")
    print(f"wrote {dist.relative_to(ROOT)} ({len(bundle.splitlines())} lines)")


if __name__ == "__main__":
    main()
