"""
Parse modelcontextprotocol/access config to determine maintainer status.

Source of truth for who-can-review-what. Replaces hardcoded maintainer lists.

The access repo is Pulumi-managed TS. Structure is regular enough to regex-parse —
cheaper than shelling out to ts-node and no node dependency.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

ACCESS_DIR = Path("./access-config")  # overridden by --maintainers-json in practice


@dataclass
class RepoMaintainers:
    repo: str
    all: set[str] = field(default_factory=set)   # everyone with push+ access
    auth: set[str] = field(default_factory=set)  # members of the repo's *-auth team


def _parse_users(path: Path) -> dict[str, list[str]]:
    """users.ts → {github_login: [role_id, ...]}"""
    text = path.read_text()
    # Each block: github: 'name', ... memberOf: [ROLE_IDS.X, ROLE_IDS.Y]
    # Multi-line memberOf arrays are common.
    members: dict[str, list[str]] = {}
    # Split on `},\n  {` to get individual member blocks
    for block in re.split(r"\},\s*\{", text):
        gh = re.search(r"github:\s*'([^']+)'", block)
        if not gh:
            continue
        login = gh.group(1)
        # Find memberOf array contents (may span lines)
        mo = re.search(r"memberOf:\s*\[(.*?)\]", block, re.DOTALL)
        if not mo:
            members[login] = []
            continue
        roles = re.findall(r"ROLE_IDS\.(\w+)", mo.group(1))
        members[login] = roles
    return members


def _parse_repo_access(path: Path) -> dict[str, tuple[set[str], set[str]]]:
    """repoAccess.ts → {repo: (teams_with_push_or_more, direct_users_with_push_or_more)}"""
    text = path.read_text()
    result: dict[str, tuple[set[str], set[str]]] = {}
    # Find each `repository: 'name'` then scan forward to the next one.
    # Brace-splitting fails because teams/users arrays contain nested `}, {`.
    repo_starts = [(m.start(), m.group(1)) for m in re.finditer(r"repository:\s*'([^']+)'", text)]
    for i, (start, repo) in enumerate(repo_starts):
        end = repo_starts[i + 1][0] if i + 1 < len(repo_starts) else len(text)
        block = text[start:end]
        teams = set(
            m.group(1) for m in re.finditer(
                r"team:\s*'([^']+)',\s*permission:\s*'(push|maintain|admin)'", block
            )
        )
        users = set(
            m.group(1) for m in re.finditer(
                r"username:\s*'([^']+)',\s*permission:\s*'(push|maintain|admin)'", block
            )
        )
        result[repo] = (teams, users)
    return result


# Map ROLE_IDS constants → team slugs. Mostly kebab-case of the constant,
# but roleIds.ts has a few that aren't — parse it to be safe.
def _parse_role_ids(path: Path) -> dict[str, str]:
    text = path.read_text()
    mapping: dict[str, str] = {}
    for m in re.finditer(r"(\w+):\s*'([^']+)'", text):
        mapping[m.group(1)] = m.group(2)
    return mapping


def load(repo: str) -> RepoMaintainers:
    users_by_role = _parse_users(ACCESS_DIR / "users.ts")
    repo_access = _parse_repo_access(ACCESS_DIR / "repoAccess.ts")
    role_to_slug = _parse_role_ids(ACCESS_DIR / "roleIds.ts")
    slug_to_role = {v: k for k, v in role_to_slug.items()}

    if repo not in repo_access:
        raise ValueError(f"repo {repo!r} not in access/repoAccess.ts")

    teams, direct_users = repo_access[repo]

    # Expand teams → users. core-maintainers implicitly have access everywhere.
    maintainer_roles = {slug_to_role[t] for t in teams if t in slug_to_role}
    maintainer_roles.add("CORE_MAINTAINERS")

    all_maintainers = set(direct_users)
    auth_maintainers: set[str] = set()

    auth_team_slug = f"{repo}-auth"
    auth_role = slug_to_role.get(auth_team_slug)

    for login, roles in users_by_role.items():
        if set(roles) & maintainer_roles:
            all_maintainers.add(login)
        if auth_role and auth_role in roles:
            auth_maintainers.add(login)

    return RepoMaintainers(repo=repo, all=all_maintainers, auth=auth_maintainers)


# Role → repo map for Den's pre-parsed maintainers.json (mcp-repo-data-tracker/data/maintainers.json).
# That file is {maintainers: [{github, roles: ["ROLE_IDS.X"]}]} — the team→repo expansion
# that repoAccess.ts gives us has to be hardcoded here since Den doesn't parse repoAccess.ts.
_VISR_REPO_ROLES = {
    "typescript-sdk": {"ROLE_IDS.TYPESCRIPT_SDK", "ROLE_IDS.CORE_MAINTAINERS", "ROLE_IDS.LEAD_MAINTAINERS"},
    "python-sdk":     {"ROLE_IDS.PYTHON_SDK",     "ROLE_IDS.CORE_MAINTAINERS", "ROLE_IDS.LEAD_MAINTAINERS"},
}
_VISR_AUTH_ROLE = "ROLE_IDS.AUTH_MAINTAINERS"


def load_from_visr_json(repo: str, path: str) -> RepoMaintainers:
    import json
    data = json.loads(Path(path).read_text())
    repo_roles = _VISR_REPO_ROLES.get(repo, {"ROLE_IDS.CORE_MAINTAINERS"})
    all_m, auth_m = set(), set()
    for entry in data["maintainers"]:
        roles = set(entry.get("roles", []))
        if roles & repo_roles:
            all_m.add(entry["github"])
        if _VISR_AUTH_ROLE in roles:
            auth_m.add(entry["github"])
    return RepoMaintainers(repo=repo, all=all_m, auth=auth_m)


if __name__ == "__main__":
    import sys
    repo = sys.argv[1] if len(sys.argv) > 1 else "typescript-sdk"
    m = load(repo)
    print(f"{repo}: {len(m.all)} maintainers, {len(m.auth)} auth-maintainers")
    print(f"  all:  {sorted(m.all)}")
    print(f"  auth: {sorted(m.auth)}")
