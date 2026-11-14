# Cross-pack Otehon proof fixtures

`logical-file-corpus.json` is the `binary-boundary` positive case from
`kotoba-lang/kotoba` commit `05fc7c5c62ca0e44fc9d7539fe9834ec9a6b0b14`,
`lib/kotoba.awaiFs/corpus/v1.json`. The full upstream corpus SHA-256 is
`21de8179f2c995a169250e2f67a09e6ffeafa4d05f448dcd22d0ed316cfe73ae`;
the extracted JSON SHA-256 is
`b353a2c7932530973c341f96ba9f19b62c5958542d6903e7a742b1a6efcb5f9b`.
The proof checks the fixed schema's encoded bytes and CID against this vector;
it does not run a Native artifact or qualify all schema inputs.

The four `part-*.forest.car.zst` files were produced 2026-11-13 by the official
Forest 0.39.0+git.7f63144 macOS arm64 release, zip SHA-256
`a6bc8dac35e3e77b1768fa9b24b4955603f29b5383d705c04fb2bc926483ff69`.
The existing Otehon Pack writer built four CARv1 inputs from consecutive
524,288-byte portions of a deterministic 2 MiB file, using the generator in
this directory. Forest `snapshot compress --frame-size 1024` made each archive;
`forest-tool car validate` passed on all four.

```text
part-0 87a1d2773c099ef49af8fc7b9b00b43123a4e83ab1bc3f1f2b3fca0278fb62df
part-1 33469df01bb4f837d655da9b232a366910ab4a575094235ffc875029f46ad206
part-2 2c88ec993d3f62e401dfdfac1822083ecdc3a7609e65d9c0dda91eb9bd476ef9
part-3 d7c2b94aa04f79e177c1819f63d651f887c01bd5029ca5f65ef354d1be5578e1
```

The proof uses a harness-owned metadata pointer published after individually
committing four Packs. It is not a production multi-pack atomic writer,
Datomic evaluator, physical power-loss test, or authorization proof.
