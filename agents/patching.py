"""Restrict edits to the vulnerable branch of VAmPI's book-read handler."""
import ast
import copy
import difflib


def _shape(source: str):
    tree = ast.parse(source)
    handler = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "get_by_title"), None)
    if handler is None or len(handler.body) != 2:
        raise ValueError("unsupported get_by_title structure; need the pinned source handoff")
    auth = handler.body[1]
    if not isinstance(auth, ast.If) or len(auth.orelse) != 1:
        raise ValueError("existing authentication branch must be preserved")
    branch = auth.orelse[0]
    if not isinstance(branch, ast.If) or not isinstance(branch.test, ast.Name) or branch.test.id != "vuln":
        raise ValueError("the existing vulnerable flag and reference branch must be preserved")
    measured = copy.deepcopy(tree)
    measured_handler = next(n for n in measured.body if isinstance(n, ast.FunctionDef) and n.name == "get_by_title")
    measured_handler.body[1].orelse[0].body = [ast.Pass()]
    return ast.dump(measured, include_attributes=False), branch.body


def validate_patch(before: str, after: str) -> None:
    original_shape, _ = _shape(before)
    new_shape, body = _shape(after)
    if original_shape != new_shape:
        raise PermissionError("only the vulnerable book-read branch may change; preserve auth, imports, other routes and reference behavior")
    for node in ast.walk(ast.Module(body=body, type_ignores=[])):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)):
            raise PermissionError("imports and global mutations are outside the book-authorization repair")
        if isinstance(node, ast.Name) and node.id in {"vuln", "exec", "eval", "__import__", "open", "setattr"}:
            raise PermissionError("flag changes and unrelated execution are outside scope")


def strategy_evidence(source: str, strategy: str) -> dict:
    _, body = _shape(source)
    branch = ast.Module(body=body, type_ignores=[])
    queries = [n for n in ast.walk(branch) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "filter_by" and ast.unparse(n.func.value) == "Book.query"]
    scoped = [q for q in queries if {k.arg for k in q.keywords} >= {"book_title"}
              and {k.arg for k in q.keywords} & {"user", "user_id"}]
    owner_comparisons = [n for n in ast.walk(branch) if isinstance(n, ast.Compare)
                         and any(isinstance(v, ast.Attribute) and v.attr in {"user", "user_id", "username"}
                                 for v in ast.walk(n))]
    observed = bool(scoped) and len(scoped) == len(queries) if strategy == "scoped-query" else bool(queries) and not scoped and bool(owner_comparisons)
    return {"strategy": strategy, "structurallyObserved": observed,
            "note": "Source structure only; this is not an independent correctness verdict."}


def unified_patch(before: str, after: str) -> str:
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                       fromfile="a/api_views/books.py", tofile="b/api_views/books.py"))
