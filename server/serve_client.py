"""Static SPA server for the optional Jetson kiosk (port 8080)."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parents[1]/'client'/'dist'), **kwargs)
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/adventure', '/boss', '/storage', '/cast_iron', '/monstera', '/footage'):
            self.path = '/index.html'
        super().do_GET()

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
