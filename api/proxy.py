from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import xml.etree.ElementTree as ET

MUFG_BASE = 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx'

HEADERS = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx',
}


def get_mufg_list():
    """Scrapes the live IPO list from MUFG Registrar."""
    url = MUFG_BASE + '/GetDetails'
    req = Request(url, data=b'{}', headers=HEADERS, method='POST')
    with urlopen(req, timeout=25) as response:
        raw_xml = json.loads(response.read().decode('utf-8')).get('d', '')

    root = ET.fromstring(raw_xml)
    ipo_list = []
    for table in root.findall('Table'):
        company_id = table.find('company_id')
        company_name = table.find('companyname')
        if company_id is not None and company_name is not None and company_id.text and company_name.text:
            ipo_list.append({
                'id': company_id.text,
                'name': company_name.text,
            })
    return ipo_list


def mufg_search(data):
    endpoint = MUFG_BASE + '/SearchOnPan'
    payload = {
        'clientid': str(data.get('clientid', '')).strip(),
        'PAN': str(data.get('PAN', '')).strip().upper(),
        'IFSC': str(data.get('IFSC', '')),
        'CHKVAL': str(data.get('CHKVAL', '1')),
        'token': str(data.get('token', '')),
    }
    req = Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers=HEADERS, method='POST')
    with urlopen(req, timeout=25) as response:
        return response.read()


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')

    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._cors()
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        action = (parse_qs(parsed.query).get('action', [''])[0] or '').lower()
        if action == 'ipos':
            try:
                self._json(200, get_mufg_list())
            except Exception as e:
                self._json(502, {'error': f'MUFG Error: {e}'})
            return
        self._json(404, {'error': 'Not found'})

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length else b'{}'

        try:
            data = json.loads(body.decode('utf-8') or '{}')
        except Exception:
            data = {}

        action = str(data.get('action', '')).lower()
        if action == 'ipos':
            try:
                self._json(200, get_mufg_list())
            except Exception as e:
                self._json(502, {'error': f'MUFG Error: {e}'})
            return

        try:
            result = mufg_search(data)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(result)
        except Exception as e:
            self._json(502, {'error': str(e)})
