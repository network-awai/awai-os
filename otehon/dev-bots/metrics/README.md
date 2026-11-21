# DORA ledger for developer-bot work

`dora-ledger.jsonl` records which merged bot changes failed and which were
rework. `../dora.mjs` reads it; without a line here, the change fail rate, the
recovery time and the rework rate print `unknown`. Tracking: AWAI-3685.

Everything under this directory is owner-only under `../kantoku-gate.mjs`: a
bot must not edit the record its own numbers come from.

## What counts

A change is a merged pull request whose head branch starts with `muse/`. A
merge stands in for a deployment.

| Line | Write it when |
| -- | -- |
| `failure` | The change itself went wrong after the merge: it was reverted, or a later unplanned change had to repair something this change introduced or did not deliver although its issue said it would. Name the repair in `fixed_by` (any merged pull request, a bot change or not). |
| `rework` | The change was not planned work. It was made because something already merged went wrong in use, or was found wrong after its merge. The thing it repairs need not be a bot change. |
| `reviewed` | You looked at the change and it is neither. |

Not a failure and not rework: a follow-up unit that was planned before the
merge, an improvement nobody was forced into, and work that moves code to a
rule written after the code.

A defect found and fixed before the merge is not a failure. It shows in the
clean merge rate instead.

When a case is borderline, decide, and start the note with `borderline:` so the
owner can find and overturn it.

## How to look at a change

1. `node ../dora.mjs --repos <owner/name,...> --since <YYYY-MM-DD> --unclassified`
   lists the changes nobody has looked at.
2. For each one, read the later merged pull requests in the same repository
   that touch its files, and any that revert it. Read the Linear issue of each
   candidate repair to see why it was made.
3. Write one line per change. Every line carries `by`, `on` (the date you
   looked) and a `note` that gives the reason.
4. Only then add a `classified-through` line with `from`, `at` and the
   repositories you covered. `at` is a time you had already looked past.
5. `node ../dora.mjs --repos <the same> --since <from> --check` must exit 0. It
   fails when a change inside the span has no line, when a fix is not merged or
   was merged before the change it fixes, and when a line cannot be read.

The file is append-only. A failure that shows up later is added as a new
`failure` line; the earlier `reviewed` line stays as the record of what was
known then, and the failure line wins.

## Limits

- "No later change touches its files" is weak evidence for a change that was
  merged days ago or is not in use yet. The notes say so where it applies.
- A week counts as classified only while every bot change merged in it, in the
  repositories of that run, is inside a span. A new merge makes the week
  `unknown` again until someone looks.
- The classification is a judgement by whoever is named in `by`. It is not
  derived from titles or labels.
