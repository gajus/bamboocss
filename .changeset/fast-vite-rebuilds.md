---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Make Vite development stylesheet rebuilds consume known dirty paths instead of globbing and statting every source on
each edit. Additions and deletions still reconcile the complete inventory, while cached metadata and watcher coverage
keep ordinary edits incremental.
