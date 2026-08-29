#!/usr/bin/env python3
"""Local same-origin MUFG proxy for index.html. No third-party packages required."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from pathlib import Path
import json
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
MUFG = 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx'
COOKIE_JAR = CookieJar()
OPENER = build_opener(HTTPCookieProcessor(COOKIE_JAR))


def get_mufg_list():
    endpoint = MUFG + '/GetDetails'
    raw = json.dumps({}).encode('utf-8')
    headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx',
    }
    req = Request(endpoint, data=raw, headers=headers, method='POST')
    with OPENER.open(req, timeout=25) as r:
        raw_xml = json.loads(r.read().decode('utf-8')).get('d', '')
    root = ET.fromstring(raw_xml)
    ipo_list = []
    for table in root.findall('Table'):
        company_id = table.find('company_id')
        company_name = table.find('companyname')
        if company_id is not None and company_name is not None and company_id.text and company_name.text:
            ipo_list.append({'id': company_id.text, 'name': company_name.text})
    return ipo_list


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, code, obj):
        raw = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/proxy'):
            if 'action=ipos' in self.path:
                try:
                    self._json(200, get_mufg_list())
                except Exception as e:
                    self._json(502, {'error': f'MUFG Error: {e}'})
                return
            self._json(404, {'error': 'Not found'})
            return
        if self.path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/api/proxy'):
            self._json(404, {'error': 'Not found'})
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(length) if length else b'{}'
            data = json.loads(body.decode('utf-8') or '{}')
        except Exception:
            self._json(400, {'error': 'Invalid JSON'})
            return

        if str(data.get('action', '')).lower() == 'ipos':
            try:
                self._json(200, get_mufg_list())
            except Exception as e:
                self._json(502, {'error': f'MUFG Error: {e}'})
            return

        clientid = str(data.get('clientid', '')).strip()
        pan = str(data.get('PAN', '')).strip().upper()
        if not clientid or not pan:
            self._json(400, {'error': 'clientid and PAN are required'})
            return

        payload = {
            'clientid': clientid,
            'PAN': pan,
            'IFSC': str(data.get('IFSC', '')),
            'CHKVAL': str(data.get('CHKVAL', '1')),
            'token': str(data.get('token', '')),
        }
        endpoint = MUFG + '/SearchOnPan'
        raw = json.dumps(payload).encode('utf-8')
        headers = {
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx',
        }
        req = Request(endpoint, data=raw, headers=headers, method='POST')
        try:
            with OPENER.open(req, timeout=25) as r:
                out = r.read()
                code = r.status
                ctype = r.headers.get('Content-Type', 'application/json')
        except HTTPError as e:
            out = e.read()
            code = e.code
            ctype = e.headers.get('Content-Type', 'application/json')
        except URLError as e:
            self._json(502, {'error': f'MUFG upstream connection failed: {e.reason}'})
            return
        except Exception as e:
            self._json(502, {'error': f'MUFG upstream request failed: {e}'})
            return

        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f'MUFG IPO checker: http://127.0.0.1:{port}/')
    print('Press Ctrl+C to stop.')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
