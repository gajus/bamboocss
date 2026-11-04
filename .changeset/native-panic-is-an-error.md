---
'@bamboocss/node': patch
---

A panic in the native extractor fails the call that hit it with an error, instead of ending the process. The dev server
stays up and reports it on the module it was transforming, and a build reports it as it does any other extraction
failure. The message is the panic's, and the terminal shows where in the Rust code it happened.

The caches native calls share across transforms empty themselves and go on when a panic poisons one of their locks. They
used to switch themselves off for the rest of the process instead, without saying so.
