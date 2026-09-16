mod pane {
    #[derive(Debug, Clone, Copy)]
    pub enum Tone {
        Default,
        Accent,
        Engaged,
        Gated,
        Resting,
        Landed,
        Conflicted,
        Alarm,
    }

    #[derive(Debug, Clone, Copy)]
    pub enum SyntaxKind {
        Plain,
        Keyword,
        Type,
        Str,
        Comment,
        Number,
    }
}

#[path = "../src/palette.rs"]
mod palette;
