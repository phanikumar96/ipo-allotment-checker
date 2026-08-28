from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
import json

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body.decode('utf-8'))
        except:
            data = {}

        # MUFG Endpoint
        endpoint = "https://in.mpms.mufg.com/Initial_Offer/IPO.aspx/SearchOnPan"
        
        # Prepare the payload for MUFG
        payload = {
            'clientid': data.get('clientid', ''),
            'PAN': data.get('PAN', '').upper(),
            'IFSC': data.get('IFSC', ''),
            'CHKVAL': data.get('CHKVAL', '1'),
            'token': data.get('token', '')
        }

        headers = {
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
        }

        try:
            req = Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
            with urlopen(req, timeout=25) as response:
                result = response.read()
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(result)
        except Exception as e:
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
