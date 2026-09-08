/** Shared account styles are dependency-free: importing them must never load auth handlers. */
// HEAD + TOKENS are exported for sibling storefront pages (runs-page.ts) so the
// story-linework token block stays single-sourced across /login, /account and
// /account/runs.
export const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Recursive:CASL,slnt,wght@1,-8,400..800&display=swap" rel="stylesheet">`;

export const TOKENS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border-radius:0}
:root,:root[data-theme="light"]{
  --surface-base:#f2eee6;--surface-raised:#f7f3eb;--surface-strong:#e9e2d5;
  --text-primary:#121212;--text-secondary:#403b34;--text-muted:#47423a;--text-ghost:#98928a;
  --cobalt:#003fb8;--teal:#006b5f;--health:#1f7a4d;--amber:#a66f00;--error:#bf2f2f;
  --violet:#933fa5;--rust:#7a4514;--gold:#666a00;
  --hair:rgba(18,18,18,.14);--hair-strong:rgba(18,18,18,.34);--border-strong:#121212;
  --surface-card:#e9e2d5;--on-accent:#fbf7ef;}
:root{--cobalt-slab:#003fb8;--gold-slab:#666a00;--lime:#cad900;--cream:#fbf7ef;--ink:#17191d;
  --rust-slab:#7a4514;--flag-white:#fbf7ef;
  --lw-weight:1.5px;--lw-stripe:3px;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --surface-base:#101216;--surface-raised:#181c22;--surface-strong:#222833;
  --text-primary:#f5f3ed;--text-secondary:#d3cec2;--text-muted:#a59f93;--text-ghost:#5c574e;
  --cobalt:#7db4ff;--teal:#8fd0a7;--health:#5fce97;--amber:#f2be51;--error:#ff7d7d;
  --violet:#e0a5ed;--rust:#b98e6b;--gold:#d8dd3c;
  --hair:rgba(245,243,237,.14);--hair-strong:rgba(245,243,237,.34);--border-strong:#f5f3ed;
  --surface-card:#181c22;--on-accent:#121212;}}
:root[data-theme="dark"]{
  --surface-base:#101216;--surface-raised:#181c22;--surface-strong:#222833;
  --text-primary:#f5f3ed;--text-secondary:#d3cec2;--text-muted:#a59f93;--text-ghost:#5c574e;
  --cobalt:#7db4ff;--teal:#8fd0a7;--health:#5fce97;--amber:#f2be51;--error:#ff7d7d;
  --violet:#e0a5ed;--rust:#b98e6b;--gold:#d8dd3c;
  --hair:rgba(245,243,237,.14);--hair-strong:rgba(245,243,237,.34);--border-strong:#f5f3ed;
  --surface-card:#181c22;--on-accent:#121212;}
html,body{overflow-x:clip}
body{background:var(--surface-base);color:var(--text-primary);
  font-family:"IBM Plex Sans","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.mono,code{font-family:"IBM Plex Mono","SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums slashed-zero}
h1,h2,h3{text-wrap:balance;letter-spacing:-0.02em}p{text-wrap:pretty}
a{color:var(--cobalt);text-underline-offset:3px}a:hover{color:var(--teal)}
:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px}
.rec{font-family:"Recursive","IBM Plex Sans",sans-serif;font-variation-settings:"CASL" 1,"slnt" -8;font-weight:660}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted)}
.caption{font-size:14px;line-height:1.55;color:var(--text-muted)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
button,input{font:inherit;color:inherit}
`;
