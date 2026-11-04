//! Positions in a source as JavaScript gives them. oxc's spans count bytes; JavaScript counts
//! UTF-16 units, and lines and columns from 1.

use std::cell::OnceCell;

/// A source's byte offsets as UTF-16 offsets, from one pass over it. An ASCII source, which most
/// are, needs no table: each byte is one unit.
pub(crate) struct Utf16 {
    ascii: bool,
    prefix: Vec<u32>,
}

impl Utf16 {
    pub(crate) fn new(source: &str) -> Self {
        if source.is_ascii() {
            return Self {
                ascii: true,
                prefix: Vec::new(),
            };
        }
        let mut prefix = vec![0u32; source.len() + 1];
        let mut units = 0u32;
        for (index, character) in source.char_indices() {
            for offset in 0..character.len_utf8() {
                prefix[index + offset] = units;
            }
            units += character.len_utf16() as u32;
        }
        prefix[source.len()] = units;
        Self {
            ascii: false,
            prefix,
        }
    }

    pub(crate) fn at(&self, byte: u32) -> u32 {
        if self.ascii {
            byte
        } else {
            self.prefix[byte as usize]
        }
    }
}

/// The byte offset each line of a source starts at. A line ends at `\n`, `\r\n`, a lone `\r`,
/// U+2028 or U+2029, as it does in JavaScript.
struct Lines {
    starts: Vec<u32>,
}

impl Lines {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        let mut characters = source.char_indices().peekable();
        while let Some((index, character)) = characters.next() {
            let next = match character {
                '\r' if characters.next_if(|(_, next)| *next == '\n').is_some() => index + 2,
                '\r' | '\n' => index + 1,
                '\u{2028}' | '\u{2029}' => index + character.len_utf8(),
                _ => continue,
            };
            starts.push(next as u32);
        }
        Self { starts }
    }
}

/// UTF-16 offsets, lines and columns in one source, for what is found in it. The tables behind
/// them take one pass over the source, made at the first question, so a file with nothing to
/// place costs nothing, and each answer after it is a lookup.
pub(crate) struct Positions<'s> {
    source: &'s str,
    tables: OnceCell<(Utf16, Lines)>,
}

impl<'s> Positions<'s> {
    pub(crate) fn new(source: &'s str) -> Self {
        Self {
            source,
            tables: OnceCell::new(),
        }
    }

    fn tables(&self) -> &(Utf16, Lines) {
        self.tables
            .get_or_init(|| (Utf16::new(self.source), Lines::new(self.source)))
    }

    /// The UTF-16 offset of a byte offset.
    pub(crate) fn utf16(&self, byte: u32) -> u32 {
        self.tables().0.at(byte)
    }

    /// The line a byte offset is on, and its column there in UTF-16 units, both from 1.
    pub(crate) fn line_and_column(&self, byte: u32) -> (u32, u32) {
        let (utf16, lines) = self.tables();
        let line = lines.starts.partition_point(|start| *start <= byte) - 1;
        (
            line as u32 + 1,
            utf16.at(byte) - utf16.at(lines.starts[line]) + 1,
        )
    }
}
