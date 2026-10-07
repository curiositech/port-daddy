#!/usr/bin/env python3
"""Read-only source capture and cached-only terminal proof; outputs stay in --out-dir."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'website-v2/public/whitepaper'


def inventory_bytes():
    paths = sorted((WEB / 'figures').glob('fig-*.tex'))[:48]
    if len(paths) != 48:
        raise ValueError('The split fixture requires 48 existing figure sources.')
    lines = ['READ-ONLY FIGURE SOURCE INVENTORY',
             'root=website-v2/public/whitepaper/figures',
             'hash=SHA-256; bytes=source-file-size; order=filename; limit=48']
    for index, path in enumerate(paths, 1):
        data = path.read_bytes()
        lines.append(f'{index:03d} {hashlib.sha256(data).hexdigest()[:16]} {len(data):6d} {path.name}')
    lines.append('END INVENTORY: 48 files read; no source files changed.')
    return ('\n'.join(lines) + '\n').encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true', help='Only emit the read-only inventory to stdout.')
    parser.add_argument('--out-dir', type=Path, default=ROOT / '.cache/terminal-style-proof')
    parser.add_argument('--font-dir', type=Path, default=os.environ.get('PD_BOOK_FONT_DIR'), help='Licensed Suisse directory; otherwise explicitly uses the Book open-proof profile.')
    parser.add_argument('--mono-font-file', type=Path, help='Optional local mono file matching the parent focused proof (for example Menlo.ttc).')
    args = parser.parse_args()
    if args.capture:
        sys.stdout.buffer.write(inventory_bytes())
        return
    out = args.out_dir.resolve()
    if out == ROOT or out == WEB or out in ROOT.parents:
        parser.error('--out-dir must be a dedicated build directory')
    out.mkdir(parents=True, exist_ok=True)
    fixture = ROOT / 'tests/harbor-research/fixtures/terminal-style-book.tex'
    shutil.copyfile(fixture, out / 'terminal-style-book.tex')
    if args.font_dir:
        fontdir = args.font_dir.resolve()
        for name in ('Regular', 'Semibold', 'RegularItalic', 'SemiboldItalic'):
            if not (fontdir / f'SuisseIntl-{name}.otf').is_file():
                parser.error('Incomplete licensed Suisse font directory.')
        config = '\\def\\pdbookfontprofile{suisse}\n\\def\\pdbookfontdir{' + fontdir.as_posix() + '/}\n'
    else:
        config = '\\def\\pdbookfontprofile{open-proof}\n'
    (out / 'pd-book-font-config.tex').write_text(config)
    mono = ''
    if args.mono_font_file:
        font = args.mono_font_file.resolve(strict=True)
        mono = ('\\setmonofont[Path={' + font.parent.as_posix() + '/},Extension=' + font.suffix
                + ',UprightFont={' + font.stem + '},BoldFont={' + font.stem
                + '},ItalicFont={' + font.stem + '},BoldItalicFont={' + font.stem
                + '}]{' + font.stem + '}\n')
    (out / 'terminal-mono-config.tex').write_text(mono)
    icon_dir = out / 'figures/lucide'
    icon_dir.mkdir(parents=True, exist_ok=True)
    # Convert the pinned, already-vendored SVG locally; no network or source writes.
    subprocess.run(['rsvg-convert', '--format=pdf1.5', '--output=' + str(icon_dir / 'terminal.pdf'),
                    str(WEB / 'figures/lucide/terminal.svg')], check=True)
    capture = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--capture'],
                             cwd=ROOT, capture_output=True, check=True).stdout
    prompt = b'$ python3 scripts/harbor-research/build_terminal_style_fixture.py --capture\n'
    transcript = prompt + capture
    (out / 'terminal-inventory.txt').write_bytes(transcript)
    (out / 'terminal-inventory-session.tex').write_bytes(
        b'\\begin{pdsession}[Recorded offline inventory; 48 source files; no mutations]\n'
        + transcript + b'\\end{pdsession}\n')
    marker = subprocess.run(['sh', '-c', 'printf "inventory captured\\n"'], capture_output=True, check=True).stdout
    (out / 'terminal-completion-session.tex').write_bytes(
        b'\\begin{pdsession}[Recorded local completion marker]\n'
        + b'$ printf "inventory captured\\n"\n' + marker + b'\\end{pdsession}\n')
    provenance = {
        'capture_command': prompt.decode().strip(), 'capture_sha256': hashlib.sha256(capture).hexdigest(),
        'transcript_sha256': hashlib.sha256(transcript).hexdigest(),
        'font_profile': 'suisse' if args.font_dir else 'open-proof',
        'mono_override': str(args.mono_font_file) if args.mono_font_file else None,
        'inputs': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (
            fixture, WEB / 'coordination-papers-mega-volume-preamble.tex',
            WEB / 'figures/pd-pedagogy.tex', WEB / 'figures/pd-semantic-blocks.tex',
            WEB / 'figures/pd-margin-layout.tex', WEB / 'figures/session-fh-rollback.tex',
            WEB / 'figures/lucide/terminal.svg', WEB / 'figures/lucide/LICENSE')},
        'boundary': 'Offline file inventory and layout proof only; no PD, service, or research run.'}
    (out / 'terminal-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    command = ['tectonic', '-X', 'compile', '--only-cached', '--keep-logs', '--keep-intermediates',
               '--reruns=3', '-Z', 'search-path=' + str(out), '-Z', 'search-path=' + str(WEB),
               'terminal-style-book.tex']
    run = subprocess.run(command, cwd=out, capture_output=True, text=True)
    (out / 'compile-output.txt').write_text(run.stdout + run.stderr)
    if run.returncode:
        raise SystemExit('Fixture compile failed; see ' + str(out / 'compile-output.txt'))
    subprocess.run(['pdftoppm', '-png', '-r', '120', str(out / 'terminal-style-book.pdf'), str(out / 'page')], check=True)
    print(out / 'terminal-style-book.pdf')


if __name__ == '__main__':
    main()
