# Keeping the glossaries current

The workspace has several contexts. [GLOSSARY-MAP.md](../GLOSSARY-MAP.md) lists each one with a link to its
`GLOSSARY.md`, the relationships between contexts, and the terms whose meaning differs between them.

## When

Update a glossary in the same commit as the change when the change:

- adds a domain concept that users, configurations, reports or other contexts name, such as a new option's concept, a
  new status reason or a new kind of run;
- renames a concept, in code or in a README;
- splits one concept into two, or merges two;
- retires a concept: move its term to the `_Avoid_` line of the term that replaces it, or delete the entry;
- adds a context (a new package or project with its own language), or moves a concept between contexts.

Update `GLOSSARY-MAP.md` when a context is added or removed, when a dependency between contexts changes, or when a term
comes to mean different things in two contexts.

A refactor that changes no concept, a new helper, or a new internal type leaves the glossaries as they are.

## How

Each `GLOSSARY.md` has this shape:

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

### {Group}

**{Term}**:
{One or two sentences: what the term is.}
_Avoid_: {other words for the same concept}
```

- **Define what the term is**, in one or two sentences, in the words a user of the package would use.
- **Keep implementation out**: no file names, function names, line numbers or algorithms. The glossary names concepts;
  READMEs and code say how they work.
- **Pick one term per concept** and list the other words that the code, READMEs or commit messages use under
  `_Avoid_`.
- **Keep only this project's terms.** A StrykerJS or Node.js term earns an entry only when this project gives it a
  narrower meaning, and the entry says how the two relate.
- **Group terms under `###` headings** when clusters form.
- **Check the code and README** before you write a definition. When they disagree, follow the code and fix the README
  in the same commit, or say in the commit message which one is wrong.

Map entries take the form `- [Name](./path/GLOSSARY.md): one line on what the context does`. Relationships name what
crosses between two contexts. Write `->` for a dependency and plain ASCII throughout.

Run `npx prettier --check` on every file you changed before you commit.
