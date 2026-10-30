#!/usr/bin/env python3
"""Build self-hosted, site-specific font subsets.

Collects every character the site renders (per family / weight / style) with
headless Chromium, asks the Google Fonts API for woff2 files that contain only
those glyphs, saves them under assets/fonts/ with content-hashed names, and
rewrites:
  * the @font-face block in styles.css   (between /* fonts:begin */ … /* fonts:end */)
  * the font <link rel="preload"> lines in every page (between <!-- fonts:begin --> … <!-- fonts:end -->)

Re-run it whenever page text changes:   python3 tools/build-fonts.py
Needs: python3, curl, node + Playwright (npm i -g playwright).
Fonts: Noto Sans JP, Archivo, JetBrains Mono — SIL Open Font License 1.1.
"""
import hashlib, http.server, json, os, re, socketserver, subprocess, sys, tempfile, threading, urllib.parse
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, 'assets', 'fonts')
PAGES = ['index.html', 'sdgs/index.html', 'privacy/index.html', '404.html']
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

# Faces the site ships. Text drawn at other weights is matched to these the same way browsers do.
FACES = {
    'Noto Sans JP':   [(400, 'normal'), (500, 'normal'), (700, 'normal'), (900, 'normal')],
    'Archivo':        [(500, 'normal'), (700, 'normal'), (800, 'normal'), (800, 'italic')],
    'JetBrains Mono': [(400, 'normal')],
}
# Glyph coverage is limited to the character ranges Google Fonts serves for each family
# (its unicode-range slices), so every character keeps rendering in the same font as
# when the site loaded fonts from Google — e.g. "←" and "◆" stay on the fallback font.
COVERAGE_CSS = ('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400'
                '&family=Archivo:ital,wght@0,500;1,800&family=JetBrains+Mono:wght@400&display=swap')
# Faces needed for the first paint of every page (hero / page title and body copy).
PRELOAD = [('Noto Sans JP', 900, 'normal'), ('Noto Sans JP', 400, 'normal')]
ALWAYS = '  '  # spaces must come from the same font or spacing shifts


def match_weight(want, available):
    """CSS Fonts 4 font-weight matching."""
    av = sorted(available)
    if want in av:
        return want
    if 400 <= want <= 500:
        up = [w for w in av if want < w <= 500]
        if up: return up[0]
        down = [w for w in av if w < want]
        if down: return down[-1]
        return [w for w in av if w > 500][0]
    if want < 400:
        down = [w for w in av if w < want]
        return down[-1] if down else [w for w in av if w > want][0]
    up = [w for w in av if w > want]
    return up[0] if up else [w for w in av if w < want][-1]


def collect_chars():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as tmp:
            out = tmp.name
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'collect-glyphs.cjs'), f'http://127.0.0.1:{port}', out], check=True)
        httpd.shutdown()
    groups = json.load(open(out, encoding='utf-8'))
    os.unlink(out)
    faces = {}
    for g in groups:
        styles = {s for _, s in FACES[g['family']]}
        style = g['style'] if g['style'] in styles else 'normal'
        weight = match_weight(g['weight'], [w for w, s in FACES[g['family']] if s == style])
        faces.setdefault((g['family'], weight, style), set()).update(g['chars'])
    for k in faces:
        faces[k].update(ALWAYS)
    return faces


