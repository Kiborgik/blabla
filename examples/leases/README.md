# leases

A behavior contract with real complexity — time-to-live claims, renewal, release, expiry on `tick`
and persistence across `restart`. Useful for reading how guards, `all`/`any` queries and frame
conditions are written.

There is no `project.bla`; verify it the way [`../hello/`](../hello/README.md) is verified, against
[`app.py`](app.py).

```text
blabla check examples/leases.bla
blabla run examples/leases.bla -- python <absolute path to examples/leases/app.py>
```

Files: [`../leases.bla`](../leases.bla) is the contract, [`app.py`](app.py) the application.
