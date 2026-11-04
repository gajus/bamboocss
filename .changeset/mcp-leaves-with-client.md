---
'@bamboocss/mcp': patch
---

The MCP server leaves when its client does, and when an uncaught error ends it.

- It exits once stdin ends. A config keeping the event loop busy, with a timer or a watcher of its own, kept the server
  running after its client had gone, since nothing listened for stdin closing and only a write found the pipe gone.
- An uncaught exception or unhandled rejection is written to stderr, which a client shows as the server's log, and the
  server exits with 1 for the client to start another. The handler `@bamboocss/node` installs logged it and went on,
  through a logger that `silent` or the config's `logLevel` can quiet, so a server in a state the error left unknown
  went on answering and said nothing.
