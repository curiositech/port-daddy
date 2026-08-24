mod pane {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum SyntaxKind {
        Plain,
        Keyword,
        Type,
        Str,
        Comment,
        Number,
    }
}

#[path = "../src/syntax.rs"]
mod syntax;
