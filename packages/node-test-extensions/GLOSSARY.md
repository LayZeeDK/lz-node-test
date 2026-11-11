# Table tests

`lzTestEach` and `lzTestFor`: Vitest's `test.each` and `test.for` for node:test, which turn a table of cases into one
test per case.

## Language

**Table**:
The cases given to `lzTestEach` or `lzTestFor`: an array, or a template table.
_Avoid_: dataset, matrix

**Case**:
One entry of a table, which becomes one node:test test.
_Avoid_: example, row (outside template tables)

**Template table**:
A table written as a tagged template whose first line names the columns and whose other lines are rows.
_Avoid_: tagged table

**Row**:
One line of a template table, which becomes a case with one property per column.

**Spread**:
How `lzTestEach` passes an array case to the test function as separate arguments, when every case is an array.
_Avoid_: destructure

**Name template**:
The test name given with the table, with placeholders that each case fills in.

**Title**:
The test name that a name template and one case produce.
_Avoid_: label

**Placeholder**:
A token in a name template that a value of the case fills, such as `%s`, `%d` or `%j`, and `%#` and `%$` for the case's
position.

**Property path**:
A `$` token in a name template, such as `$a.b`, that reads a property of an object case.
_Avoid_: dollar variable

**Modifier**:
`skip`, `only`, `todo`, `fails`, `skipIf` or `runIf` on a table, which applies to each of its tests.
_Avoid_: flag

**Fails test**:
A test that passes only when its function throws or rejects.
_Avoid_: expected failure
