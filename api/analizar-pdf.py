import io
import json
import cgi
import pdfplumber
from http.server import BaseHTTPRequestHandler

POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000]
POT_33 = [25, 63, 160, 315, 500, 630]


def to_int(val):
    try:
        return int(str(val).strip()) if val and str(val).strip() not in ("", "None") else 0
    except (ValueError, TypeError):
        return 0


def find_section(tables, keyword):
    """Return the first table whose first non-empty cell contains keyword."""
    for table in tables:
        for row in table:
            for cell in row:
                if cell and keyword.upper() in str(cell).upper():
                    return table
    return None


def parse_kva_row(row, kva_col=0):
    """Return the KVA value if the row starts with a known KVA, else None."""
    try:
        val = to_int(row[kva_col])
        return val if val in POT_13 or val in POT_33 else None
    except (IndexError, TypeError):
        return None


def parse_planilla(pdf_bytes):
    terceros    = {str(k): {"t": 0, "m": 0, "ct": 0} for k in POT_13}
    taller      = {str(k): {"tipo": "", "t": 0, "m": 0, "ct": 0} for k in POT_13}
    autorizados = {str(k): 0 for k in POT_13}
    rel33       = {str(k): {"tN": 0, "mN": 0, "tR": 0, "mR": 0} for k in POT_33}
    obs, pend   = "", ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        all_tables = []
        all_text   = ""
        for page in pdf.pages:
            all_tables.extend(page.extract_tables() or [])
            all_text += (page.extract_text() or "") + "\n"

        for table in all_tables:
            if not table:
                continue

            # Detect section by scanning header rows
            header_text = " ".join(
                str(c) for row in table[:3] for c in row if c
            ).upper()

            # ── TERCEROS ────────────────────────────────────────────────────────
            if "TERCEROS" in header_text and "RELAC" not in header_text:
                for row in table:
                    kva = parse_kva_row(row)
                    if kva and kva in POT_13:
                        nums = [to_int(c) for c in row]
                        # row typically: [KVA, T, M, CT, ...]
                        terceros[str(kva)] = {
                            "t":  nums[1] if len(nums) > 1 else 0,
                            "m":  nums[2] if len(nums) > 2 else 0,
                            "ct": nums[3] if len(nums) > 3 else 0,
                        }

            # ── TALLER ──────────────────────────────────────────────────────────
            elif "TALLER" in header_text and "RELAC" not in header_text:
                for row in table:
                    kva = parse_kva_row(row)
                    if kva and kva in POT_13:
                        # row may have: [KVA, TIPO, T, M, CT, ...] or [TIPO, KVA, T, M, CT]
                        # Detect TIPO as the non-numeric string cell
                        tipo = ""
                        nums = []
                        kva_found = False
                        for cell in row:
                            s = str(cell).strip() if cell else ""
                            try:
                                v = int(s)
                                if not kva_found and v == kva:
                                    kva_found = True
                                else:
                                    nums.append(v)
                            except ValueError:
                                if s and s.upper() not in ("NONE", "KVA", "TIPO", "T", "M", "CT"):
                                    tipo = s
                        taller[str(kva)] = {
                            "tipo": tipo,
                            "t":  nums[0] if len(nums) > 0 else 0,
                            "m":  nums[1] if len(nums) > 1 else 0,
                            "ct": nums[2] if len(nums) > 2 else 0,
                        }

            # ── AUTORIZADOS (dentro de tabla TOTAL) ─────────────────────────────
            elif "AUTORIZADOS" in header_text or "TOTAL" in header_text:
                # Find the column index of "AUTORIZADOS"
                auto_col = None
                for row in table[:3]:
                    for ci, cell in enumerate(row):
                        if cell and "AUTORIZ" in str(cell).upper():
                            auto_col = ci
                            break
                    if auto_col is not None:
                        break

                if auto_col is not None:
                    for row in table:
                        kva = parse_kva_row(row)
                        if kva and kva in POT_13 and auto_col < len(row):
                            autorizados[str(kva)] = to_int(row[auto_col])

            # ── REL33 ───────────────────────────────────────────────────────────
            elif "RELAC" in header_text or "33" in header_text:
                for row in table:
                    kva = parse_kva_row(row)
                    if kva and kva in POT_33:
                        nums = [to_int(c) for c in row]
                        rel33[str(kva)] = {
                            "tN": nums[1] if len(nums) > 1 else 0,
                            "mN": nums[2] if len(nums) > 2 else 0,
                            "tR": nums[3] if len(nums) > 3 else 0,
                            "mR": nums[4] if len(nums) > 4 else 0,
                        }

        # ── OBS and PEND from raw text ───────────────────────────────────────────
        import re
        obs_m = re.search(
            r"OBSERVACIONES[^\n]*\n(.*?)(?=PENDIENTES|$)", all_text, re.IGNORECASE | re.DOTALL
        )
        pend_m = re.search(r"PENDIENTES[^\n]*\n(.*?)$", all_text, re.IGNORECASE | re.DOTALL)
        if obs_m:
            obs = obs_m.group(1).strip()[:1000]
        if pend_m:
            pend = pend_m.group(1).strip()[:1000]

    return {
        "terceros": terceros,
        "taller": taller,
        "autorizados": autorizados,
        "rel33": rel33,
        "obs": obs,
        "pend": pend,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)

            # Parse multipart form-data
            environ = {
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(length),
            }
            fs = cgi.FieldStorage(
                fp=io.BytesIO(body),
                environ=environ,
                keep_blank_values=True,
            )

            file_item = fs["file"] if "file" in fs else None
            if file_item is None:
                self._json({"error": "No se recibió ningún archivo"}, 400)
                return

            pdf_bytes = file_item.file.read()
            datos = parse_planilla(pdf_bytes)
            self._json({"datos": datos})

        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
