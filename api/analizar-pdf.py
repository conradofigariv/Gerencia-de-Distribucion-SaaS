import io
import re
import json
import cgi
import pdfplumber
from http.server import BaseHTTPRequestHandler

POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000]
POT_33 = [25, 63, 160, 250, 315, 500, 630]
POT_13_SET = set(POT_13)
POT_33_SET = set(POT_33)

SKIP_WORDS = {
    "NONE", "KVA", "TIPO", "T", "M", "CT", "TOTAL", "TALLER",
    "REPARADOS", "TRANSFORMADORES", "POR", "DE", "NUEVOS", "Y",
    "TERCEROS", "AUTORIZADOS", "DISPONIBLE", "CON", "TANQUE",
}


def to_int(val):
    try:
        v = str(val).strip().replace(",", "")
        return int(float(v)) if v and v not in ("", "None", "-", "—") else 0
    except (ValueError, TypeError):
        return 0


def cell_kva(val, kva_set):
    """Return int if val is a valid KVA value in kva_set, else None."""
    try:
        v = int(str(val).strip())
        return v if v in kva_set else None
    except (ValueError, TypeError):
        return None


def header_text(table, nrows=4):
    parts = []
    for row in table[:nrows]:
        for c in (row or []):
            if c:
                parts.append(str(c).upper().strip())
    return " ".join(parts)


def find_col(table, keyword, nrows=4):
    """Column index of the first cell containing keyword in the first nrows."""
    for row in table[:nrows]:
        for ci, c in enumerate(row or []):
            if c and keyword.upper() in str(c).upper():
                return ci
    return None


# ─── Section parsers ──────────────────────────────────────────────────────────

def parse_terceros(table, terceros):
    """Rows: [KVA, T, M, CT, ...]  — KVA at col 0."""
    for row in table:
        kva = cell_kva(row[0] if row else None, POT_13_SET)
        if kva is None:
            continue
        nums = [to_int(row[i]) for i in range(1, len(row))]
        terceros[str(kva)] = {
            "t":  nums[0] if len(nums) > 0 else 0,
            "m":  nums[1] if len(nums) > 1 else 0,
            "ct": nums[2] if len(nums) > 2 else 0,
        }


def parse_taller(table, taller, autorizados):
    """Rows: [TIPO, KVA, T, M, CT, ...]  — TIPO at col 0, KVA at col 1.
       Falls back to KVA at col 0 if col 0 is numeric."""
    auto_col = find_col(table, "AUTORIZ")

    for row in table:
        if not row:
            continue

        # Determine KVA column
        kva = cell_kva(row[1] if len(row) > 1 else None, POT_13_SET)
        data_start = 2  # T, M, CT start at col 2

        if kva is None:
            # Fallback: KVA at col 0 (some PDF variants)
            kva = cell_kva(row[0], POT_13_SET)
            data_start = 1

        if kva is None:
            continue

        # TIPO is the first non-numeric, non-skip-word string
        tipo = ""
        for c in row:
            s = str(c).strip().upper() if c else ""
            if s and s not in SKIP_WORDS and not s.replace(".", "").isdigit():
                tipo = str(c).strip()
                break

        data = [to_int(row[i]) for i in range(data_start, len(row))]
        taller[str(kva)] = {
            "tipo": tipo,
            "t":  data[0] if len(data) > 0 else 0,
            "m":  data[1] if len(data) > 1 else 0,
            "ct": data[2] if len(data) > 2 else 0,
        }

        if auto_col is not None and auto_col < len(row):
            autorizados[str(kva)] = to_int(row[auto_col])


def parse_autorizados(table, autorizados):
    """Table with an AUTORIZADOS column — extract that column per KVA."""
    auto_col = find_col(table, "AUTORIZ")
    if auto_col is None:
        return

    for row in table:
        if not row:
            continue
        # KVA might be at col 0 (number) or col 1 (after TIPO string)
        kva = cell_kva(row[0], POT_13_SET)
        if kva is None and len(row) > 1:
            kva = cell_kva(row[1], POT_13_SET)
        if kva and auto_col < len(row):
            autorizados[str(kva)] = to_int(row[auto_col])


def parse_rel33(table, rel33):
    """Rows: [KVA, tN, mN, tR, mR, ...]  — KVA at col 0."""
    for row in table:
        kva = cell_kva(row[0] if row else None, POT_33_SET)
        if kva is None:
            continue
        nums = [to_int(row[i]) for i in range(1, len(row))]
        rel33[str(kva)] = {
            "tN": nums[0] if len(nums) > 0 else 0,
            "mN": nums[1] if len(nums) > 1 else 0,
            "tR": nums[2] if len(nums) > 2 else 0,
            "mR": nums[3] if len(nums) > 3 else 0,
        }


# ─── Combined wide-table handler ──────────────────────────────────────────────