def curl(url, binary=False):
    r = subprocess.run(['curl', '-sS', '--fail', '--max-time', '60', '-A', UA, url], capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode('utf-8')


def google_coverage():
    """{family: [(lo, hi), ...]} from the unicode-range slices Google serves."""
    cov = {}
    for block in re.findall(r'@font-face\s*{([^}]*)}', curl(COVERAGE_CSS)):
        fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        ur = re.search(r'unicode-range:\s*([^;]+);', block)
        for part in (ur.group(1).split(',') if ur else ['U+0-10FFFF']):
            part = part.strip()[2:]
            lo, _, hi = part.partition('-')
            cov.setdefault(fam, []).append((int(lo, 16), int(hi or lo, 16)))
    return cov


def fetch_face(family, weight, style, chars):
    """Return [(woff2_bytes, unicode_range)] for one face, chunking long character lists."""
    chars = ''.join(sorted(chars))
    ital = 1 if style == 'italic' else 0
    results = []
    for i in range(0, len(chars), 300):
        chunk = chars[i:i + 300]
        q = urllib.parse.urlencode({'family': f'{family}:ital,wght@{ital},{weight}', 'text': chunk, 'display': 'swap'}, safe=':,@')
        css = curl('https://fonts.googleapis.com/css2?' + q)
        for block in re.findall(r'@font-face\s*{([^}]*)}', css):
            src = re.search(r'url\(([^)]+)\)', block).group(1)
            ur = re.search(r'unicode-range:\s*([^;]+);', block)
            results.append((curl(src, binary=True), ur.group(1).strip() if ur else None))
    return results


def slug(family):
    return family.lower().replace(' ', '-')


def main():
    faces = collect_chars()
    cov = google_coverage()
    for (family, _, _), chars in faces.items():
        dropped = {c for c in chars if not any(lo <= ord(c) <= hi for lo, hi in cov[family])}
        chars -= dropped
        if dropped:
            print(f'  {family}: left to fallback font (outside Google coverage): {"".join(sorted(dropped))!r}')
    os.makedirs(FONT_DIR, exist_ok=True)
    css_blocks, files, preload, total = [], set(), [], 0
    for (family, weight, style), chars in sorted(faces.items()):
        parts = fetch_face(family, weight, style, chars)
        for n, (data, urange) in enumerate(parts):
            name = f'{slug(family)}-{weight}{"i" if style == "italic" else ""}-{hashlib.sha1(data).hexdigest()[:10]}.woff2'
            with open(os.path.join(FONT_DIR, name), 'wb') as f:
                f.write(data)
            files.add(name)
            total += len(data)
            print(f'  {family:15} {weight} {style:6} {len(chars):4} chars -> {name} ({len(data)/1024:.1f} KB)')
            css_blocks.append(
                "@font-face {\n"
                f"  font-family: '{family}';\n  font-style: {style};\n  font-weight: {weight};\n  font-display: swap;\n"
                f"  src: url(\"/assets/fonts/{name}\") format('woff2');\n"
                + (f"  unicode-range: {urange};\n" if urange else '') + "}")
            if (family, weight, style) in PRELOAD:
                preload.append(f'<link rel="preload" href="/assets/fonts/{name}" as="font" type="font/woff2" crossorigin>')
    for old in os.listdir(FONT_DIR):
        if old.endswith('.woff2') and old not in files:
            os.remove(os.path.join(FONT_DIR, old))

    css_path = os.path.join(ROOT, 'styles.css')
    css = open(css_path, encoding='utf-8').read()
    block = '/* fonts:begin — generated by tools/build-fonts.py, do not edit by hand */\n' + '\n'.join(css_blocks) + '\n/* fonts:end */'
    if '/* fonts:begin' in css:
        css = re.sub(r'/\* fonts:begin.*?/\* fonts:end \*/', lambda m: block, css, flags=re.S)
    else:
        css = re.sub(r'(/\*.*?\*/\n)', lambda m: m.group(1) + '\n' + block + '\n', css, count=1, flags=re.S)
    open(css_path, 'w', encoding='utf-8').write(css)

    links = '<!-- fonts:begin -->\n' + '\n'.join(preload) + '\n<!-- fonts:end -->'
    google = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">')
    for page in PAGES:
        p = os.path.join(ROOT, page)
        html = open(p, encoding='utf-8').read()
        if '<!-- fonts:begin -->' in html:
            html = re.sub(r'<!-- fonts:begin -->.*?<!-- fonts:end -->', lambda m: links, html, flags=re.S)
        elif google.search(html):
            html = google.sub(lambda m: links, html)
        else:
            sys.exit(f'{page}: no font block found to replace')
        open(p, 'w', encoding='utf-8').write(html)
    print(f'\n{len(files)} font files, {total/1024:.1f} KB total; preload {len(preload)} file(s) on {len(PAGES)} pages')


if __name__ == '__main__':
    main()
