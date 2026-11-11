# OSS evaluation

The driver that runs StrykerJS on pinned open-source projects twice, with this runner and with Stryker's command
runner, and compares the two reports; and the fixture e2e tests that run the packed packages as a consumer would.

## Language

### Projects and copies

**OSS project**:
One of the open-source node:test projects in the driver's catalogue, such as fastify-cookie or sonic-boom.
_Avoid_: target, fixture

**Source clone**:
The project checkout given to the driver, which the driver never writes to.
_Avoid_: source

**Prepared copy**:
The patched, installed copy of a source clone that a driver run's sides run in.
_Avoid_: sandbox

**Patch**:
A change to a prepared copy that replaces one exact text once, such as a test's fixed file name.
_Avoid_: fix

**Pinned install date**:
The date before which every dependency of a prepared copy was published, so that reruns install the same versions.

### Runs

**Side**:
One of the two runners compared on a project: `lz` (this runner) or `command` (Stryker's command runner running
`node --test`).
_Avoid_: arm, variant

**Driver run**:
One run of the driver on one project, which writes one result with both sides or one.
_Avoid_: run

**Part**:
One range of a large file's mutants, cut between top-level statements, run as its own driver run and merged later.
_Avoid_: shard, batch

**Checkpoint**:
A side's report so far, kept while it runs, so that an interrupted side resumes instead of starting over.

**Deciding fields**:
The facts two results must share to be compared or merged: project, source commit, Node.js version, platform, mutant
timeout, installed versions, packed-package digests and project setup.

**Checkpoint key**:
The deciding fields plus the mutated files and the Stryker configuration; a checkpoint with another key is thrown away.

**Merge**:
Combining the results of one project's driver runs into one, refused when their deciding fields differ or two hold the
same mutant.
_Avoid_: concatenate

### Processes

**Sampler**:
The recorder that notes the driver's descendant processes and their memory every second.
_Avoid_: monitor

**Descendant**:
A process in the driver's process tree.
_Avoid_: started process, child

**Leftover**:
A descendant still alive after its side has ended.
_Avoid_: zombie, orphan

### Comparison

**Mutant key**:
A mutant's identity across sides and runs: its file, position, mutator and replacement.
_Avoid_: mutant id

**Verdict**:
The pair of statuses that one mutant got on the two sides.
_Avoid_: result

**Disagreement**:
A verdict whose two statuses differ, or a mutant that only one side reports.
_Avoid_: diff

**Comparison**:
A driver run's verdicts and disagreements, or the reason it could not compare.

### Fixture tests

**Fixture e2e**:
The tests that install the packed packages into a copy of a small fixture project and run Stryker there.
_Avoid_: integration test
