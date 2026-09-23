# Security

## What BlaBla executes

- `blabla run` and `blabla finish` launch the application command written in `project.bla` (or on the command line) in a fresh temporary directory per case and terminate its process tree afterwards. Treat a project's `verify behavior { command [...] }` as you would treat its build script: do not run BlaBla on a repository you would not build.
- The Python structure provider launches the interpreter only to run BlaBla's embedded AST extractor in isolated mode. It reads project files as text and parses them; it never imports or executes project modules. A regression test inspects a module with top-level side effects and asserts none run.
- `blabla status`, `blabla explain` and `blabla check` never launch the application.

## Trust boundaries

Observations come from the application's adapter; an adapter that fabricates state defeats verification by design. BlaBla is not a sandbox and GREEN is not proof of correctness.

## Reporting

Report vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting for this repository. Include the BlaBla version (`blabla --version`), the platform and a minimal contract or project that reproduces the problem. Expect an acknowledgement within a week; this is a volunteer project without a fixed disclosure timeline.
