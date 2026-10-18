#!/usr/bin/env bash
# Prove the grader fails on each seeded bug and passes on the reference fix.
# Does not call Claude. Uses the pinned Click checkout and pytest.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$ROOT/lib.sh"

wd=""
cleanup() {
  if [[ -n $wd && -d $wd ]]; then
    rm -rf "$wd"
  fi
}
trap cleanup EXIT

wd=$(make_workdir t3-explain)

if find "$wd" \( -name 'test_t4_pluralize.py' -o -name 't4-pluralize.patch' -o -name 't3-ANSWER.md' \) | grep -q .; then
  die "hidden grader material was copied into the workdir"
fi

expect() {
  local task=$1
  local want=$2
  local got
  got=$("$ROOT/grade.sh" "$task" "$wd")
  if [[ $got != "$want" ]]; then
    printf 'grade %s: want %s, got %s\n' "$task" "$want" "$got" >&2
    tail -n 40 "$wd/.venv/grade-pytest.log" >&2 || true
    tail -n 40 "$wd/.venv/grade-hidden.log" >&2 || true
    exit 1
  fi
  printf 'ok %s %s\n' "$task" "$want"
}

restore_src() {
  git -C "$wd" checkout -- src
}

# t4 before the reference fix: the function is absent, so the suite is not the point.
expect t4-pluralize FAIL:not_in_utils
git -C "$wd" apply --whitespace=nowarn "$ROOT/hidden/reference/t4-pluralize.patch"
expect t4-pluralize PASS
printf '%s\n' 'def test_cheat():' '    pass' > "$wd/tests/test_bench_cheat.py"
expect t4-pluralize FAIL:tests_modified
rm -f "$wd/tests/test_bench_cheat.py"
expect t4-pluralize PASS
restore_src

# t1: two Click tests fail until the off-by-one is reverted.
git -C "$wd" apply --whitespace=nowarn "$ROOT/patches/t1-intrange.patch"
expect t1-intrange FAIL:suite
restore_src
expect t1-intrange PASS
printf '%s\n' '# touched' >> "$wd/tests/test_basic.py"
expect t1-intrange FAIL:tests_modified
git -C "$wd" checkout -- tests

# t2: the parser bug fails a large part of the suite.
git -C "$wd" apply --whitespace=nowarn "$ROOT/patches/t2-splitopt.patch"
expect t2-splitopt FAIL:suite
restore_src
expect t2-splitopt PASS

# t3: keyword floor, and src must stay untouched.
expect t3-explain FAIL:no_answer
printf '%s\n' 'consume_value only' > "$wd/ANSWER.md"
got=$("$ROOT/grade.sh" t3-explain "$wd")
[[ $got == FAIL:missing,* ]] || die "partial answer graded as $got"
printf 'ok t3-explain %s\n' "$got"
cp "$ROOT/hidden/reference/t3-ANSWER.md" "$wd/ANSWER.md"
expect t3-explain PASS
printf '%s\n' '# touched' >> "$wd/src/click/__init__.py"
expect t3-explain FAIL:src_modified
restore_src
expect t3-explain PASS

got=$("$ROOT/grade.sh" not-a-task "$wd")
[[ $got == FAIL:unknown_task ]] || die "unknown task graded as $got"
printf 'ok unknown %s\n' "$got"
got=$("$ROOT/grade.sh" t1-intrange /tmp/token-savings-missing-wd)
[[ $got == FAIL:nowd ]] || die "missing workdir graded as $got"
printf 'ok missing-wd %s\n' "$got"

printf 'graders ok\n'