def parse_combined(table, terceros, taller, autorizados):
    """
    Handle the case where pdfplumber merges TERCEROS + TALLER (+ TOTAL)
    into one wide table. Detect each section's KVA column, then split.
    Layout: [KVA_T, T_T, M_T, CT_T, Tot_T, TIPO_Ta, KVA_Ta, T_Ta, M_Ta, CT_Ta, Tot_Ta, ...]
    """
    auto_col = find_col(table, "AUTORIZ")

    # Find the two KVA columns by scanning header/data rows for known KVA values
    kva_cols = []
    for row in table:
        if not row:
            continue
        for ci, c in enumerate(row or []):
            if cell_kva(c, POT_13_SET) and ci not in kva_cols:
                kva_cols.append(ci)
        if len(kva_cols) >= 2:
            break

    if len(kva_cols) < 2:
        # Couldn't detect two KVA cols — process as terceros only
        parse_terceros(table, terceros)
        return

    kva_col_t  = kva_cols[0]   # terceros KVA column
    kva_col_ta = kva_cols[1]   # taller KVA column

    for row in table:
        if not row or len(row) <= kva_col_ta:
            continue

        kva_t = cell_kva(row[kva_col_t], POT_13_SET)
        if kva_t:
            # Terceros data: columns immediately after kva_col_t
            terceros[str(kva_t)] = {
                "t":  to_int(row[kva_col_t + 1]) if kva_col_t + 1 < len(row) else 0,
                "m":  to_int(row[kva_col_t + 2]) if kva_col_t + 2 < len(row) else 0,
                "ct": to_int(row[kva_col_t + 3]) if kva_col_t + 3 < len(row) else 0,
            }

        kva_ta = cell_kva(row[kva_col_ta], POT_13_SET)
        if kva_ta:
            tipo = str(row[kva_col_ta - 1]).strip() if kva_col_ta > 0 and row[kva_col_ta - 1] else ""
            taller[str(kva_ta)] = {
                "tipo": tipo,
                "t":  to_int(row[kva_col_ta + 1]) if kva_col_ta + 1 < len(row) else 0,
                "m":  to_int(row[kva_col_ta + 2]) if kva_col_ta + 2 < len(row) else 0,
                "ct": to_int(row[kva_col_ta + 3]) if kva_col_ta + 3 < len(row) else 0,
            }
            if auto_col is not None and auto_col < len(row):
                autorizados[str(kva_ta)] = to_int(row[auto_col])


# ─── OBS / PEND extraction via bounding boxes ────────────────────────────────

def _extract_obs_pend(page):
    """
    Locate OBSERVACIONES and PENDIENTES DE ENTREGAS by scanning word positions
    in the bottom portion of the page, then crop each column independently.
    Requires 'PENDIENTES' to be followed by 'ENTREGA' nearby (avoids matching
    the table column header 'PENDIENTE de Retiro').
    """
    w, h = page.width, page.height
    bottom_y = h * 0.50
    words = page.extract_words() or []

    obs_word  = None
    pend_word = None

    for i, word in enumerate(words):
        if word["top"] < bottom_y:
            continue
        upper = word["text"].upper()

        if "OBSERVACI" in upper and obs_word is None:
            obs_word = word

        if upper.startswith("PENDIENTE") and pend_word is None:
            # Only accept if followed within 5 words by "ENTREGA"
            context = " ".join(ww["text"] for ww in words[i : i + 6]).upper()
            if "ENTREGA" in context:
                pend_word = word

    obs, pend = "", ""

    if obs_word:
        x0 = obs_word["x0"]
        y0 = obs_word["top"]
        # Right boundary: pend column start (or 65 % fallback)
        x1 = pend_word["x0"] if (pend_word and pend_word["x0"] > x0 + 10) else w * 0.65
        region = page.crop((x0, y0, x1, h))
        lines  = [l.strip() for l in (region.extract_text() or "").split("\n") if l.strip()]
        start  = 1 if lines and "OBSERVACI" in lines[0].upper() else 0
        obs    = "\n".join(lines[start:])[:1000]

    if pend_word:
        x0     = pend_word["x0"]
        y0     = pend_word["top"]
        region = page.crop((x0, y0, w, h))
        lines  = [l.strip() for l in (region.extract_text() or "").split("\n") if l.strip()]
        start  = 1 if lines and "PENDIENTE" in lines[0].upper() else 0
        pend   = "\n".join(lines[start:])[:1000]

    return obs, pend


# ─── Main parser ──────────────────────────────────────────────────────────────

def parse_planilla(pdf_bytes):
    terceros    = {str(k): {"t": 0, "m": 0, "ct": 0}                    for k in POT_13}
    taller      = {str(k): {"tipo": "", "t": 0, "m": 0, "ct": 0}        for k in POT_13}
    autorizados = {str(k): 0                                              for k in POT_13}
    rel33       = {str(k): {"tN": 0, "mN": 0, "tR": 0, "mR": 0}        for k in POT_33}
    obs, pend   = "", ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        all_tables = []
        for page in pdf.pages:
            all_tables.extend(page.extract_tables() or [])
            if not obs and not pend:
                obs, pend = _extract_obs_pend(page)

    for table in all_tables:
        if not table or len(table) < 2:
            continue

        ht = header_text(table)
        has_terceros = "TERCEROS" in ht
        has_taller   = "TALLER"   in ht
        has_relac    = "RELAC"    in ht or ("33" in ht and "0.4" in ht)
        has_auto     = "AUTORIZ"  in ht

        if has_relac:
            parse_rel33(table, rel33)
        elif has_terceros and has_taller:
            # Combined wide table
            parse_combined(table, terceros, taller, autorizados)
        elif has_terceros:
            parse_terceros(table, terceros)
        elif has_taller:
            parse_taller(table, taller, autorizados)
        elif has_auto:
            parse_autorizados(table, autorizados)

    return {"terceros": terceros, "taller": taller, "autorizados": autorizados,
            "rel33": rel33, "obs": obs, "pend": pend}


# ─── Vercel handler ───────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type = self.headers.get("Content-Type", "")
            length       = int(self.headers.get("Content-Length", 0))
            body         = self.rfile.read(length)

            fs = cgi.FieldStorage(
                fp=io.BytesIO(body),
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type,
                         "CONTENT_LENGTH": str(length)},
                keep_blank_values=True,
            )

            file_item = fs["file"] if "file" in fs else None
            if file_item is None:
                self._json({"error": "No se recibió ningún archivo"}, 400)
                return

            datos = parse_planilla(file_item.file.read())
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
