# Owner surface fixes

Bugs and rough edges on owner-facing surfaces, each captured at the
level of its smallest coherent unit: what the bug was, where it lived,
why it existed, and what would have surfaced to the operator in
production. Future readers should be able to see the "why" without
chasing the diff.

## Terminology editor — English plural preview double-s

**File:** `components/terminology/terminology-form.tsx`, the `en.plural`
template at the `SAMPLE_SENTENCES` map. **Test:**
`tests/tier1/terminology-preview.test.ts` pins the shape for every
default plural (`members`, `batches`, `coaches`, `sessions`,
`programs`, `facilities`, `guardians`, `enquiries`) and every plausible
override (`swimmers`, `boxes`, `programmes` UK, `kids`, `staff`); also
pins the Hindi/Bengali branches so the next locale added doesn't
inherit the same shape by copy-paste.

The English plural template was
`` `12 ${n}s marked present` ``, with the `s` hard-coded after
`${n}`. `resolveTerm` in `lib/terminology/keys.ts` is correct — it
returns the operator's plural verbatim — but the editor preview line
in `components/terminology/terminology-form.tsx` was a copy-paste of
an English-default template that appended its own `s` on top, so a
swim club that renamed "member → swimmer" saw the preview render
`"12 swimmerss marked present"` (and `"batchess"`, `"coachess"`,
`"enquiriess"` for the other keys — `enquiries` was the only one
that happened to look right because the `y → ies` form was
pre-baked into the default).

**Production impact:** the bug lived in the preview only — runtime
copy goes through `resolveTerm` and is fine — so the only customer-
visible artefact was the operator seeing `"12 swimmerss"` flash by in
the editor on the very row they were about to rename. That is exactly
the moment they decide whether the rename is safe to commit, so a
misleading preview is enough to either ship a confusing rename or
push the operator to revert a change that was actually correct. The
fix is one character: drop the hard-coded `s` so the template is
`` `12 ${n} marked present` ``.
