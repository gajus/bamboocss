---
'@bamboocss/ts-ast': patch
---

Release the compiler snapshot a project replaces.

`updateSnapshot` carries the previous snapshot's cached trees forward and then releases that snapshot's own references
only if it has been disposed. Nothing disposed one, so every snapshot a build ever made stayed live in both processes —
the client keeps a per-snapshot set naming every path fetched through it, and each new snapshot inherits the paths of
the last, so those sets grow as the square of the number of updates. The compiler was never told to release its side
either.

Measured over a project of 400 files with one update each: 213 MB of client heap undisposed against 140 MB disposed. At
800 it is 375 MB against 205 MB, and at 1,600 it is 941 MB against 309 MB — the gap widens because only one of the two
is quadratic. A cold build on a large repository makes far more updates than that, which is how a build that fits in
memory stops fitting.

Disposing after the new snapshot exists is what makes it safe: the carry-forward has already happened, so a file still
in the program keeps its cached tree, and a node taken from the older snapshot stays readable because what it reads is a
buffer this process already holds.
