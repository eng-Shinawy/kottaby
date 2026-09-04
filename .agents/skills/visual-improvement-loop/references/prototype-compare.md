# Prototype Comparison

Prototype comparison happens **after** a screen is READY on the style loop. The question is: did the plan preserve or beat the prototype's information architecture?

## Rules

- **Structure only.** Prototypes are visually arbitrary (Tailwind colors, mock spacing). Color is never compared. Layout, hierarchy, density, control choices, content coverage are.
- **Prototype content is fake.** Every name/row/amount is placeholder; never infer a fact about the data from the prototype — only structure is meaningful.
- **Spec still wins.** When the implementation intentionally differs from the prototype because the spec says so, the spec wins by definition. Deltas from the OTHER direction (prototype richer than the implemented spec) are candidates to surface to the user.

## Comparator subagent contract

Exactly TWO sequential `ReadMediaFile` calls in the same subagent, in this order: (1) prototype image, (2) implementation image — never more, never batch.

Each comparison covers its own pair of: screen description, prototypes pre-i-a niceties, and any state caveats from the capture ("story is the empty state by design; preview surfaces absent in this state", etc.).

Output contract:

```
=== <proto> vs <impl> ===
Prototype structure: 3-6 bullets
Implementation structure: 3-6 bullets
Better: PROTOTYPE | IMPLEMENTATION | TIE
Why: 2-4 sentences grounded in what was seen
Previously missing, now present: <list>
Still missing vs prototype: <list or none>
Score impl structure 0-10 + "what a 10 needs"
```

## Handling deltas

Sort the deltas from "still missing vs prototype" into:

- **Pure visual/copy** → implementable directly by fix wave (i18n keys + layout).
- **New capabilities** (fields, queries, surfaces) → spec amendment decision held by the user; never implement silently. Possibly a new schema/type/mutation surface — route through the plan's change process.

A TIE or IMPLEMENTATION-wins verdict on structure, with visual 10/10 (or READY) on the loop, completes the comparison phase.
