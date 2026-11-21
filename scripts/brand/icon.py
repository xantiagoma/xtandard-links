import sys
from mark import *

def icon(orbit=True, shadow=True):
    defs = [lime_gradient("lime"),
            '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1A1C1F"/><stop offset="1" stop-color="#08090B"/></linearGradient>',
            '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>']
    if shadow:
        defs.append('<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#000" flood-opacity=".55"/></filter>')
    body = ['<rect width="1024" height="1024" rx="224" fill="url(#bg)"/>',
            '<rect x="2" y="2" width="1020" height="1020" rx="222" fill="none" stroke="url(#rim)" stroke-width="4"/>']
    if orbit:
        body += [f'<g fill="none" stroke="{ORBIT}" stroke-linecap="round">',
                 '<circle cx="512" cy="512" r="350" stroke-width="3" opacity=".22"/>',
                 '<path d="M614.1 102.5A422 422 0 0 1 933.4 489.9" stroke-width="4.5" opacity=".7"/>',
                 '<path d="M93.1 563.4A422 422 0 0 0 307.4 881.1" stroke-width="4.5" opacity=".7"/>', '</g>',
                 f'<g fill="{ORBIT}"><circle cx="614.1" cy="102.5" r="13"/><circle cx="933.4" cy="489.9" r="13"/><circle cx="93.1" cy="563.4" r="13"/><circle cx="307.4" cy="881.1" r="13"/></g>']
    body.append(f'<g{" filter=" + chr(34) + "url(#shadow)" + chr(34) if shadow else ""}>')
    body.append(brackets(ORBIT if orbit else "#5A6067"))
    body.append(glyph("url(#lime)"))
    body.append("</g>")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="xtandard-links">\n'
            '<title>xtandard-links</title>\n<defs>' + "".join(defs) + '</defs>\n' + "\n".join(body) + "\n</svg>\n")

if __name__ == "__main__":
    print(icon())
