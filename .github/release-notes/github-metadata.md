# GitHub metadata (suggested)

**Repository description (350 characters max):**

Executable project memory for coding agents: compiled behavior and structure contracts that agents query with `blabla status`/`explain` and verify with `blabla finish`. Coverage-guided behavior verification with minimized counterexamples, static structure checks, GREEN/YELLOW/RED completion gate. Experimental alpha.

**Topics:**

```text
ai-agents
coding-agents
llm
verification
property-testing
dsl
rust
agentic-coding
```

**Release title:**

```text
v0.5.0-alpha — First Public Alpha
```

**Social preview text:**

```text
BlaBla — executable project memory for coding agents
BEHAVIOR GREEN · STRUCTURE GREEN · OVERALL GREEN
```

**About sidebar:** link the README quick start, `docs/research.md` and the release notes. Mark the release as a pre-release.

## Repository

```text
https://github.com/Kiborgik/blabla
```

Public, default branch `main`, issues enabled, wiki disabled, no Pages. The URL is substituted in `CITATION.cff`, `README.md`, `CONTRIBUTING.md` and both Reddit drafts; no placeholder remains.

**Publishing order:**

1. Create the repository, substitute the URL, push `main`.
2. Enable GitHub private vulnerability reporting — `SECURITY.md` points contributors at it, and so does `CODE_OF_CONDUCT.md`.
3. Let the first CI run on `main` finish on Windows and Linux. Do not advertise a platform CI has not proven green.
4. Add the CI status badge to the README only after that run is green.
5. Confirm the release-readiness gate below before tagging `v0.5.0-alpha`, and mark the release as a **pre-release**.

## Release artifacts

Pushing the tag `v0.5.0-alpha` runs `.github/workflows/release.yml`, which builds and tests each target, then publishes a pre-release with:

```text
blabla-v0.5.0-alpha-windows-x64.zip
blabla-v0.5.0-alpha-linux-x64.tar.gz
SHA256SUMS.txt
```

The release body is taken from `.github/release-notes/notes-<tag>.md`, so every future tag needs a notes file of that name in the repository before it is pushed.

## Release-readiness gate

```text
[ ] clean clone passes: build, tests, quick start, hello and todo examples
[ ] CI green on every platform the README claims
[ ] release binaries built by the tag workflow
[ ] SHA256SUMS.txt generated
[ ] release notes final
[ ] README final and its links resolve
[ ] public research links valid
[ ] git status clean and the repository URL substituted everywhere
```
