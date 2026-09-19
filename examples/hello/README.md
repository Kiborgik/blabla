# hello

The one-screen contract: one state, one action, one postcondition. There is no `project.bla`, so
the single contract is verified directly against the application.

```text
blabla check examples/hello.bla
blabla run examples/hello.bla --cases 1 --steps 1 -- python <absolute path to examples/hello/app.py>
```

The adapter runs in a fresh temporary working directory for every case, so an interpreter script
argument must be an absolute path.

Files: [`../hello.bla`](../hello.bla) is the contract, [`app.py`](app.py) the application.
