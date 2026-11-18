"""Create the Social Update database from schema.sql.

Usage:
    pip install pymysql
    python create_database.py                      # uses schema.sql next to this file
    python create_database.py path/to/schema.sql   # custom schema path

Connection settings come from environment variables (defaults in brackets):
    DB_HOST [localhost]  DB_PORT [3306]  DB_USER [root]  DB_PASSWORD [""]
"""
import os
import re
import sys
from pathlib import Path

import pymysql
from pymysql.err import OperationalError, ProgrammingError

try:
    from dotenv import load_dotenv

    _here = Path(__file__).resolve().parent
    _candidates = [
        _here / ".env",
        Path.cwd() / ".env",
        _here / "backend" / ".env",
        _here.parent / "backend" / ".env",
        Path.cwd() / "backend" / ".env",
        _here.parent / ".env",
    ]
    _found = next((p for p in _candidates if p.is_file()), None)
    if _found:
        load_dotenv(_found, override=True)
        print(f"Loaded .env from: {_found}")
    else:
        print("No .env file found. Looked in:")
        for p in _candidates:
            print(f"  {p}")
except ImportError:
    print("python-dotenv is not installed, so .env is ignored. Run: pip install python-dotenv")

print(f"DB_USER={os.getenv('DB_USER', 'root')}, DB_PASSWORD {'is set' if os.getenv('DB_PASSWORD') else 'is EMPTY'}")

# MySQL error codes that are safe to ignore when re-running the schema
IGNORABLE = {
    1060,  # duplicate column name
    1061,  # duplicate key name
    1050,  # table already exists
}


def load_statements(path: Path) -> list[str]:
    sql = path.read_text(encoding="utf-8")
    sql = re.sub(r"--[^\n]*", "", sql)  # strip line comments
    return [s.strip() for s in sql.split(";") if s.strip()]


def main() -> int:
    schema = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("schema.sql")
    if not schema.exists():
        print(f"Schema file not found: {schema}")
        return 1

    try:
        conn = pymysql.connect(
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASSWORD", ""),
            charset="utf8mb4",
            autocommit=True,
        )
    except OperationalError as e:
        print(f"Could not connect to MySQL: {e}")
        return 1

    statements = load_statements(schema)
    with conn, conn.cursor() as cur:
        for i, stmt in enumerate(statements, 1):
            label = " ".join(stmt.split())[:70]
            try:
                cur.execute(stmt)
                print(f"[{i}/{len(statements)}] OK      {label}")
            except (OperationalError, ProgrammingError) as e:
                if e.args and e.args[0] in IGNORABLE:
                    print(f"[{i}/{len(statements)}] SKIPPED {label}  ({e.args[1]})")
                else:
                    print(f"[{i}/{len(statements)}] FAILED  {label}\n    {e}")
                    return 1

    print("\nDatabase 'social_update' is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())