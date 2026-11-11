# Mutators

The packages that add mutators to StrykerJS: this shared install layer and the three mutator packages
`stryker-node-mutators`, `stryker-node-test-mutators` and `stryker-js-mutators`, split by the kind of code they mutate.

## Language

### Mutators

**Mutator**:
A named way of changing one kind of code into mutants, as Stryker's own mutators are; a mutator package defines each
one with a sample.
_Avoid_: operator, mutation operator, rule

**Mutator name**:
The letters-only name with the `Lz` prefix, such as `LzNodeTimerDelay`, that configurations, `excludedMutations` and
Stryker disable comments use.
_Avoid_: the camelCase export name

**Sample**:
A small piece of code in which a mutator must make at least one mutant.
_Avoid_: fixture, example

**Mutator package**:
A package that defines mutators for one kind of code: Node.js API and `node:assert` calls in production code
(`stryker-node-mutators`), node:test test files (`stryker-node-test-mutators`), or any JavaScript and TypeScript
(`stryker-js-mutators`).
_Avoid_: operator package, mutator plugin

**Bindings**:
The helpers of `stryker-node-mutators` that recognise Node.js built-in modules and `node:assert` calls, which
`stryker-node-test-mutators` uses; they install nothing.
_Avoid_: detector, scope bindings

### Tiers

**Tier**:
One of a mutator package's three groups, default, opt-in and experimental, which decides whether a mutator runs
without being named.
_Avoid_: level, entry point

**Default mutators**:
The mutators that run when a configuration installs the package with no options.

**Opt-in mutators**:
The mutators that run when a configuration names them, or all at once with `extended`.

**Experimental mutators**:
The mutators that run when a configuration names them under `experimental`, or all at once with `experimental: true`;
one may change or go in a minor release.
_Avoid_: beta, unstable

**Extended**:
The option that turns on every opt-in mutator of a package.

### Install

**Install**:
Putting a package's selected mutators into Stryker's list of mutators, in every copy of Stryker core that the process
can run, then self-checking them.
_Avoid_: register, load

**Add mode**:
The install that adds mutators to Stryker's own mutators, for production code.

**Replace mode**:
The install that removes Stryker's own mutators and keeps the mutators that other mutator packages installed, for
test code.
_Avoid_: override

**Own mark**:
The tag on an installed mutator that names the mutator package that installed it.
_Avoid_: brand

**Copy of Stryker core**:
One installation of Stryker's core package that the process may run; an install patches each copy.
_Avoid_: instance

**Self-check**:
Running each mutator on its sample with each copy of Stryker core, and failing the install when a mutator makes no
mutant.
_Avoid_: smoke test
